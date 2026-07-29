#!/usr/bin/env node
/**
 * Central Brain MCP Server (v1.2.1)
 * stdio transport — local filesystem ล้วน ห้าม network call
 * กฎเหล็ก: ไม่มี delete / atomic+entity ต้องมี evidence≥1 /
 * search default ไม่คืน T1,T2 / read: T1 audit ทุกครั้ง, T2 ต้องมี approval จากป๊า
 * (.kb/approvals/<id>.json สร้างด้วยมือเท่านั้น — agent อนุมัติตัวเองไม่ได้) /
 * health สแกน body wikilinks ด้วย / ทุก mutation audit
 */

import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, writeFileSync } from "node:fs";
import path from "node:path";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import {
  NOTE_TYPES,
  PRIVACY_LEVELS,
  NOTE_STATES,
  genId,
  sanitizeSlug,
  serializeNote,
  parseNoteFile,
  today,
  type NoteMeta,
  type NoteType,
  type Privacy,
  type NoteState,
  type NoteLink,
  type ParsedNote,
} from "./schema.js";
import {
  audit,
  brainRoot,
  appendLink,
  initBrain,
  isInitialized,
  kbPath,
  readAliases,
  readAudit,
  readLinks,
  readManifest,
  sha256,
  upsertManifest,
  writeAliases,
  writeHealth,
  type HealthReport,
  type ManifestRecord,
} from "./kernel.js";

const ROOT = brainRoot();
const ACTOR = process.env.CENTRAL_BRAIN_ACTOR ?? "central-brain-mcp";

// ---------- helpers ----------

function ok(result: unknown): { content: { type: "text"; text: string }[] } {
  return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
}

