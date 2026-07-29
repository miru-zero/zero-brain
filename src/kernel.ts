/**
 * kernel.ts — low-level ops ของ Zero Brain
 * - append-only JSONL ทุกไฟล์ (manifest/links/audit) — เขียนทับห้ามเด็ดขาด
 * - upsertManifest(note): ถ้ามี id เดิม → append record ใหม่ (ตัวล่าสุดชนะตอนอ่าน)
 * - readManifest(): load ทั้งหมดแล้ว reduce เป็นตัวล่าสุดต่อ id
 * - audit() ทุก mutation ต้องถูก log
 * - local filesystem ล้วน ห้าม network call
 */

import { createHash } from "node:crypto";
import { appendFileSync, existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
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

export function readJsonl<T>(file: string): T[] {
  if (!existsSync(file)) return [];
  const text = readFileSync(file, "utf8");
  const out: T[] = [];
  for (const line of text.split(/\r?\n/)) {
    const t = line.trim();
    if (t.length === 0) continue;
    try {
      out.push(JSON.parse(t) as T);
    } catch {
      // ข้ามบรรทัดที่ parse ไม่ได้ (กันไฟล์เสียบางส่วน)
    }
  }
  return out;
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
    const empty: HealthReport = { checked_at: isoNow(), orphans: [], orphans_fleeting: 0, dead_links: [], dead_body_links: [], packs_unverified: [], notes: 0 };
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
function seedDir(): string | null {
  const dir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "seed");
  return existsSync(dir) ? dir : null;
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
