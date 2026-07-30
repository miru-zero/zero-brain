/**
 * kernel.ts — low-level ops ของ Zero Brain
 * - append-only JSONL ทุกไฟล์ (manifest/links/audit) — เขียนทับห้ามเด็ดขาด
 * - upsertManifest(note): ถ้ามี id เดิม → append record ใหม่ (ตัวล่าสุดชนะตอนอ่าน)
 * - readManifest(): load ทั้งหมดแล้ว reduce เป็นตัวล่าสุดต่อ id
 * - audit() ทุก mutation ต้องถูก log
 * - local filesystem ล้วน ห้าม network call
 */

import { createCipheriv, createDecipheriv, createHash, randomBytes, scryptSync } from "node:crypto";
import {
  appendFileSync,
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  readdirSync,
  renameSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

export interface ManifestRecord {
  id: string;
  path: string;
  type: string;
  title: string;
  domain: string;
  privacy: string;
  created: string;
  updated: string;
  sha256: string;
}

export interface LinkRecord {
  from: string;
  to: string;
  rel: string;
  created: string;
  by: string;
}

export interface AuditRecord {
  ts: string;
  actor: string;
  action: string;
  target: string;
  detail: string;
}

export interface HealthReport {
  checked_at: string;
  orphans: string[];
  orphans_fleeting: number;
  dead_links: string[];
  dead_body_links: string[];
  packs_unverified: string[];
  notes: number;
  /** จำนวนบรรทัดที่ parse ไม่ได้ใน JSONL แต่ละไฟล์ — >0 แปลว่าไฟล์เริ่มเสีย (เคยถูกเขียนชน/ดิสก์มีปัญหา) */
  corrupt_lines: { manifest: number; links: number; audit: number };
}

export const KB_DIRS = [
  ".kb/packs",
  ".kb/approvals",
  "00_Fleeting",
  "10_Notes",
  "20_Atlas",
  "30_Sources",
  "40_Templates/base",
  "99_System/snapshots",
] as const;

export function defaultBrainRoot(): string {
  // บ้านหลักของสมองตั้งแต่ v2.1.0 — ถ้าไม่ตั้ง env จะสร้าง/ใช้ที่นี่ที่เดียว
  return path.join(homedir(), ".zero", "brain");
}

export function brainRoot(): string {
  // ZERO_BRAIN_ROOT เป็นชื่อหลักตั้งแต่ v2.0.1 — CENTRAL_BRAIN_ROOT ยังใช้ได้ (fallback)
  const root = process.env.ZERO_BRAIN_ROOT ?? process.env.CENTRAL_BRAIN_ROOT ?? defaultBrainRoot();
  return path.resolve(root);
}

export function kbPath(root: string, ...parts: string[]): string {
  return path.join(root, ".kb", ...parts);
}

export function sha256(content: string): string {
  return createHash("sha256").update(content, "utf8").digest("hex");
}

function isoNow(): string {
  return new Date().toISOString();
}

// ---------- JSONL (append-only) ----------

export function appendJsonl(file: string, record: unknown): void {
  appendFileSync(file, JSON.stringify(record) + "\n", "utf8");
}

export interface JsonlStats<T> {
  records: T[];
  /** บรรทัดไม่ว่างที่ JSON.parse ไม่ได้ — สัญญาณไฟล์เสีย */
  corrupt: number;
}

export function readJsonlStats<T>(file: string): JsonlStats<T> {
  if (!existsSync(file)) return { records: [], corrupt: 0 };
  const text = readFileSync(file, "utf8");
  const records: T[] = [];
  let corrupt = 0;
  for (const line of text.split(/\r?\n/)) {
    const t = line.trim();
    if (t.length === 0) continue;
    try {
      records.push(JSON.parse(t) as T);
    } catch {
      corrupt++; // นับไว้รายงานใน health — เดิมข้ามเงียบ ทำให้ไฟล์เสียโดยไม่มีใครรู้
    }
  }
  return { records, corrupt };
}

export function readJsonl<T>(file: string): T[] {
  return readJsonlStats<T>(file).records;
}

/** นับบรรทัดเสียของ JSONL kernel ทั้งสาม — ใช้ใน zero_health */
export function corruptLineCounts(root: string): { manifest: number; links: number; audit: number } {
  return {
    manifest: readJsonlStats(kbPath(root, "manifest.jsonl")).corrupt,
    links: readJsonlStats(kbPath(root, "links.jsonl")).corrupt,
    audit: readJsonlStats(kbPath(root, "audit.jsonl")).corrupt,
  };
}

// ---------- manifest ----------

export function upsertManifest(root: string, record: ManifestRecord): void {
  // append เสมอ — ห้ามเขียนทับ; ตัวล่าสุดชนะตอนอ่าน
  appendJsonl(kbPath(root, "manifest.jsonl"), record);
}

/** load manifest ทั้งหมดแล้ว reduce เป็นตัวล่าสุดต่อ id */
export function readManifest(root: string): Map<string, ManifestRecord> {
  const records = readJsonl<ManifestRecord>(kbPath(root, "manifest.jsonl"));
  const latest = new Map<string, ManifestRecord>();
  for (const r of records) {
    if (r && typeof r.id === "string") latest.set(r.id, r);
  }
  return latest;
}

// ---------- links ----------

export function appendLink(root: string, link: LinkRecord): void {
  appendJsonl(kbPath(root, "links.jsonl"), link);
}

export function readLinks(root: string): LinkRecord[] {
  return readJsonl<LinkRecord>(kbPath(root, "links.jsonl"));
}

// ---------- aliases ----------

export function readAliases(root: string): Record<string, string> {
  const file = kbPath(root, "aliases.json");
  if (!existsSync(file)) return {};
  try {
    const data = JSON.parse(readFileSync(file, "utf8")) as unknown;
    if (data && typeof data === "object" && !Array.isArray(data)) {
      return data as Record<string, string>;
    }
  } catch {
    // ไฟล์เสีย → ถือว่าไม่มี alias
  }
  return {};
}

export function writeAliases(root: string, aliases: Record<string, string>): void {
  writeFileSync(kbPath(root, "aliases.json"), JSON.stringify(aliases, null, 2) + "\n", "utf8");
}

// ---------- audit ----------

export function audit(root: string, actor: string, action: string, target: string, detail: string): void {
  const record: AuditRecord = { ts: isoNow(), actor, action, target, detail };
  appendJsonl(kbPath(root, "audit.jsonl"), record);
}

export function readAudit(root: string): AuditRecord[] {
  return readJsonl<AuditRecord>(kbPath(root, "audit.jsonl"));
}

// ---------- write lock (กันหลาย MCP client เขียนชน) ----------
// 4 clients (codex/kimi-claw/kimi-code/daimon) ผูก brain เดียวกัน — appendFileSync ดิบเสี่ยง
// บรรทัด JSONL สลับ/หายเมื่อ 2 process เขียนพร้อมกัน lock เป็นไฟล์ .kb/write.lock (wx = create-exclusive)
// stale lock: ถ้า lock เก่าเกิน STALE_MS ถือว่า process ที่ถือตายไปแล้ว ลบทิ้งแล้วจับใหม่

const LOCK_STALE_MS = 60_000;
const LOCK_SPIN_MS = 50;
const LOCK_TIMEOUT_DEFAULT_MS = 10_000;

function lockPath(root: string): string {
  return kbPath(root, "write.lock");
}

function lockTimeoutMs(): number {
  const v = Number(process.env.ZERO_LOCK_TIMEOUT_MS);
  return Number.isFinite(v) && v > 0 ? v : LOCK_TIMEOUT_DEFAULT_MS;
}

function tryAcquireLock(root: string): boolean {
  try {
    closeSync(openSync(lockPath(root), "wx"));
    return true;
  } catch {
    // มีคนถืออยู่ — ถ้าเก่าเกินกำหนด (process ตายค้าง) ลบแล้วลองใหม่อีกครั้ง
    try {
      const st = statSync(lockPath(root));
      if (Date.now() - st.mtimeMs > LOCK_STALE_MS) {
        unlinkSync(lockPath(root));
        closeSync(openSync(lockPath(root), "wx"));
        return true;
      }
    } catch {
      // แย่งกันลบ/สร้าง — รอรอบถัดไป
    }
    return false;
  }
}

function sleepSync(ms: number): void {
  // node ไม่มี sleep sync — ใช้ Atomics.wait บนบัฟเฟอร์ dummy (main thread รอได้ปลอดภัยตรงนี้)
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

/**
 * ครอบ mutation ทุกตัวที่เขียน brain — ได้ lock แล้วค่อยทำงาน เสร็จแล้วปล่อยเสมอ
 * หมายเหตุ: lock นี้ไม่ re-entrant — handler ที่เรียก handler ต้องแยก inner (ไม่ lock ซ้อน)
 */
export function withLock<T>(root: string, fn: () => T): T {
  const deadline = Date.now() + lockTimeoutMs();
  while (!tryAcquireLock(root)) {
    if (Date.now() > deadline) {
      throw new Error(
        "brain กำลังถูกเขียนโดย process อื่น (write.lock) — รอเกิน " +
          `${lockTimeoutMs()}ms ลองใหม่อีกครั้ง หรือลบ .kb/write.lock ถ้าแน่ใจว่าไม่มีใครถืออยู่`,
      );
    }
    sleepSync(LOCK_SPIN_MS);
  }
  try {
    return fn();
  } finally {
    try {
      unlinkSync(lockPath(root));
    } catch {
      // ปล่อย lock ไม่สำเร็จ — stale check จะกวาดทิ้งเองใน 60s
    }
  }
}

// ---------- compact (กัน JSONL บวมไร้ขีดจำกัด) ----------
// manifest: append ทุก mutation → เติบตลอด แก้ด้วย reduce ต่อ id แล้วเขียนใหม่ atomic
// links: dedup tuple (นับทั้งสองทิศเหมือน logic append)
// audit: เก็บ tail N บรรทัด เศษย้ายไป .kb/archive/audit-<ts>.jsonl (ไม่ลบทิ้ง กฎ: ห้ามทำลายข้อมูล)

export const AUDIT_KEEP_TAIL = 10_000;

/** เขียนไฟล์แบบ atomic ใน kernel (tmp+rename) — ใช้ตอน compact เขียน JSONL ใหม่ทั้งก้อน */
function atomicWriteFile(abs: string, content: string): void {
  const tmp = `${abs}.tmp-${process.pid}`;
  writeFileSync(tmp, content, "utf8");
  renameSync(tmp, abs);
}

export interface CompactResult {
  manifest_before: number;
  manifest_after: number;
  links_before: number;
  links_after: number;
  audit_before: number;
  audit_after: number;
  audit_archive: string | null;
}

/** บีบ JSONL ทั้งสาม — caller ต้องครอบ withLock เอง */
export function compactBrain(root: string, auditKeepTail = AUDIT_KEEP_TAIL): CompactResult {
  // manifest: reduce ตัวล่าสุดต่อ id (corrupt lines หลุดไปด้วยตามธรรมชาติ)
  const manifestFile = kbPath(root, "manifest.jsonl");
  const manifestStats = readJsonlStats<ManifestRecord>(manifestFile);
  const latest = new Map<string, ManifestRecord>();
  for (const r of manifestStats.records) {
    if (r && typeof r.id === "string") latest.set(r.id, r);
  }
  const manifestLines = [...latest.values()].map((r) => JSON.stringify(r)).join("\n");
  atomicWriteFile(manifestFile, manifestLines.length > 0 ? manifestLines + "\n" : "");

  // links: dedup — tuple (from,to,rel) นับทิศกลับด้วย เก็บตัวแรกสุด
  const linksFile = kbPath(root, "links.jsonl");
  const linksStats = readJsonlStats<LinkRecord>(linksFile);
  const seen = new Set<string>();
  const keptLinks: LinkRecord[] = [];
  for (const l of linksStats.records) {
    if (!l || typeof l.from !== "string" || typeof l.to !== "string") continue;
    const key1 = `${l.from}${l.to}${l.rel}`;
    const key2 = `${l.to}${l.from}${l.rel}`;
    if (seen.has(key1) || seen.has(key2)) continue;
    seen.add(key1);
    keptLinks.push(l);
  }
  const linkLines = keptLinks.map((l) => JSON.stringify(l)).join("\n");
  atomicWriteFile(linksFile, linkLines.length > 0 ? linkLines + "\n" : "");

  // audit: เก็บ tail — เศษ archive (รวม corrupt lines ไปกับ archive ไม่ทำลาย)
  const auditFile = kbPath(root, "audit.jsonl");
  const auditRaw = existsSync(auditFile) ? readFileSync(auditFile, "utf8") : "";
  const auditLines = auditRaw.split(/\r?\n/).filter((l) => l.trim().length > 0);
  let auditArchive: string | null = null;
  if (auditLines.length > auditKeepTail) {
    const overflow = auditLines.slice(0, auditLines.length - auditKeepTail);
    const tail = auditLines.slice(-auditKeepTail);
    const archiveDir = kbPath(root, "archive");
    mkdirSync(archiveDir, { recursive: true });
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    const archivePath = path.join(archiveDir, `audit-${stamp}.jsonl`);
    writeFileSync(archivePath, overflow.join("\n") + "\n", "utf8");
    auditArchive = `.kb/archive/audit-${stamp}.jsonl`;
    atomicWriteFile(auditFile, tail.join("\n") + "\n");
  }

  return {
    manifest_before: manifestStats.records.length + manifestStats.corrupt,
    manifest_after: latest.size,
    links_before: linksStats.records.length + linksStats.corrupt,
    links_after: keptLinks.length,
    audit_before: auditLines.length,
    audit_after: Math.min(auditLines.length, auditKeepTail),
    audit_archive: auditArchive,
  };
}

// ---------- T2 encryption at rest ----------
// โน้ต T2 เป็น plaintext ใน .md ใครเปิดโฟลเดอร์ก็อ่านได้ — เข้ารหัส body ด้วย AES-256-GCM
// key 32B เก็บนอก brain (~/.zero/mcp/t2.key mode 0600) — brain รั่ว/backup หลุดไม่เท่ากับความลับรั่ว
// override ด้วย env ZERO_T2_KEY (passphrase → scrypt 32B) สำหรับย้ายเครื่อง/ทีม
// frontmatter ยัง plaintext (search/metadata ต้องใช้) — เข้ารหัสเฉพาะ body ขึ้นต้น "enc:v1:"

const T2_PREFIX = "enc:v1:";
const T2_KEY_FILE = path.join(homedir(), ".zero", "mcp", "t2.key");

export function isEncryptedT2(body: string): boolean {
  return body.startsWith(T2_PREFIX);
}

function t2Key(): Buffer {
  const pass = process.env.ZERO_T2_KEY;
  if (pass && pass.length > 0) {
    return scryptSync(pass, "zero-brain-t2-v1", 32);
  }
  if (!existsSync(T2_KEY_FILE)) {
    mkdirSync(path.dirname(T2_KEY_FILE), { recursive: true });
    const key = randomBytes(32);
    writeFileSync(T2_KEY_FILE, key.toString("base64") + "\n", { encoding: "utf8", mode: 0o600 });
    return key;
  }
  const raw = readFileSync(T2_KEY_FILE, "utf8").trim();
  const key = Buffer.from(raw, "base64");
  if (key.length !== 32) {
    throw new Error(`${T2_KEY_FILE} เสีย — คาด key 32 bytes (base64) แต่ได้ ${key.length}`);
  }
  return key;
}

export function encryptT2(plaintext: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", t2Key(), iv);
  const enc = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return T2_PREFIX + Buffer.concat([iv, tag, enc]).toString("base64");
}

export function decryptT2(payload: string): string {
  if (!isEncryptedT2(payload)) return payload; // plaintext เดิม (โน้ตเก่าก่อนมี encryption) คืนตรงๆ
  const blob = Buffer.from(payload.slice(T2_PREFIX.length), "base64");
  if (blob.length < 12 + 16) throw new Error("T2 payload เสีย — สั้นเกินไป");
  const iv = blob.subarray(0, 12);
  const tag = blob.subarray(12, 28);
  const enc = blob.subarray(28);
  const decipher = createDecipheriv("aes-256-gcm", t2Key(), iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(enc), decipher.final()]).toString("utf8");
}


// ---------- health ----------

export function writeHealth(root: string, report: HealthReport): void {
  writeFileSync(kbPath(root, "health.json"), JSON.stringify(report, null, 2) + "\n", "utf8");
}

// ---------- init ----------

const PACK_SKELETONS: Record<string, string> = {
  "self.yaml": [
    'name: self',
    'version: "0.1.0"',
    'privacy: T0',
    'description: Domain pack สำหรับความรู้เกี่ยวกับตัวเอง',
    'entities: []',
    'relations: []',
    "",
  ].join("\n"),
  "people.yaml": [
    'name: people',
    'version: "0.1.0"',
    'privacy: T1',
    'description: Domain pack สำหรับบุคคลและความสัมพันธ์',
    'entities: []',
    'relations: []',
    "",
  ].join("\n"),
  "security.yaml": [
    'name: security',
    'version: "0.1.0"',
    'privacy: T2',
    'description: Domain pack สำหรับความมั่นคง/ความลับ',
    'entities: []',
    'relations: []',
    "",
  ].join("\n"),
};

const HOME_MD = `# Home — Zero Brain

สมองกลาง domain-agnostic (v2.1)

## โครงสร้าง
- \`00_Fleeting/\` — จดด่วน ยังไม่คิด
- \`10_Notes/\` — โน้ตถาวร (atomic/entity/source/log/moc)
- \`20_Atlas/\` — แผนที่ความรู้ (Home.md, Today.md)
- \`30_Sources/\` — แหล่งอ้างอิงดิบ
- \`40_Templates/base/\` — เทมเพลต
- \`99_System/snapshots/\` — snapshot ระบบ

## กฎเหล็ก
- ไม่มี delete — ใช้ state: archive แทน
- atomic/entity ต้องมี evidence อย่างน้อย 1
- privacy T1/T2 ไม่โผล่ใน search default
`;

export function initBrain(root: string): { created: string[]; root: string } {
  const created: string[] = [];
  for (const dir of KB_DIRS) {
    const full = path.join(root, dir);
    if (!existsSync(full)) {
      mkdirSync(full, { recursive: true });
      created.push(dir + "/");
    }
  }
  // ไฟล์ kernel เปล่า (touch ถ้ายังไม่มี — ห้ามเขียนทับ JSONL)
  for (const f of ["manifest.jsonl", "links.jsonl", "audit.jsonl"]) {
    const full = kbPath(root, f);
    if (!existsSync(full)) {
      writeFileSync(full, "", "utf8");
      created.push(`.kb/${f}`);
    }
  }
  const aliasesFile = kbPath(root, "aliases.json");
  if (!existsSync(aliasesFile)) {
    writeFileSync(aliasesFile, "{}\n", "utf8");
    created.push(".kb/aliases.json");
  }
  const healthFile = kbPath(root, "health.json");
  if (!existsSync(healthFile)) {
    const empty: HealthReport = {
      checked_at: isoNow(),
      orphans: [],
      orphans_fleeting: 0,
      dead_links: [],
      dead_body_links: [],
      packs_unverified: [],
      notes: 0,
      corrupt_lines: { manifest: 0, links: 0, audit: 0 },
    };
    writeFileSync(healthFile, JSON.stringify(empty, null, 2) + "\n", "utf8");
    created.push(".kb/health.json");
  }
  // skeleton packs
  for (const [name, content] of Object.entries(PACK_SKELETONS)) {
    const full = kbPath(root, "packs", name);
    if (!existsSync(full)) {
      writeFileSync(full, content, "utf8");
      created.push(`.kb/packs/${name}`);
    }
  }
  // Atlas
  const homeFile = path.join(root, "20_Atlas", "Home.md");
  if (!existsSync(homeFile)) {
    writeFileSync(homeFile, HOME_MD, "utf8");
    created.push("20_Atlas/Home.md");
  }
  const todayFile = path.join(root, "20_Atlas", "Today.md");
  if (!existsSync(todayFile)) {
    writeFileSync(todayFile, `# Today\n\n(ยังไม่มีโน้ต active)\n`, "utf8");
    created.push("20_Atlas/Today.md");
  }
  // bootstrap: copy ไฟล์กฎ+templates จาก seed/ (เฉพาะไฟล์ที่ยังไม่มี — ห้ามทับของที่ผู้ใช้แก้แล้ว)
  copySeedFiles(root, created);
  return { created, root };
}

/** หาโฟลเดอร์ seed/ ของ repo (dist/kernel.js → <repo>/seed) — คืน null ถ้าไม่มี (เช่นแพ็กแบบไม่รวม seed) */
export function seedDir(): string | null {
  const dir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "seed");
  return existsSync(dir) ? dir : null;
}

