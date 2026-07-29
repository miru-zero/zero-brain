/**
 * Central Brain MCP Server (v1.1)
 * stdio transport — local filesystem ล้วน ห้าม network call
 * กฎเหล็ก: ไม่มี delete / atomic+entity ต้องมี evidence≥1 /
 * search default ไม่คืน T1,T2 / read: T1 audit ทุกครั้ง, T2 ต้องมี approval จากป๊า
 * (.kb/approvals/<id>.json สร้างด้วยมือเท่านั้น — agent อนุมัติตัวเองไม่ได้) /
 * health สแกน body wikilinks ด้วย / ทุก mutation audit
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, writeFileSync } from "node:fs";
import path from "node:path";
import {
  initBrain, isInitialized, isoNow, kbPath, readManifest, readAliases,
  appendLink, appendAudit, writeHealth, sha256,
  type HealthReport, type ManifestRecord, type NoteLink,
} from "./kernel.js";
import {
  parseNoteFile, serializeFrontmatter, slugify, extractWikilinks,
  NOTE_TYPES, PRIVACY_LEVELS, NOTE_STATES,
  type NoteMeta,
} from "./schema.js";

const ROOT = path.resolve(process.env.CENTRAL_BRAIN_ROOT ?? "./brain");
const ACTOR = process.env.CENTRAL_BRAIN_ACTOR ?? "unknown-agent";
const ID_RE = /^\d{8}-\d{6}-[a-z0-9]{4}$/;

// ---------- helpers ----------

function randomSuffix(): string {
  return Math.random().toString(36).slice(2, 6).padEnd(4, "0");
}

function newId(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}-${randomSuffix()}`;
}

function rel(abs: string): string {
  return path.relative(ROOT, abs).split(path.sep).join("/");
}

function ok(data: unknown) {
  return { content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }] };
}

function fail(message: string) {
  return { content: [{ type: "text" as const, text: JSON.stringify({ error: message }) }], isError: true };
}

function ensureBrain(): void {
  if (!isInitialized(ROOT)) {
    throw new Error(`Brain ยังไม่ได้ init ที่ ${ROOT} — เรียก brain_init ก่อน`);
  }
}

// ---------- privacy approval gate (T2) ----------
// T2 = เปราะบาง: agent อ่านได้ก็ต่อเมื่อป๊าสร้างไฟล์อนุมัติเองที่
// .kb/approvals/<note-id>.json — เช่น {"approved_by":"ป๊า","at":"2026-07-29","expires":null}
// ไม่มี tool ให้ agent อนุมัติตัวเอง — สร้าง/ลบไฟล์นี้ด้วยมือเท่านั้น (เหมือน git push)
function isApproved(noteId: string): boolean {
  const f = kbPath(ROOT, "approvals", `${noteId}.json`);
  if (!existsSync(f)) return false;
  try {
    const rec = JSON.parse(readFileSync(f, "utf8")) as { expires?: string | null };
    if (rec.expires && Date.parse(rec.expires) < Date.now()) return false;
    return true;
  } catch {
    return false;
  }
}

/** บังคับกฎ privacy ตอนอ่านโน้ต — T1 audit ทุกครั้ง / T2 ต้องมี approval */
function enforceReadPrivacy(meta: NoteMeta): void {
  if (meta.privacy === "T2") {
    if (!isApproved(meta.id)) {
      audit(ROOT, ACTOR, "brain_read_t2_blocked", meta.id, `title=${meta.title}`);
      throw new Error(
        `โน้ต ${meta.id} เป็น T2 (เปราะบาง) — ปิดไว้ตามกฎเหล็กข้อ 5: ` +
          `ป๊าต้องสร้าง .kb/approvals/${meta.id}.json ด้วยมือก่อน agent จะอ่านได้`,
      );
    }
    audit(ROOT, ACTOR, "brain_read_t2_approved", meta.id, `title=${meta.title}`);
  } else if (meta.privacy === "T1") {
    audit(ROOT, ACTOR, "brain_read_t1", meta.id, `title=${meta.title}`);
  }
}