function fail(message: string): { isError: true; content: { type: "text"; text: string }[] } {
  return { isError: true, content: [{ type: "text", text: JSON.stringify({ error: message }, null, 2) }] };
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

function rel(p: string): string {
  return path.relative(ROOT, p).split(path.sep).join("/");
}

/** เขียนไฟล์แบบ atomic — tmp+rename กัน crash กลางเขียนแล้วโน้ตพัง (กฎ: ห้ามทำลายข้อมูล) */
function atomicWrite(abs: string, content: string): void {
  const tmp = `${abs}.tmp-${process.pid}`;
  writeFileSync(tmp, content, "utf8");
  renameSync(tmp, abs);
}

function noteRelPath(subdir: string, meta: NoteMeta, withSlug: boolean): string {
  const name = withSlug ? `${meta.id} - ${sanitizeSlug(meta.title)}.md` : `${meta.id}.md`;
  return `${subdir}/${name}`;
}

function saveNote(subdir: string, meta: NoteMeta, body: string, withSlug: boolean): string {
  const relPath = noteRelPath(subdir, meta, withSlug);
  const abs = path.join(ROOT, relPath);
  const content = serializeNote({ meta, body });
  atomicWrite(abs, content);
  upsertManifest(ROOT, {
    id: meta.id,
    path: relPath,
    type: meta.type,
    title: meta.title,
    domain: meta.domain,
    privacy: meta.privacy,
    created: meta.created,
    updated: meta.updated,
    sha256: sha256(content),
  });
  return relPath;
}

function resolveId(idOrAlias: string): string {
  const aliases = readAliases(ROOT);
  return aliases[idOrAlias] ?? idOrAlias;
}

/** หาโน้ตจาก id (รองรับ alias) — คืน {meta, body, relPath} หรือ null */
function findNote(idOrAlias: string): (ParsedNote & { relPath: string }) | null {
  const id = resolveId(idOrAlias);
  const manifest = readManifest(ROOT);
  const rec = manifest.get(id);
  if (rec) {
    const abs = path.join(ROOT, rec.path);
    if (existsSync(abs)) {
      const parsed = parseNoteFile(readFileSync(abs, "utf8"));
      return { ...parsed, relPath: rec.path };
    }
  }
  // fallback: scan โฟลเดอร์โน้ตจากชื่อไฟล์
  for (const dir of ["10_Notes", "00_Fleeting", "20_Atlas", "30_Sources"]) {
    const full = path.join(ROOT, dir);
    if (!existsSync(full)) continue;
    for (const f of readdirSync(full)) {
      if (f.startsWith(id) && f.endsWith(".md")) {
        const relPath = `${dir}/${f}`;
        const parsed = parseNoteFile(readFileSync(path.join(full, f), "utf8"));
        return { ...parsed, relPath };
      }
    }
  }
  return null;
}

function registerAliases(meta: NoteMeta): void {
  if (meta.aliases.length === 0) return;
  const aliases = readAliases(ROOT);
  let changed = false;
  for (const a of meta.aliases) {
    if (aliases[a] !== meta.id) {
      aliases[a] = meta.id;
      changed = true;
    }
  }
  if (changed) writeAliases(ROOT, aliases);
}

function normalizeLinks(input: unknown): NoteLink[] {
  if (!Array.isArray(input)) return [];
  const out: NoteLink[] = [];
  for (const item of input) {
    if (typeof item === "string") out.push({ to: item, rel: "related" });
    else if (item && typeof item === "object") {
      const o = item as Record<string, unknown>;
      if (typeof o.to === "string") out.push({ to: o.to, rel: typeof o.rel === "string" ? o.rel : "related" });
    }
  }
  return out;
}

function normalizeStringArray(input: unknown): string[] {
  if (!Array.isArray(input)) return [];
  return input.filter((x): x is string => typeof x === "string");
}

function getString(args: Record<string, unknown>, key: string): string | undefined {
  const v = args[key];
  return typeof v === "string" ? v : undefined;
}

// ---------- tool handlers ----------

function handleInit(): unknown {
  const { created, root } = initBrain(ROOT);
  audit(ROOT, ACTOR, "brain_init", root, `created=${created.length} items`);
  return { ok: true, root, created, already_existed: created.length === 0 };
}

function handleCapture(args: Record<string, unknown>): unknown {
  ensureBrain();
  const text = getString(args, "text");
  if (!text) throw new Error("text ห้ามว่าง");
  const domain = getString(args, "domain") ?? "general";
  const now = today();
  const meta: NoteMeta = {
    id: genId(),
    type: "fleeting",
    title: text.split(/\r?\n/)[0]?.slice(0, 80) ?? "fleeting",
    created: now,
    updated: now,
    aliases: [],
    tags: [],
    domain,
    privacy: "T0",
    state: "active",
    links: [],
    evidence: [],
  };
  const relPath = saveNote("00_Fleeting", meta, text, false);
  audit(ROOT, ACTOR, "brain_capture", meta.id, `path=${relPath} domain=${domain}`);
  return { ok: true, id: meta.id, path: relPath };
}

function handleWriteNote(args: Record<string, unknown>): unknown {
  ensureBrain();
  const title = getString(args, "title");
  const body = getString(args, "body") ?? "";
  const type = getString(args, "type") as NoteType | undefined;
  if (!title) throw new Error("title ห้ามว่าง");
  if (!type || !(NOTE_TYPES as readonly string[]).includes(type)) {
    throw new Error(`type ต้องเป็น ${NOTE_TYPES.join("|")}`);
  }
  const evidence = normalizeStringArray(args.evidence);
  // กฎ 3.1: atomic/entity ต้องมี evidence ≥ 1 ไม่ใช่ fleeting
  if ((type === "atomic" || type === "entity") && evidence.length < 1) {
    throw new Error(
      `กฎเหล็ก: โน้ต type=${type} ต้องมี evidence อย่างน้อย 1 ข้อ — ` +
        `ถ้ายังไม่มีหลักฐานให้ใช้ type: "fleeting" หรือแนบ evidence มาด้วย`,
    );
  }
  const privacy = (getString(args, "privacy") ?? "T0") as Privacy;
  if (!(PRIVACY_LEVELS as readonly string[]).includes(privacy)) {
    throw new Error(`privacy ต้องเป็น ${PRIVACY_LEVELS.join("|")}`);
  }
  const now = today();
  const meta: NoteMeta = {
    id: genId(),
    type,
    title,
    created: now,
    updated: now,
    aliases: normalizeStringArray(args.aliases),
    tags: normalizeStringArray(args.tags),
    domain: getString(args, "domain") ?? "general",
    privacy,
    state: "active",
    links: normalizeLinks(args.links),
    evidence,
  };
  const warnings: string[] = [];
  const lt = title.trim().toLowerCase();
  if (lt.startsWith("สรุป") || lt.startsWith("notes on")) {
    warnings.push(`title "${title}" ดูไม่ใช่แนวคิด — โน้ตถาวรควรตั้งชื่อเป็นแนวคิด/ข้อเสนอ ไม่ใช่ "สรุป..." หรือ "notes on..."`);
  }
  const relPath = saveNote("10_Notes", meta, body, true);
  registerAliases(meta);
  audit(ROOT, ACTOR, "brain_write_note", meta.id, `type=${type} path=${relPath}`);
  return { ok: true, id: meta.id, path: relPath, warnings };
}

function handleUpdateNote(args: Record<string, unknown>): unknown {
  ensureBrain();
  const idArg = getString(args, "id");
  if (!idArg) throw new Error("ต้องระบุ id");
  const found = findNote(idArg);
  if (!found) throw new Error(`ไม่พบโน้ต id=${idArg}`);
  const { meta, relPath } = found;
  let body = found.body;

  // ห้ามแก้ id/created — ไม่มีฟิลด์เหล่านั้นใน input schema เลย
  if (typeof args.body === "string") body = args.body;
  const newTitle = getString(args, "title");
  if (newTitle) meta.title = newTitle;
  const newTags = args.tags !== undefined ? normalizeStringArray(args.tags) : undefined;
  if (newTags) meta.tags = newTags;
  const newAliases = args.aliases !== undefined ? normalizeStringArray(args.aliases) : undefined;
  if (newAliases) meta.aliases = newAliases;
  const newState = getString(args, "state") as NoteState | undefined;
  if (newState) {
    if (!(NOTE_STATES as readonly string[]).includes(newState)) {
      throw new Error(`state ต้องเป็น ${NOTE_STATES.join("|")}`);
    }
    meta.state = newState;
  }
  const addLinks = normalizeLinks(args.add_links);
  for (const l of addLinks) {
    if (!meta.links.some((x) => x.to === l.to && x.rel === l.rel)) meta.links.push(l);
  }
  const addEvidence = normalizeStringArray(args.add_evidence);
  for (const e of addEvidence) {
    if (!meta.evidence.includes(e)) meta.evidence.push(e);
  }
  meta.updated = today();

  const oldAbs = path.join(ROOT, relPath);
  const newRel = noteRelPath(relPath.split("/")[0] ?? "10_Notes", meta, !relPath.startsWith("00_Fleeting"));
  const content = serializeNote({ meta, body });
  atomicWrite(oldAbs, content);
  let finalRel = relPath;
  if (newRel !== relPath) {
    renameSync(oldAbs, path.join(ROOT, newRel)); // rename เมื่อ title เปลี่ยน — id คงเดิม
    finalRel = newRel;
  }
  upsertManifest(ROOT, {
    id: meta.id,
    path: finalRel,
    type: meta.type,
    title: meta.title,
    domain: meta.domain,
    privacy: meta.privacy,
    created: meta.created,
    updated: meta.updated,
    sha256: sha256(content),
  });
  registerAliases(meta);
  audit(ROOT, ACTOR, "brain_update_note", meta.id, `path=${finalRel}`);
  return { ok: true, id: meta.id, path: finalRel, updated: meta.updated };
}

function handleRead(args: Record<string, unknown>): unknown {
  ensureBrain();
  const idOrAlias = getString(args, "id_or_alias");
  if (!idOrAlias) throw new Error("ต้องระบุ id_or_alias");
  const found = findNote(idOrAlias);
  if (!found) throw new Error(`ไม่พบโน้ต: ${idOrAlias}`);
  enforceReadPrivacy(found.meta);
  return { id: found.meta.id, path: found.relPath, frontmatter: found.meta, body: found.body };
}

interface SearchHit {
  id: string;
  title: string;
  type: string;
  domain: string;
  privacy: string;
  path: string;
  snippet: string;
}

function handleSearch(args: Record<string, unknown>): unknown {
  ensureBrain();
  const query = (getString(args, "query") ?? "").toLowerCase();
  const domain = getString(args, "domain");
  const type = getString(args, "type");
  const tag = getString(args, "tag")?.toLowerCase();
  const includePrivate = args.include_private === true;

  // privacy filter (กฎข้อ 6): default ไม่คืน T1/T2
  if (includePrivate) {
    audit(ROOT, ACTOR, "brain_search_include_private", "*", `query=${query} domain=${domain ?? ""}`);
  }
  const manifest = readManifest(ROOT);
  const hits: SearchHit[] = [];
  for (const rec of manifest.values()) {
    if (!includePrivate && (rec.privacy === "T1" || rec.privacy === "T2")) continue;
    // T2 ไม่โผล่ใน search แม้ include_private=true จนกว่าป๊าจะอนุมัติเป็นรายใบ
    if (includePrivate && rec.privacy === "T2" && !isApproved(rec.id)) continue;
    if (domain && rec.domain !== domain) continue;
    if (type && rec.type !== type) continue;
    const abs = path.join(ROOT, rec.path);
    if (!existsSync(abs)) continue;
    let parsed: ParsedNote;
    try {
      parsed = parseNoteFile(readFileSync(abs, "utf8"));
    } catch {
      continue;
    }
    if (tag && !parsed.meta.tags.some((t) => t.toLowerCase() === tag)) continue;
    let snippet = "";
    if (query) {
      const inTitle = parsed.meta.title.toLowerCase().includes(query);
      const inAliases = parsed.meta.aliases.some((a) => a.toLowerCase().includes(query));
      const inTags = parsed.meta.tags.some((t) => t.toLowerCase().includes(query));
      const bodyIdx = parsed.body.toLowerCase().indexOf(query);
      if (!inTitle && !inAliases && !inTags && bodyIdx < 0) continue;
      if (bodyIdx >= 0) {
        const start = Math.max(0, bodyIdx - 40);
        snippet = parsed.body.slice(start, bodyIdx + 80).replace(/\s+/g, " ").trim();
      } else {
        snippet = parsed.body.slice(0, 120).replace(/\s+/g, " ").trim();
      }
    } else {
      snippet = parsed.body.slice(0, 120).replace(/\s+/g, " ").trim();
    }
    hits.push({
      id: rec.id,
      title: parsed.meta.title,
      type: rec.type,
      domain: rec.domain,
      privacy: rec.privacy,
      path: rec.path,
      snippet,
    });
  }
  return { ok: true, count: hits.length, include_private: includePrivate, results: hits };
}

function handleLink(args: Record<string, unknown>): unknown {
  ensureBrain();
  const fromArg = getString(args, "from_id");
  const toArg = getString(args, "to_id");
  if (!fromArg || !toArg) throw new Error("ต้องระบุ from_id และ to_id");
  const rel = getString(args, "rel") ?? "related";
  const fromNote = findNote(fromArg);
  const toNote = findNote(toArg);
  if (!fromNote) throw new Error(`ไม่พบโน้ต from: ${fromArg}`);
  if (!toNote) throw new Error(`ไม่พบโน้ต to: ${toArg}`);
  const fromId = fromNote.meta.id;
  const toId = toNote.meta.id;

  // dedup links.jsonl — ลิงก์เดิม (from/to/rel ทั้งสองทิศ) ไม่ append ซ้ำ
  const dup = readLinks(ROOT).some(
    (l) => (l.from === fromId && l.to === toId && l.rel === rel) || (l.from === toId && l.to === fromId && l.rel === rel),
  );
  if (!dup) appendLink(ROOT, { from: fromId, to: toId, rel, created: today(), by: ACTOR });

  // อัพเดท links ในไฟล์ทั้งสองใบ
  for (const [note, targetId] of [
    [fromNote, toId],
    [toNote, fromId],
  ] as const) {
    if (!note.meta.links.some((l) => l.to === targetId && l.rel === rel)) {
      note.meta.links.push({ to: targetId, rel });
    }
    note.meta.updated = today();
    const abs = path.join(ROOT, note.relPath);
    const content = serializeNote({ meta: note.meta, body: note.body });
    atomicWrite(abs, content);
    upsertManifest(ROOT, {
      id: note.meta.id,
      path: note.relPath,
      type: note.meta.type,
      title: note.meta.title,
      domain: note.meta.domain,
      privacy: note.meta.privacy,
      created: note.meta.created,
      updated: note.meta.updated,
      sha256: sha256(content),
    });
  }
  audit(ROOT, ACTOR, "brain_link", `${fromId} -> ${toId}`, `rel=${rel}`);
  return { ok: true, from: fromId, to: toId, rel, deduped: dup };
}

function handleResolve(args: Record<string, unknown>): unknown {
  ensureBrain();
  const name = getString(args, "name");
  if (!name) throw new Error("ต้องระบุ name");
  // 1. alias exact
  const aliases = readAliases(ROOT);
  if (aliases[name]) {
    return { ok: true, id: aliases[name], via: "alias_exact" };
  }
  const manifest = readManifest(ROOT);
  // 2. title exact
  for (const rec of manifest.values()) {
    if (rec.title === name) return { ok: true, id: rec.id, via: "title_exact" };
  }
  // 3. fuzzy contains (alias ก่อน แล้ว title)
  const needle = name.toLowerCase();
  const matches: { id: string; matched: string; via: string }[] = [];
  for (const [alias, id] of Object.entries(aliases)) {
    if (alias.toLowerCase().includes(needle)) matches.push({ id, matched: alias, via: "alias_fuzzy" });
  }
  for (const rec of manifest.values()) {
    if (rec.title.toLowerCase().includes(needle)) matches.push({ id: rec.id, matched: rec.title, via: "title_fuzzy" });
  }
  if (matches.length === 0) return { ok: false, error: `ไม่พบ "${name}"`, matches: [] };
  return { ok: true, id: matches[0]?.id, via: matches[0]?.via, matches };
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
  const known = new Set(manifest.keys());
  const connected = new Map<string, boolean>();
  const dead = new Set<string>();

  const markConn = (a: string, b: string) => {
    if (known.has(a)) connected.set(a, true);
    if (known.has(b)) connected.set(b, true);
  };
  // จาก links.jsonl
  for (const l of readLinks(ROOT)) {
    if (!known.has(l.to)) dead.add(`${l.from} -> ${l.to} (${l.rel})`);
    else markConn(l.from, l.to);
  }
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
  // fleeting ที่ยังไม่ลิงก์ไม่นับ orphan — inbox ค้างเป็นเรื่องปกติ ไม่ใช่ปัญหาโครงสร้าง
  const fleetingIds = new Set<string>();
  for (const rec of manifest.values()) if (rec.type === "fleeting") fleetingIds.add(rec.id);
  const orphans: string[] = [];
  let orphansFleeting = 0;
  for (const id of known.keys()) {
    if (connected.has(id)) continue;
    if (fleetingIds.has(id)) orphansFleeting++;
    else orphans.push(id);
  }
  // packs ที่ยังไม่ผ่านรีวิว/ถูกแก้หลังรีวิว (provenance)
  const packsUnverified = scanPacks()
    .filter((p) => p.status !== "verified")
    .map((p) => `${p.file} (${p.status})`);
  const report: HealthReport = {
    checked_at: new Date().toISOString(),
    orphans: orphans.sort(),
    orphans_fleeting: orphansFleeting,
    dead_links: [...dead].sort(),
    dead_body_links: [...deadBody].sort(),
    packs_unverified: packsUnverified.sort(),
    notes: known.size,
  };
  writeHealth(ROOT, report);
  audit(ROOT, ACTOR, "brain_health", ".kb/health.json", `notes=${report.notes} orphans=${orphans.length} dead=${dead.size} dead_body=${deadBody.size}`);
  return { ok: true, ...report };
}

function handleHome(): unknown {
  ensureBrain();
  const homePath = path.join(ROOT, "20_Atlas", "Home.md");
  const todayPath = path.join(ROOT, "20_Atlas", "Today.md");
  const home = existsSync(homePath) ? readFileSync(homePath, "utf8") : "";

  // รีเฟรช Today.md: โน้ต state:active + fleeting 24h ล่าสุด
  const manifest = readManifest(ROOT);
  const cutoff = Date.now() - 24 * 60 * 60 * 1000;
  const active: ManifestRecord[] = [];
  const recentFleeting: ManifestRecord[] = [];
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
  const lines: string[] = [
    `# Today — ${today()}`,
    "",
    `## Active notes (${active.length})`,
  ];
  for (const r of active) lines.push(`- [[${r.id}]] ${r.title} _(${r.type}/${r.domain})_`);
  if (active.length === 0) lines.push("- (ยังไม่มี)");
  lines.push("", `## Fleeting 24h ล่าสุด (${recentFleeting.length})`);
  for (const r of recentFleeting) lines.push(`- [[${r.id}]] ${r.title}`);
  if (recentFleeting.length === 0) lines.push("- (ไม่มี)");
  lines.push("");
  const todayContent = lines.join("\n");
  atomicWrite(todayPath, todayContent);
  return { ok: true, home, today: todayContent };
}

function handleAudit(args: Record<string, unknown>): unknown {
  ensureBrain();
  const rawLimit = args.limit;
  const limit = typeof rawLimit === "number" && Number.isFinite(rawLimit) && rawLimit > 0 ? Math.floor(rawLimit) : 20;
  const all = readAudit(ROOT);
  return { ok: true, count: Math.min(limit, all.length), entries: all.slice(-limit) };
}

// ---------- tool schemas ----------

const TOOLS = [
  {
    name: "brain_init",
    description: "สร้างโครงสร้างโฟลเดอร์ Central Brain + ไฟล์ kernel เปล่า + skeleton packs + Home.md/Today.md",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
  },
  {
    name: "brain_capture",
    description: "จดด่วนลง 00_Fleeting (เบาที่สุด ไม่ validate)",
    inputSchema: {
      type: "object",
      properties: {
        text: { type: "string", description: "ข้อความที่จะจด" },
        domain: { type: "string", description: "domain (default: general)" },
      },
      required: ["text"],
      additionalProperties: false,
    },
  },
  {
    name: "brain_write_note",
    description: "เขียนโน้ตถาวรลง 10_Notes — atomic/entity ต้องมี evidence ≥ 1",
    inputSchema: {
      type: "object",
      properties: {
        title: { type: "string" },
        body: { type: "string" },
        type: { type: "string", enum: [...NOTE_TYPES] },
        domain: { type: "string" },
        tags: { type: "array", items: { type: "string" } },
        aliases: { type: "array", items: { type: "string" } },
        privacy: { type: "string", enum: [...PRIVACY_LEVELS] },
        links: {
          type: "array",
          items: {
            anyOf: [
              { type: "string" },
              {
                type: "object",
                properties: { to: { type: "string" }, rel: { type: "string" } },
                required: ["to"],
              },
            ],
          },
        },
        evidence: { type: "array", items: { type: "string" } },
      },
      required: ["title", "body", "type"],
      additionalProperties: false,
    },
  },
  {
    name: "brain_update_note",
    description: "แก้เฉพาะฟิลด์ที่ส่งของโน้ต (ห้ามแก้ id/created)",
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "string" },
        body: { type: "string" },
        title: { type: "string" },
        tags: { type: "array", items: { type: "string" } },
        aliases: { type: "array", items: { type: "string" } },
        state: { type: "string", enum: [...NOTE_STATES] },
        add_links: {
          type: "array",
          items: {
            anyOf: [
              { type: "string" },
              {
                type: "object",
                properties: { to: { type: "string" }, rel: { type: "string" } },
                required: ["to"],
              },
            ],
          },
        },
        add_evidence: { type: "array", items: { type: "string" } },
      },
      required: ["id"],
      additionalProperties: false,
    },
  },
  {
    name: "brain_read",
    description: "อ่านโน้ต (frontmatter + body) — T1 ถูก audit ทุกครั้ง / T2 ต้องมีไฟล์อนุมัติจากป๊าที่ .kb/approvals/<id>.json ก่อน ไม่งั้นถูกบล็อก",
    inputSchema: {
      type: "object",
      properties: { id_or_alias: { type: "string" } },
      required: ["id_or_alias"],
      additionalProperties: false,
    },
  },
  {
    name: "brain_search",
    description: "ค้นจาก title/aliases/tags/body — default ไม่คืน T1/T2 (include_private=true คืน T1 และถูก audit / T2 ไม่คืนจนกว่าป๊าจะอนุมัติที่ .kb/approvals/<id>.json)",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string" },
        domain: { type: "string" },
        type: { type: "string" },
        tag: { type: "string" },
        include_private: { type: "boolean" },
      },
      additionalProperties: false,
    },
  },
  {
    name: "brain_link",
    description: "สร้างลิงก์สองทิศระหว่างโน้ต + append links.jsonl",
    inputSchema: {
      type: "object",
      properties: {
        from_id: { type: "string" },
        to_id: { type: "string" },
        rel: { type: "string" },
      },
      required: ["from_id", "to_id"],
      additionalProperties: false,
    },
  },
  {
    name: "brain_resolve",
    description: "คืน id ที่ match alias/title (exact ก่อน แล้ว fuzzy contains)",
    inputSchema: {
      type: "object",
      properties: { name: { type: "string" } },
      required: ["name"],
      additionalProperties: false,
    },
  },
  {
    name: "brain_list_packs",
    description: "list domain packs ใน .kb/packs + provenance status (verified/modified/unreviewed เทียบ .kb/packs.lock.json ที่ป๊าล็อกด้วยมือ)",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
  },
  {
    name: "brain_health",
    description: "คำนวณ orphans/dead_links เขียน health.json + คืนผล",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
  },
  {
    name: "brain_home",
    description: "คืน Home.md + Today.md (รีเฟรช Today จาก active notes + fleeting 24h)",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
  },
  {
    name: "brain_nightly",
    description: "วงจรกลางคืน: คืน fleeting queue ที่ยังไม่จัด + regenerate Today.md + health ครบ + snapshot ลง 99_System/snapshots — agent เรียกตอนเช้า/ก่อนนอน แล้วใช้ queue classify ต่อด้วย brain_write_note",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
  },
  {
    name: "brain_audit",
    description: "คืน audit log ล่าสุด N รายการ",
    inputSchema: {
      type: "object",
      properties: { limit: { type: "number" } },
      additionalProperties: false,
    },
  },
] as const;