/** เติมไฟล์ seed ที่ยังไม่มีลง brain (ห้ามทับของที่ผู้ใช้แก้แล้ว) — ใช้ตอนอัปเกรด repo แล้ว seed มีไฟล์ใหม่ */
export function upgradeSeed(root: string): { created: string[] } {
  const created: string[] = [];
  copySeedFiles(root, created);
  return { created };
}

function copySeedFiles(root: string, created: string[]): void {
  const base = seedDir();
  if (!base) return;
  const date = isoNow().slice(0, 10);
  const walk = (rel: string): void => {
    const src = path.join(base, rel);
    for (const entry of readdirSync(src, { withFileTypes: true })) {
      const childRel = rel ? path.join(rel, entry.name) : entry.name;
      if (entry.isDirectory()) {
        walk(childRel);
        continue;
      }
      const dest = path.join(root, childRel);
      if (existsSync(dest)) continue; // มีอยู่แล้ว ข้าม (idempotent)
      mkdirSync(path.dirname(dest), { recursive: true });
      const content = readFileSync(path.join(base, childRel), "utf8").replaceAll("{{date}}", date);
      writeFileSync(dest, content, "utf8");
      created.push(childRel.split(path.sep).join("/"));
    }
  };
  walk("");
}

export function isInitialized(root: string): boolean {
  return existsSync(kbPath(root, "manifest.jsonl"));
}