/** ดึง wikilinks [[target|alias]] จากเนื้อโน้ต (body เท่านั้น ไม่รวม frontmatter) */
function extractBodyWikilinks(body: string): string[] {
  const out: string[] = [];
  const re = /\[\[([^\]]+)\]\]/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(body)) !== null) {
    const inner = m[1] ?? "";
    const target = inner.split("|")[0]?.trim() ?? "";
    if (target) out.push(target);
  }
  return out;
}

function audit(root: string, actor: string, action: string, target: string, detail?: string): void {
  appendAudit(root, { ts: isoNow(), actor, action, target, ...(detail ? { detail } : {}) });
}

/** ค้นหาไฟล์โน้ตจาก id หรือ alias — คืน { absPath, meta, body } หรือ null */
function findNote(idOrAlias: string): { absPath: string; meta: NoteMeta; body: string } | null {
  const manifest = readManifest(ROOT);
  let rec: ManifestRecord | undefined = manifest.get(idOrAlias);
  if (!rec) {
    const aliases = readAliases(ROOT);
    const target = aliases[idOrAlias];
    if (target) rec = manifest.get(target);
  }
  if (!rec) {
    for (const r of manifest.values()) {
      if (r.title === idOrAlias) { rec = r; break; }
    }
  }
  if (!rec) return null;
  const abs = path.join(ROOT, rec.path);
  if (!existsSync(abs)) return null;
  const parsed = parseNoteFile(readFileSync(abs, "utf8"));
  return { absPath: abs, meta: parsed.meta, body: parsed.body };
}

function appendManifest(rec: ManifestRecord): void {
  const p = kbPath(ROOT, "manifest.jsonl");
  const line = JSON.stringify(rec);
  writeFileSync(p, readFileSync(p, "utf8") + line + "\n", "utf8");
}

function writeAliases(aliases: Record<string, string>): void {
  writeFileSync(kbPath(ROOT, "aliases.json"), JSON.stringify(aliases, null, 2) + "\n", "utf8");
}

// ---------- tool handlers ----------

function handleInit(): unknown {
  if (isInitialized(ROOT)) {
    return { ok: true, already: true, root: ROOT, message: "brain นี้ init แล้ว ไม่ทำซ้ำ (กฎ: ห้ามทำลายข้อมูล)" };
  }
  initBrain(ROOT);
  audit(ROOT, ACTOR, "brain_init", ROOT);
  return { ok: true, root: ROOT };
}

function handleCapture(args: { text: string; source?: string }): unknown {
  ensureBrain();
  const id = newId();
  const meta: NoteMeta = {
    id,
    type: "fleeting",
    title: args.text.split("\n")[0]!.slice(0, 60),
    created: isoNow(),
    updated: isoNow(),
    aliases: [],
    tags: [],
    domain: "inbox",
    privacy: "T0",
    state: "active",
    links: [],
    evidence: args.source ? [args.source] : [],
  };
  const abs = path.join(ROOT, "00_Fleeting", `${id}.md`);
  writeFileSync(abs, serializeFrontmatter(meta) + "\n" + args.text + "\n", "utf8");
  appendManifest({
    id, type: "fleeting", title: meta.title, path: rel(abs),
    domain: "inbox", privacy: "T0", created: meta.created,
  });
  audit(ROOT, ACTOR, "brain_capture", rel(abs));
  return { ok: true, id, path: rel(abs) };
}

