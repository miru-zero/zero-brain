/**
 * kernel.ts — หัวใจเก็บข้อมูลของ Central Brain
 * append-only JSONL stores + aliases + health — ห้ามมี delete
 * ไฟล์นี้ห้าม import อะไรนอกเหนือ node builtins (offline เท่านั้น)
 */

import { createHash } from "node:crypto";
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

export interface ManifestRecord {
  id: string;
  type: string;
  title: string;
  path: string;
  domain: string;
  privacy: string;
  created: string;
}

export interface LinkRecord {
  from: string;
  to: string;
  rel: string;
}

export interface AuditRecord {
  ts: string;
  actor: string;
  action: string;
  target: string;
  detail?: string;
}

export interface HealthReport {
  checked_at: string;
  orphans: string[];
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
];

export function isoNow(): string {
  return new Date().toISOString();
}

export function kbPath(root: string, ...parts: string[]): string {
  return path.join(root, ".kb", ...parts);
}

export function appendJsonl(file: string, record: unknown): void {
  appendFileSync(file, JSON.stringify(record) + "\n", "utf8");
}

export function readJsonl<T>(file: string): T[] {
  if (!existsSync(file)) return [];
  const out: T[] = [];
  for (const line of readFileSync(file, "utf8").split("\n")) {
    if (!line.trim()) continue;
    try {
      out.push(JSON.parse(line) as T);
    } catch {
      // ข้ามบรรทัดที่พัง — append-only log ต้องไม่ล้มเพราะบรรทัดเดียว
    }
  }
  return out;
}

/** manifest: ตัวล่าสุดชนะ (append-only) */
export function readManifest(root: string): Map<string, ManifestRecord> {
  const map = new Map<string, ManifestRecord>();
  for (const rec of readJsonl<ManifestRecord>(kbPath(root, "manifest.jsonl"))) {
    map.set(rec.id, rec);
  }
  return map;
}

export function readAliases(root: string): Record<string, string> {
  const f = kbPath(root, "aliases.json");
  if (!existsSync(f)) return {};
  try {
    return JSON.parse(readFileSync(f, "utf8")) as Record<string, string>;
  } catch {
    return {};
  }
}

export function appendLink(root: string, link: LinkRecord): void {
  appendJsonl(kbPath(root, "links.jsonl"), link);
}

export function appendAudit(root: string, rec: AuditRecord): void {
  appendJsonl(kbPath(root, "audit.jsonl"), rec);
}

export function writeHealth(root: string, report: HealthReport): void {
  writeFileSync(kbPath(root, "health.json"), JSON.stringify(report, null, 2) + "\n", "utf8");
}

export function sha256(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

export function isInitialized(root: string): boolean {
  return existsSync(kbPath(root, "manifest.jsonl"));
}

/** สร้างโครงสมองใหม่ — idempotent: ถ้ามีแล้วไม่แตะ (กฎห้ามทำลายข้อมูล) */
export function initBrain(root: string): void {
  for (const d of KB_DIRS) mkdirSync(path.join(root, d), { recursive: true });
  const touch = (p: string, content: string) => {
    if (!existsSync(p)) writeFileSync(p, content, "utf8");
  };
  touch(kbPath(root, "manifest.jsonl"), "");
  touch(kbPath(root, "links.jsonl"), "");
  touch(kbPath(root, "audit.jsonl"), "");
  touch(kbPath(root, "aliases.json"), "{}\n");
  const empty: HealthReport = { checked_at: isoNow(), orphans: [], dead_links: [], dead_body_links: [], packs_unverified: [], notes: 0 };
  touch(kbPath(root, "health.json"), JSON.stringify(empty, null, 2) + "\n");
  const packs: [string, string, string][] = [
    ["self", "T0", "Domain pack สำหรับความรู้เกี่ยวกับตัวเอง"],
    ["people", "T1", "Domain pack สำหรับคนรู้จัก/ความสัมพันธ์"],
    ["security", "T2", "Domain pack สำหรับงาน security research"],
  ];
  for (const [name, privacy, desc] of packs) {
    touch(
      kbPath(root, "packs", `${name}.yaml`),
      `name: ${name}\nversion: "0.1.0"\nprivacy: ${privacy}\ndescription: ${desc}\nentities: []\nrelations: []\n`,
    );
  }
  touch(
    path.join(root, "20_Atlas", "Home.md"),
    "# Home\n\nแผนที่รวมของสมอง — จะเติบตามโน้ตที่เพิ่มเข้ามา\n",
  );
  touch(path.join(root, "20_Atlas", "Today.md"), "# Today\n");
}
