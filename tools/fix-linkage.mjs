// fix-linkage.mjs — ทำให้ทุกโหนดเชื่อมจริงตามวิสัยทัศน์ป๊า
// 1) Legacy Index ใช้ลิงก์แบบ filename (Obsidian resolve ได้ ไม่มี ghost nodes)
// 2) สร้างศูนย์กลาง "Zero" + 3 ก้อนใหญ่: ความจำ / ความสามารถ / ระบบ
// 3) รายงานจำนวนลิงก์ที่ resolve ไม่ได้ก่อน-หลัง
import { createHash } from "node:crypto";
import { appendFileSync, existsSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";

const DEST = "C:/Users/Administrator/.zero/brain";
const sha = (b) => createHash("sha256").update(b).digest("hex");
const posix = (p) => p.split(path.sep).join("/");
const today = new Date().toISOString().slice(0, 10);

// --- รวบรวมไฟล์ .md ทั้ง vault (ยกเว้น dot-dirs) ---
const allNotes = [];
(function walk(dir) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) { if (!e.name.startsWith(".")) walk(full, fn); }
  }
  function fn() {}
})(DEST);
// เดินใหม่แบบง่าย
allNotes.length = 0;
function walk2(dir) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) { if (!e.name.startsWith(".")) walk2(full); continue; }
    if (e.name.toLowerCase().endsWith(".md")) allNotes.push(full);
  }
}
walk2(DEST);
const byStem = new Map(); // filename-without-ext -> [paths]
for (const f of allNotes) {
  const stem = path.basename(f).replace(/\.md$/i, "");
  if (!byStem.has(stem)) byStem.set(stem, []);
  byStem.get(stem).push(f);
}

// --- นับลิงก์ที่ resolve ไม่ได้ (ทั้ง vault) ---
function unresolvedCount() {
  let bad = 0;
  const badList = [];
  for (const f of allNotes) {
    const text = readFileSync(f, "utf8");
    for (const m of text.matchAll(/\[\[([^\]|]+)(\|[^\]]+)?\]\]/g)) {
      const target = m[1].trim();
      if (!byStem.has(target)) { bad++; if (badList.length < 15) badList.push(`${path.basename(f)} -> [[${target}]]`); }
    }
  }
  return { bad, badList };
}
const before = unresolvedCount();

// --- อ่าน manifest เพื่อจัดกลุ่ม legacy ---
const manifest = readFileSync(path.join(DEST, ".kb", "manifest.jsonl"), "utf8")
  .split("\n").filter(Boolean).map((l) => JSON.parse(l));
const legacy = manifest.filter((r) => r.id.startsWith("legacy-") && r.path !== "20_Atlas/Zero_Brain Legacy Index.md");
const groups = new Map();
for (const r of legacy) {
  const top = r.path.split("/").slice(0, 2).join("/");
  if (!groups.has(top)) groups.set(top, []);
  groups.get(top).push(r);
}

// --- เขียน Legacy Index ใหม่: ลิงก์ด้วย filename stem (resolve ชัวร์) ---
let idx = `---\ntitle: Zero_Brain Legacy Index\ntype: moc\ncreated: ${today}\nupdated: ${today}\n---\n\n# Zero_Brain Legacy Index\n\n> ดัชนีความจำเก่า (113 โน้ตจาก Zero_Brain vault) — ลิงก์ทุกเส้น resolve ได้จริง\n> ศูนย์กลางของสมอง: [[Zero]]\n`;
for (const [g, items] of [...groups.entries()].sort()) {
  idx += `\n## ${g} (${items.length})\n\n`;
  for (const r of items.sort((a, b) => a.path.localeCompare(b.path))) {
    const stem = path.basename(r.path).replace(/\.md$/i, "");
    idx += stem === r.title ? `- [[${stem}]]\n` : `- [[${stem}|${r.title}]]\n`;
  }
}
writeFileSync(path.join(DEST, "20_Atlas", "Zero_Brain Legacy Index.md"), idx, "utf8");

// --- Skill Index (ก้อนความสามารถ) ---
const skillDir = path.join(DEST, "SKILL");
const skills = existsSync(skillDir)
  ? readdirSync(skillDir, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name)
  : [];