function handleWriteNote(args: {
  title: string; body: string; type: string; domain?: string;
  privacy?: string; tags?: string[]; aliases?: string[]; evidence?: string[];
}): unknown {
  ensureBrain();
  const type = args.type as (typeof NOTE_TYPES)[number];
  if (!NOTE_TYPES.includes(type)) throw new Error(`type ต้องเป็น ${NOTE_TYPES.join("/")}`);
  const needEvidence = type === "atomic" || type === "entity";
  if (needEvidence && (!args.evidence || args.evidence.length === 0)) {
    throw new Error(
      `กฎเหล็ก: โน้ต ${type} ต้องมี evidence ≥ 1 — ถ้ายังไม่มีหลักฐาน ใช้ type: fleeting แทน`,
    );
  }
  const privacy = (args.privacy ?? "T0") as NoteMeta["privacy"];
  if (!PRIVACY_LEVELS.includes(privacy)) throw new Error(`privacy ต้องเป็น ${PRIVACY_LEVELS.join("/")}`);
  const id = newId();
  const now = isoNow();
  const meta: NoteMeta = {
    id, type, title: args.title, created: now, updated: now,
    aliases: args.aliases ?? [], tags: args.tags ?? [],
    domain: args.domain ?? "general", privacy, state: "active",
    links: [], evidence: args.evidence ?? [],
  };
  const filename = `${id} - ${slugify(args.title)}.md`;
  const abs = path.join(ROOT, "10_Notes", filename);
  writeFileSync(abs, serializeFrontmatter(meta) + "\n" + args.body + "\n", "utf8");
  appendManifest({ id, type, title: args.title, path: rel(abs), domain: meta.domain, privacy, created: now });
  if (meta.aliases.length > 0) {
    const aliases = readAliases(ROOT);
    for (const a of meta.aliases) aliases[a] = id;
    writeAliases(aliases);
  }
  // auto-link จาก wikilinks ใน body
  const manifest = readManifest(ROOT);
  const aliases = readAliases(ROOT);
  for (const target of extractWikilinks(args.body)) {
    let toId: string | undefined;
    if (manifest.has(target)) toId = target;
    else if (aliases[target]) toId = aliases[target];
    else {
      for (const r of manifest.values()) if (r.title === target) { toId = r.id; break; }
    }
    if (toId) {
      appendLink(ROOT, { from: id, to: toId, rel: "related" });
      appendLink(ROOT, { from: toId, to: id, rel: "related" });
      meta.links.push({ to: toId, rel: "related" });
    }
  }
  if (meta.links.length > 0) {
    writeFileSync(abs, serializeFrontmatter(meta) + "\n" + args.body + "\n", "utf8");
  }
  audit(ROOT, ACTOR, "brain_write_note", rel(abs), `type=${type} privacy=${privacy}`);
  return { ok: true, id, path: rel(abs), linked: meta.links.length };
}

function handleUpdateNote(args: {
  id_or_alias: string; title?: string; tags?: string[]; aliases?: string[];
  state?: string; add_links?: { to: string; rel?: string }[];
  add_evidence?: string[];
}): unknown {
  ensureBrain();
  const found = findNote(args.id_or_alias);
  if (!found) throw new Error(`ไม่พบโน้ต: ${args.id_or_alias}`);
  const { absPath, meta, body } = found;
  if (args.title) meta.title = args.title;
  if (args.tags) meta.tags = args.tags;
  if (args.aliases) {
    const aliases = readAliases(ROOT);
    for (const a of args.aliases) aliases[a] = meta.id;
    writeAliases(aliases);
    meta.aliases = [...new Set([...meta.aliases, ...args.aliases])];
  }
  if (args.state) {
    if (!NOTE_STATES.includes(args.state as never)) throw new Error(`state ต้องเป็น ${NOTE_STATES.join("/")}`);
    meta.state = args.state as NoteMeta["state"];
  }
  if (args.add_evidence) meta.evidence.push(...args.add_evidence);
  if (args.add_links) {
    const manifest = readManifest(ROOT);
    const aliases = readAliases(ROOT);
    for (const l of args.add_links) {
      let toId = l.to;
      if (!manifest.has(toId)) {
        const via = aliases[toId];
        if (via) toId = via;
      }
      if (!manifest.has(toId)) throw new Error(`ลิงก์ไปหา id ที่ไม่มีอยู่: ${l.to}`);
      const relv = l.rel ?? "related";
      appendLink(ROOT, { from: meta.id, to: toId, rel: relv });
      appendLink(ROOT, { from: toId, to: meta.id, rel: relv });
      meta.links.push({ to: toId, rel: relv });
    }
  }
  meta.updated = isoNow();
  writeFileSync(absPath, serializeFrontmatter(meta) + "\n" + body, "utf8");
  audit(ROOT, ACTOR, "brain_update_note", rel(absPath));
  return { ok: true, id: meta.id, path: rel(absPath) };
}