// ---------- server ----------

const server = new Server(
  { name: "central-brain-mcp-server", version: "1.0.0" },
  { capabilities: { tools: {} } },
);

server.setRequestHandler(ListToolsRequestSchema, () => ({ tools: [...TOOLS] }));

server.setRequestHandler(CallToolRequestSchema, (request) => {
  const { name, arguments: args = {} } = request.params;
  try {
    switch (name) {
      case "brain_init": return ok(handleInit());
      case "brain_capture": return ok(handleCapture(args));
      case "brain_write_note": return ok(handleWriteNote(args));
      case "brain_update_note": return ok(handleUpdateNote(args));
      case "brain_read": return ok(handleRead(args));
      case "brain_search": return ok(handleSearch(args));
      case "brain_link": return ok(handleLink(args));
      case "brain_resolve": return ok(handleResolve(args));
      case "brain_list_packs": return ok(handleListPacks());
      case "brain_health": return ok(handleHealth());
      case "brain_home": return ok(handleHome());
      case "brain_nightly": return ok(handleNightly());
      case "brain_audit": return ok(handleAudit(args));
      default: return fail(`ไม่รู้จัก tool: ${name}`);
    }
  } catch (err) {
    return fail(err instanceof Error ? err.message : String(err));
  }
});

async function main(): Promise<void> {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error(`central-brain-mcp-server ready (root=${ROOT})`);
}

main().catch((err) => {
  console.error("fatal:", err);
  process.exit(1);
});