let sidx = `---\ntitle: Skill Index\ntype: moc\ncreated: ${today}\nupdated: ${today}\n---\n\n# Skill Index — ความสามารถของสมอง\n\n> skills ที่ติดตั้งผ่านระบบเรา เก็บเป็นกลุ่มก้อนใน brain ใต้ SKILL/ ศูนย์กลาง: [[Zero]]\n\n`;
for (const s of skills.sort()) sidx += `- **${s}** — \`SKILL/${s}/SKILL.md\`\n`;
writeFileSync(path.join(DEST, "20_Atlas", "Skill Index.md"), sidx, "utf8");

// --- ศูนย์กลาง Zero ---
const zero = `---\ntitle: Zero\ntype: moc\ncreated: ${today}\nupdated: ${today}\n---\n\n# Zero — ศูนย์กลางของสมอง\n\n> ทุกเส้นประสาทมาบรรจบที่นี่ — เหมือน nucleus ของ neuron\n> ถ้าโน้ตไม่ได้เชื่อมมาที่นี่ (ผ่านก้อนใดก้อนหนึ่ง) แปลว่ามันยังไม่ได้ sync เข้าระบบ\n\n## 3 ก้อนใหญ่\n\n1. **ความจำ** — [[Zero_Brain Legacy Index]] (โน้ตทั้งหมดใน 10_Notes, 00_Fleeting)\n2. **ความสามารถ** — [[Skill Index]] (skills ใน SKILL/ ที่ชี้กลับมาสมอง)\n3. **ระบบ/แผนที่** — [[Home]] · [[Hotcache]] · [[Memory Placement Rules]] · [[Brain Operating Model]] · [[AGENTS]]\n\n## วิธีใช้\n\n- โน้ตใหม่ทุกใบ: ลิงก์เข้าก้อนที่เกี่ยวข้องอย่างน้อย 1 เส้น (กฎ inbound link ใน [[Memory Placement Rules]])\n- ตรวจโหนดลอย: zero_health (orphans) หรือดู graph ว่ามีจุดแยกกลุ่มไหม\n`;
writeFileSync(path.join(DEST, "20_Atlas", "Zero.md"), zero, "utf8");

// --- Home.md ชี้มาที่ Zero ---
const homePath = path.join(DEST, "20_Atlas", "Home.md");
const home = readFileSync(homePath, "utf8");
if (!home.includes("[[Zero]]")) {
  appendFileSync(homePath, `\n## ศูนย์กลาง\n- [[Zero]] — nucleus ของสมอง ทุกอย่างเชื่อมมาที่นี่\n`, "utf8");
}

// --- manifest records สำหรับไฟล์ใหม่/ที่แก้ ---
const upserts = [];
for (const rel of ["20_Atlas/Zero_Brain Legacy Index.md", "20_Atlas/Skill Index.md", "20_Atlas/Zero.md", "20_Atlas/Home.md"]) {
  const full = path.join(DEST, rel);
  const buf = readFileSync(full);
  const old = manifest.filter((r) => r.path === rel).pop();
  upserts.push(JSON.stringify({
    id: old ? old.id : `zero-${sha(buf).slice(0, 8)}`,
    path: rel,
    type: rel.includes("Index") || rel.includes("Zero.md") || rel.includes("Home") ? "moc" : "moc",
    title: path.basename(rel).replace(/\.md$/i, ""),
    domain: old?.domain ?? "system",
    privacy: "T0",
    created: old?.created ?? today,
    updated: today,
    sha256: sha(buf),
  }));
}
appendFileSync(path.join(DEST, ".kb", "manifest.jsonl"), upserts.join("\n") + "\n", "utf8");
appendFileSync(path.join(DEST, ".kb", "audit.jsonl"), JSON.stringify({
  ts: new Date().toISOString(), actor: "miru-daimon", action: "brain_fix_linkage",
  target: "Zero hub + 3 clusters", detail: `unresolved_before=${before.bad}`,
}) + "\n", "utf8");

// --- นับใหม่หลังแก้ ---
allNotes.length = 0; walk2(DEST);
byStem.clear();
for (const f of allNotes) {
  const stem = path.basename(f).replace(/\.md$/i, "");
  if (!byStem.has(stem)) byStem.set(stem, []);
  byStem.get(stem).push(f);
}
const after = unresolvedCount();
console.log(JSON.stringify({ unresolved_before: before.bad, unresolved_after: after.bad, examples_before: before.badList, examples_after: after.badList }, null, 2));