function handleRead(args: { id_or_alias: string }): unknown {
  ensureBrain();
  const found = findNote(args.id_or_alias);
  if (!found) throw new Error(`ไม่พบโน้ต: ${args.id_or_alias}`);
  enforceReadPrivacy(found.meta);
  return { id: found.meta.id, path: found.relPath, frontmatter: found.meta, body: found.body };
}

function handleSearch(args: { query: string; domain?: string; type?: string; include_private?: boolean }): unknown {
  ensureBrain();
  const q = args.query.toLowerCase();
  const manifest = readManifest(ROOT);
  const includePrivate = args.include_private === true;
  if (includePrivate) {
    audit(ROOT, ACTOR, "brain_search_include_private", "*", `query=${args.query}`);
  }
  const results: { id: string; title: string; type: string; domain: string; privacy: string; score: number }[] = [];
  for (const rec of manifest.values()) {
    if (!includePrivate && (rec.privacy === "T1" || rec.privacy === "T2")) continue;
    // T2 ไม่โผล่ใน search แม้ include_private=true จนกว่าป๊าจะอนุมัติเป็นรายใบ
    if (includePrivate && rec.privacy === "T2" && !isApproved(rec.id)) continue;
    if (args.domain && rec.domain !== args.domain) continue;
    if (args.type && rec.type !== args.type) continue;
    const abs = path.join(ROOT, rec.path);
    if (!existsSync(abs)) continue;
    const parsed = parseNoteFile(readFileSync(abs, "utf8"));
    const hay = `${rec.title}\n${parsed.meta.aliases.join(" ")}\n${parsed.meta.tags.join(" ")}\n${parsed.body}`.toLowerCase();
    if (hay.includes(q)) {
      let score = 1;
      if (rec.title.toLowerCase().includes(q)) score += 2;
      if (parsed.meta.aliases.some((a) => a.toLowerCase().includes(q))) score += 2;
      results.push({ id: rec.id, title: rec.title, type: rec.type, domain: rec.domain, privacy: rec.privacy, score });
    }
  }
  results.sort((a, b) => b.score - a.score);
  audit(ROOT, ACTOR, "brain_search", "*", `query=${args.query} hits=${results.length}`);
  return { ok: true, count: results.length, results };
}

function handleLink(args: { from_id: string; to_id: string; rel?: string }): unknown {
  ensureBrain();
  const manifest = readManifest(ROOT);
  if (!manifest.has(args.from_id)) throw new Error(`ไม่มี id: ${args.from_id}`);
  if (!manifest.has(args.to_id)) throw new Error(`ไม่มี id: ${args.to_id}`);
  const relv = args.rel ?? "related";
  appendLink(ROOT, { from: args.from_id, to: args.to_id, rel: relv });
  appendLink(ROOT, { from: args.to_id, to: args.from_id, rel: relv });
  for (const id of [args.from_id, args.to_id]) {
    const other = id === args.from_id ? args.to_id : args.from_id;
    const rec = manifest.get(id)!;
    const abs = path.join(ROOT, rec.path);
    if (existsSync(abs)) {
      const parsed = parseNoteFile(readFileSync(abs, "utf8"));
      parsed.meta.links.push({ to: other, rel: relv });
      parsed.meta.updated = isoNow();
      writeFileSync(abs, serializeFrontmatter(parsed.meta) + "\n" + parsed.body, "utf8");
    }
  }
  audit(ROOT, ACTOR, "brain_link", `${args.from_id} -> ${args.to_id}`, `rel=${relv}`);
  return { ok: true, from: args.from_id, to: args.to_id, rel: relv };
}

function handleResolve(args: { name: string }): unknown {
  ensureBrain();
  if (ID_RE.test(args.name)) {
    const manifest = readManifest(ROOT);
    if (manifest.has(args.name)) return { id: args.name, via: "id" };
  }
  const aliases = readAliases(ROOT);
  if (aliases[args.name]) return { id: aliases[args.name], via: "alias" };
  const manifest = readManifest(ROOT);
  for (const r of manifest.values()) {
    if (r.title === args.name) return { id: r.id, via: "title" };
  }
  const q = args.name.toLowerCase();
  const fuzzy: string[] = [];
  for (const [alias, id] of Object.entries(aliases)) {
    if (alias.toLowerCase().includes(q)) fuzzy.push(id);
  }
  for (const r of manifest.values()) {
    if (r.title.toLowerCase().includes(q)) fuzzy.push(r.id);
  }
  if (fuzzy.length === 0) throw new Error(`resolve ไม่เจอ: ${args.name}`);
  return { id: fuzzy[0], via: "fuzzy", candidates: [...new Set(fuzzy)] };
}

