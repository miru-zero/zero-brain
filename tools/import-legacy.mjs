// import-legacy.mjs — ย้ายความจำ Zero_Brain.bak เข้า ~/.zero/brain
// กติกา: ไม่ทับของเดิม (ข้าม/ต่อท้าย " (Legacy)"), ลง manifest ทุกไฟล์ (sync เข้าระบบ),
// สร้าง Legacy Index ลิงก์ครบทุกโน้ต (เชื่อมโยง = เข้าระบบจริง)
import { createHash } from "node:crypto";
import { appendFileSync, existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { homedir } from "node:os";

// portable: SRC = argv[2] หรือ ZERO_LEGACY_SRC (บังคับ — vault ต้นทางของแต่ละเครื่องไม่เหมือนกัน)
//           DEST = argv[3] > ZERO_BRAIN_ROOT > ~/.zero/brain
const SRC = process.argv[2] ?? process.env.ZERO_LEGACY_SRC;
const DEST = process.argv[3] ?? process.env.ZERO_BRAIN_ROOT ?? path.join(homedir(), ".zero", "brain");
if (!SRC) {
  console.error("usage: node tools/import-legacy.mjs <legacy-vault-src> [brain-dest]  (หรือตั้ง ZERO_LEGACY_SRC)");
  process.exit(1);
}

const MAPPINGS = [
  { src: "00 Atlas", dst: "20_Atlas", type: "moc", keepTree: false },
  { src: "01 Projects", dst: "10_Notes/Projects", type: "log", keepTree: true },
  { src: "03 Resources", dst: "10_Notes/Resources", type: "source", keepTree: true },
  { src: "04 Archive", dst: "10_Notes/Archive", type: "log", keepTree: true },
  { src: "05 Fleeting", dst: "00_Fleeting", type: "fleeting", keepTree: false },
  { src: "templates", dst: "40_Templates/legacy", type: "moc", keepTree: true },
];
const ROOT_FILES = ["000 Miru Zero Index.md", "AGENTS.md", "CLAUDE.md", "README.md"];
const NOTE_TYPES = ["fleeting", "atomic", "entity", "source", "log", "moc"];

const sha = (buf) => createHash("sha256").update(buf).digest("hex");
const posix = (p) => p.split(path.sep).join("/");

function parseFrontmatterTitle(text) {
  const m = text.match(/^---\n([\s\S]*?)\n---\n/);
  if (!m) return null;
  const t = m[1].match(/^title:\s*(.+)$/m);
  if (!t) return null;
  return t[1].trim().replace(/^["']|["']$/g, "") || null;
}
function parseFrontmatterField(text, field) {
  const m = text.match(/^---\n([\s\S]*?)\n---\n/);
  if (!m) return null;
  const t = m[1].match(new RegExp(`^${field}:\\s*(.+)$`, "m"));
  return t ? t[1].trim().replace(/^["']|["']$/g, "") : null;
}
function dateOr(stat, s) {
  return s && /^\d{4}-\d{2}-\d{2}/.test(s) ? s.slice(0, 10) : stat.mtime.toISOString().slice(0, 10);
}

const manifestLines = [];
const imported = []; // {title, relDest, group}
const skipped = [];
const collisions = new Map(); // title -> count (ซ้ำหลายไฟล์)

function destFor(dstDir, rel, keepTree) {
  const dir = keepTree ? path.join(DEST, dstDir, path.dirname(rel)) : path.join(DEST, dstDir);
  let name = path.basename(rel);
  let full = path.join(dir, name);
  if (existsSync(full)) {
    name = name.replace(/\.md$/i, " (Legacy).md");
    full = path.join(dir, name);
  }
  if (existsSync(full)) return null;
  return full;
}

function importFile(srcFull, rel, group, dstDir, defType, keepTree) {
  const dest = destFor(dstDir, rel, keepTree);
  if (!dest) { skipped.push(rel + " (ชนกันทั้ง 2 ชื่อ)"); return; }
  const buf = readFileSync(srcFull);
  const text = buf.toString("utf8");
  const stat = statSync(srcFull);
  const title = parseFrontmatterTitle(text) ?? path.basename(dest).replace(/\.md$/i, "");
  const fmType = parseFrontmatterField(text, "type");
  const type = NOTE_TYPES.includes(fmType) ? fmType : defType;
  mkdirSync(path.dirname(dest), { recursive: true });
  writeFileSync(dest, buf);
  const hash = sha(buf);
  const relDest = posix(path.relative(DEST, dest));
  manifestLines.push(JSON.stringify({
    id: `legacy-${hash.slice(0, 8)}`,
    path: relDest,
    type,
    title,
    domain: "legacy",
    privacy: "T0",
    created: dateOr(stat, parseFrontmatterField(text, "created")),
    updated: dateOr(stat, parseFrontmatterField(text, "updated")),
    sha256: hash,
  }));
  imported.push({ title, relDest, group });
  collisions.set(title, (collisions.get(title) ?? 0) + 1);
}

function walk(dir, fn) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) { if (!e.name.startsWith(".")) walk(full, fn); }
    else if (e.name.toLowerCase().endsWith(".md")) fn(full);
  }
}

for (const m of MAPPINGS) {
  const srcDir = path.join(SRC, m.src);
  if (!existsSync(srcDir)) continue;
  walk(srcDir, (full) => {
    const rel = path.relative(srcDir, full);
    importFile(full, rel, m.src, m.dst, m.type, m.keepTree);
  });
}
for (const f of ROOT_FILES) {
  const full = path.join(SRC, f);
  if (existsSync(full)) importFile(full, f, "(root)", "20_Atlas", "moc", false);
}

// --- Legacy Index (MOC) ลิงก์ครบทุกโน้ต ---
const byGroup = new Map();
for (const it of imported) {
  if (!byGroup.has(it.group)) byGroup.set(it.group, []);
  byGroup.get(it.group).push(it);
}
let idx = `---\ntitle: Zero_Brain Legacy Index\ntype: moc\ncreated: ${new Date().toISOString().slice(0, 10)}\nupdated: ${new Date().toISOString().slice(0, 10)}\n---\n\n# Zero_Brain Legacy Index\n\n> ดัชนีโน้ตที่ย้ายมาจาก Zero_Brain vault เดิม (M:\\Zero_Brain.bak) — ทุกโน้ตถูกลิงก์จากที่นี่ (เชื่อมเข้าระบบ)\n`;
for (const [group, items] of [...byGroup.entries()].sort()) {
  idx += `\n## ${group} (${items.length})\n\n`;
  for (const it of items.sort((a, b) => a.title.localeCompare(b.title))) idx += `- [[${it.title}]]\n`;
}
idx += `\n## หมายเหตุ\n\n- privacy ทั้งหมดตั้ง T0 (vault เดิมไม่มี tier) — ใบไหนลับให้เปลี่ยนเป็น T1/T2 ด้วย zero_update_note\n- ชื่อซ้ำกันหลายไฟล์: ${[...collisions.entries()].filter(([, c]) => c > 1).map(([t, c]) => `${t}×${c}`).join(", ") || "ไม่มี"}\n`;
const idxDest = path.join(DEST, "20_Atlas", "Zero_Brain Legacy Index.md");
writeFileSync(idxDest, idx, "utf8");
const idxBuf = readFileSync(idxDest);
manifestLines.push(JSON.stringify({
  id: `legacy-${sha(idxBuf).slice(0, 8)}`,
  path: "20_Atlas/Zero_Brain Legacy Index.md",
  type: "moc", title: "Zero_Brain Legacy Index", domain: "legacy", privacy: "T0",
  created: new Date().toISOString().slice(0, 10), updated: new Date().toISOString().slice(0, 10),
  sha256: sha(idxBuf),
}));

// --- append manifest (append-only) ---
appendFileSync(path.join(DEST, ".kb", "manifest.jsonl"), manifestLines.join("\n") + "\n", "utf8");

// --- Home.md ลิงก์ดัชนี ---
const homePath = path.join(DEST, "20_Atlas", "Home.md");
const home = readFileSync(homePath, "utf8");
if (!home.includes("Zero_Brain Legacy Index")) {
  appendFileSync(homePath, `\n## Legacy\n- [[Zero_Brain Legacy Index]] — ความจำเก่าที่ย้ายเข้าระบบ (${imported.length} โน้ต)\n`, "utf8");
}

// --- audit ---
appendFileSync(path.join(DEST, ".kb", "audit.jsonl"), JSON.stringify({
  ts: new Date().toISOString(), actor: "miru-daimon", action: "brain_import_legacy",
  target: SRC, detail: `imported=${imported.length} skipped=${skipped.length} titles_dup=${[...collisions.values()].filter((c) => c > 1).length}`,
}) + "\n", "utf8");

// --- ตรวจเชื่อมโยง: โน้ตที่ไม่มีใครลิงก์ถึง ---
const linkedTitles = new Set([...imported.map((i) => i.title), "Zero_Brain Legacy Index"]);
const unlinked = [];
for (const it of imported) {
  // ทุกโน้ตถูกลิงก์จาก index แล้ว — เช็คแบบจริงจากเนื้อ index
  if (!idx.includes(`[[${it.title}]]`)) unlinked.push(it.title);
}

console.log(JSON.stringify({
  imported: imported.length,
  skipped,
  groups: Object.fromEntries([...byGroup.entries()].map(([g, i]) => [g, i.length])),
  duplicate_titles: [...collisions.entries()].filter(([, c]) => c > 1).map(([t, c]) => `${t}×${c}`),
  unlinked_after_import: unlinked,
}, null, 2));