// ---------- pack provenance ----------
// .kb/packs.lock.json = { "<file>": "<sha256>" } — ป๊าเป็นคนสร้าง/แก้ด้วยมือเท่านั้น
// จับได้ว่า pack ถูกแก้หลังรีวิว แต่ไม่ได้พิสูจน์ว่า pack "ปลอดภัย" — การรีวิวเป็นของคน
type PackStatus = "verified" | "modified" | "unreviewed";
function readPacksLock(): Record<string, string> {
  const f = kbPath(ROOT, "packs.lock.json");
  if (!existsSync(f)) return {};
  try {
    return JSON.parse(readFileSync(f, "utf8")) as Record<string, string>;
  } catch {
    return {};
  }
}

interface PackInfo {
  file: string;
  name?: string;
  version?: string;
  privacy?: string;
  sha256: string;
  status: PackStatus;
}

function scanPacks(): PackInfo[] {
  const packsDir = kbPath(ROOT, "packs");
  const lock = readPacksLock();
  const packs: PackInfo[] = [];
  if (existsSync(packsDir)) {
    for (const f of readdirSync(packsDir).sort()) {
      if (!/\.ya?ml$/.test(f)) continue;
      const text = readFileSync(path.join(packsDir, f), "utf8");
      const grab = (key: string): string | undefined => {
        const m = new RegExp(`^${key}:\\s*["']?([^"'\\n]+?)["']?\\s*$`, "m").exec(text);
        return m?.[1];
      };
      const hash = sha256(text);
      const status: PackStatus = !(f in lock) ? "unreviewed" : lock[f] === hash ? "verified" : "modified";
      packs.push({ file: f, name: grab("name"), version: grab("version"), privacy: grab("privacy"), sha256: hash, status });
    }
  }
  return packs;
}

function handleListPacks(): unknown {
  ensureBrain();
  const packs = scanPacks();
  return { ok: true, count: packs.length, packs };
}

// ---------- nightly cycle (agent เรียกตอนเช้า/ก่อนนอน) ----------
function handleNightly(): unknown {
  ensureBrain();
  const manifest = readManifest(ROOT);
  // 1. fleeting queue: โน้ต fleeting ที่ยัง active (ยังไม่ถูกจัด) — agent เป็นคน classify ต่อ
  const queue: { id: string; title: string; created: string }[] = [];
  for (const rec of manifest.values()) {
    if (rec.type !== "fleeting" || rec.privacy === "T2") continue;
    const abs = path.join(ROOT, rec.path);
    if (!existsSync(abs)) continue;
    try {
      const parsed = parseNoteFile(readFileSync(abs, "utf8"));
      if (parsed.meta.state === "active") {
        queue.push({ id: rec.id, title: rec.title, created: rec.created });
      }
    } catch {
      // ข้ามไฟล์ที่ parse ไม่ได้
    }
  }
  // 2. regenerate Today.md (ผ่าน logic ของ brain_home)
  handleHome();
  // 3. health check ครบ (frontmatter + body links + packs)
  const health = handleHealth() as { notes: number; orphans: string[]; dead_links: string[]; dead_body_links: string[]; packs_unverified: string[] };
  // 4. snapshot ลง 99_System/snapshots/<วันที่>.json
  const snapDir = path.join(ROOT, "99_System", "snapshots");
  mkdirSync(snapDir, { recursive: true });
  const snapshot = {
    date: today(),
    notes: health.notes,
    orphans: health.orphans.length,
    dead_links: health.dead_links.length,
    dead_body_links: health.dead_body_links.length,
    packs_unverified: health.packs_unverified.length,
    fleeting_pending: queue.length,
  };
  const snapPath = path.join(snapDir, `${today()}.json`);
  writeFileSync(snapPath, JSON.stringify(snapshot, null, 2) + "\n", "utf8");
  audit(ROOT, ACTOR, "brain_nightly", `99_System/snapshots/${today()}.json`, `pending=${queue.length} notes=${health.notes}`);
  return { ok: true, fleeting_queue: queue, snapshot, snapshot_path: rel(snapPath) };
}

function handleHealth(): unknown {
  ensureBrain();
  const manifest = readManifest(ROOT);
  const linksFile = kbPath(ROOT, "links.jsonl");
  const known = new Set(manifest.keys());
  const connected = new Set<string>();
  const dead = new Set<string>();
  // จาก links.jsonl
  if (existsSync(linksFile)) {
    for (const line of readFileSync(linksFile, "utf8").split("\n")) {
      if (!line.trim()) continue;
      try {
        const l = JSON.parse(line) as { from: string; to: string; rel: string };
        if (!known.has(l.to)) dead.add(`${l.from} -> ${l.to} (${l.rel})`);
        else { connected.add(l.from); connected.add(l.to); }
      } catch { /* ข้ามบรรทัดพัง */ }
    }
  }
  const markConn = (a: string, b: string) => { connected.add(a); connected.add(b); };
  // จาก links ใน frontmatter ของแต่ละไฟล์
  for (const rec of manifest.values()) {
    const abs = path.join(ROOT, rec.path);
    if (!existsSync(abs)) continue;
    try {
      const parsed = parseNoteFile(readFileSync(abs, "utf8"));
      for (const l of parsed.meta.links) {
        if (!known.has(l.to)) dead.add(`${rec.id} -> ${l.to} (${l.rel})`);
        else markConn(rec.id, l.to);
      }
    } catch {
      // ข้ามไฟล์ที่ parse ไม่ได้
    }
  }
  // จาก wikilinks ใน body (10_Notes + 20_Atlas) — resolve ผ่าน id/alias/title
  // (ช่องโหว่เดิม: health มองไม่เห็น body links — link ในเนื้อโน้ตตายโดยไม่มีใครรู้)
  const aliases = readAliases(ROOT);
  const titles = new Map<string, string>();
  for (const rec of manifest.values()) titles.set(rec.title, rec.id);
  const resolveBodyTarget = (t: string): boolean =>
    known.has(t) || t in aliases || titles.has(t);
  const deadBody = new Set<string>();
  const bodyScanTargets: { file: string; dir: string }[] = [];
  for (const rec of manifest.values()) bodyScanTargets.push({ file: rec.path, dir: "" });
  const atlasDir = path.join(ROOT, "20_Atlas");
  if (existsSync(atlasDir)) {
    for (const f of readdirSync(atlasDir)) {
      if (f.endsWith(".md")) bodyScanTargets.push({ file: `20_Atlas/${f}`, dir: "" });
    }
  }
  const scanned = new Set<string>();
  for (const t of bodyScanTargets) {
    if (scanned.has(t.file)) continue;
    scanned.add(t.file);
    const abs = path.join(ROOT, t.file);
    if (!existsSync(abs)) continue;
    try {
      const parsed = parseNoteFile(readFileSync(abs, "utf8"));
      for (const target of extractBodyWikilinks(parsed.body)) {
        if (!resolveBodyTarget(target)) deadBody.add(`${t.file} -> [[${target}]]`);
      }
    } catch {
      // ข้ามไฟล์ที่ parse ไม่ได้
    }
  }
  const orphans: string[] = [];
  for (const id of known.keys()) {
    if (!connected.has(id)) orphans.push(id);
  }
  // packs ที่ยังไม่ผ่านรีวิว/ถูกแก้หลังรีวิว (provenance)
  const packsUnverified = scanPacks()
    .filter((p) => p.status !== "verified")
    .map((p) => `${p.file} (${p.status})`);
  const report: HealthReport = {
    checked_at: new Date().toISOString(),
    orphans: orphans.sort(),
    dead_links: [...dead].sort(),
    dead_body_links: [...deadBody].sort(),
    packs_unverified: packsUnverified.sort(),
    notes: known.size,
  };
  writeHealth(ROOT, report);
  audit(ROOT, ACTOR, "brain_health", ".kb/health.json", `notes=${report.notes} orphans=${orphans.length} dead=${dead.size} dead_body=${deadBody.size}`);
  return { ok: true, ...report };
}

function today(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

function handleHome(): unknown {
  ensureBrain();
  const manifest = readManifest(ROOT);
  const active: ManifestRecord[] = [];
  const recentFleeting: ManifestRecord[] = [];
  const cutoff = Date.now() - 24 * 3600 * 1000;
  for (const rec of manifest.values()) {
    if (rec.privacy === "T2") continue; // T2 ห้ามขึ้น Today.md ทุกประเภท
    if (rec.type === "fleeting") {
      const m = /^(\d{4})(\d{2})(\d{2})-(\d{2})(\d{2})(\d{2})/.exec(rec.id);
      if (m) {
        const t = new Date(
          Number(m[1]), Number(m[2]) - 1, Number(m[3]),
          Number(m[4]), Number(m[5]), Number(m[6]),
        ).getTime();
        if (t >= cutoff) recentFleeting.push(rec);
      }
      continue;
    }
    const abs = path.join(ROOT, rec.path);
    if (!existsSync(abs)) continue;
    try {
      const parsed = parseNoteFile(readFileSync(abs, "utf8"));
      // T2 ไม่ขึ้น Today.md — ชื่อโน้ตเปราะบางห้ามรั่วเข้า atlas ที่ agent อ่านประจำ
      if (parsed.meta.privacy === "T2") continue;
      if (parsed.meta.state === "active") active.push(rec);
    } catch {
      // ข้าม
    }
  }
  const homePath = path.join(ROOT, "20_Atlas", "Home.md");
  const home = existsSync(homePath) ? readFileSync(homePath, "utf8") : "";
  const lines: string[] = [
    `# Today — ${today()}`,
    "",
    `## Active notes (${active.length})`,
  ];
  for (const r of active) lines.push(`- [[${r.id}]] ${r.title} _(${r.type}/${r.domain})_`);
  lines.push("", `## Fleeting 24h (${recentFleeting.length})`);
  for (const r of recentFleeting) lines.push(`- [[${r.id}]] ${r.title}`);
  const todayContent = lines.join("\n") + "\n";
  const todayPath = path.join(ROOT, "20_Atlas", "Today.md");
  writeFileSync(todayPath + ".tmp", todayContent, "utf8");
  renameSync(todayPath + ".tmp", todayPath); // atomic write
  audit(ROOT, ACTOR, "brain_home", "20_Atlas/Today.md", `active=${active.length} fleeting24h=${recentFleeting.length}`);
  return { ok: true, home, today: todayContent };
}

function handleAudit(args: { last?: number }): unknown {
  ensureBrain();
  const f = kbPath(ROOT, "audit.jsonl");
  const n = args.last ?? 20;
  if (!existsSync(f)) return { ok: true, entries: [] };
  const lines = readFileSync(f, "utf8").split("\n").filter(Boolean);
  const tail = lines.slice(-n).map((l) => JSON.parse(l) as unknown);
  return { ok: true, count: tail.length, entries: tail };
}

// ---------- server ----------

const server = new McpServer({ name: "central-brain", version: "1.0.0" });

const tools: {
  name: string;
  description: string;
  schema: z.ZodRawShape;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  handler: (args: any) => unknown;
}[] = [
  {
    name: "brain_init",
    description: "สร้างโครงสร้างสมองใหม่ (idempotent — ถ้ามีแล้วไม่ทำซ้ำ ห้ามทำลายข้อมูล)",
    schema: {},
    handler: () => handleInit(),
  },
  {
    name: "brain_capture",
    description: "จดด่วนลง 00_Fleeting — เบาที่สุด ไม่ validate (ของเปล่า=ช่องโหว่ อย่าใช้เก็บของเปล่า)",
    schema: { text: z.string(), source: z.string().optional() },
    handler: handleCapture,
  },
  {
    name: "brain_write_note",
    description: "เขียนโน้ตถาวรลง 10_Notes — atomic/entity ต้องมี evidence≥1 (กฎเหล็ก)",
    schema: {
      title: z.string(), body: z.string(),
      type: z.enum(NOTE_TYPES), domain: z.string().optional(),
      privacy: z.enum(PRIVACY_LEVELS).optional(),
      tags: z.array(z.string()).optional(), aliases: z.array(z.string()).optional(),
      evidence: z.array(z.string()).optional(),
    },
    handler: handleWriteNote,
  },
  {
    name: "brain_update_note",
    description: "แก้ฟิลด์ที่ส่งเท่านั้น — ห้ามแก้ id/created; โน้ตไม่ย้ายตามสถานะ ย้ายคือฆ่า reference",
    schema: {
      id_or_alias: z.string(),
      title: z.string().optional(), tags: z.array(z.string()).optional(),
      aliases: z.array(z.string()).optional(),
      state: z.enum(NOTE_STATES).optional(),
      add_links: z.array(z.object({ to: z.string(), rel: z.string().optional() })).optional(),
      add_evidence: z.array(z.string()).optional(),
    },
    handler: handleUpdateNote,
  },
  {
    name: "brain_read",
    description: "อ่านโน้ต (frontmatter + body) — T1 ถูก audit ทุกครั้ง / T2 ต้องมีไฟล์อนุมัติจากป๊าที่ .kb/approvals/<id>.json ก่อน ไม่งั้นถูกบล็อก",
    schema: { id_or_alias: z.string() },
    handler: handleRead,
  },
  {
    name: "brain_search",
    description: "ค้นจาก title/aliases/tags/body — default ไม่คืน T1/T2 (include_private=true คืน T1 และถูก audit / T2 ไม่คืนจนกว่าป๊าจะอนุมัติที่ .kb/approvals/<id>.json)",
    schema: {
      query: z.string(), domain: z.string().optional(), type: z.string().optional(),
      include_private: z.boolean().optional(),
    },
    handler: handleSearch,
  },
  {
    name: "brain_link",
    description: "สร้างลิงก์สองทิศระหว่างสอง id + append links.jsonl (เช็ค id มีจริงก่อน)",
    schema: { from_id: z.string(), to_id: z.string(), rel: z.string().optional() },
    handler: handleLink,
  },
  {
    name: "brain_resolve",
    description: "คืน id จาก alias/title (exact ก่อน → fuzzy contains)",
    schema: { name: z.string() },
    handler: handleResolve,
  },
  {
    name: "brain_list_packs",
    description: "list domain packs ใน .kb/packs + provenance status (verified/modified/unreviewed เทียบ .kb/packs.lock.json ที่ป๊าล็อกด้วยมือ)",
    schema: {},
    handler: () => handleListPacks(),
  },
  {
    name: "brain_health",
    description: "คำนวณ orphans/dead_links (links.jsonl + frontmatter links) เขียน health.json",
    schema: {},
    handler: () => handleHealth(),
  },
  {
    name: "brain_home",
    description: "คืน Home.md + Today.md (รีเฟรช Today จาก active notes + fleeting 24h, atomic write)",
    schema: {},
    handler: () => handleHome(),
  },
  {
    name: "brain_nightly",
    description: "วงจรกลางคืน: คืน fleeting queue ที่ยังไม่จัด + regenerate Today.md + health ครบ + snapshot ลง 99_System/snapshots — agent เรียกตอนเช้า/ก่อนนอน แล้วใช้ queue classify ต่อด้วย brain_write_note",
    schema: {},
    handler: () => handleNightly(),
  },
  {
    name: "brain_audit",
    description: "คืน audit log ล่าสุด N รายการ",
    schema: { last: z.number().optional() },
    handler: handleAudit,
  },
];

for (const t of tools) {
  server.registerTool(
    t.name,
    { description: t.description, inputSchema: t.schema },
    async (args) => {
      try {
        return ok(t.handler(args));
      } catch (err) {
        return fail(err instanceof Error ? err.message : String(err));
      }
    },
  );
}

const transport = new StdioServerTransport();
await server.connect(transport);
console.error(`central-brain MCP ready — root: ${ROOT}`);
