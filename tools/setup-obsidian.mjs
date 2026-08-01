#!/usr/bin/env node
/**
 * setup-obsidian.mjs — ซ่อนทุกอย่างที่ไม่ใช่สมองใน Obsidian vault (~/.zero)
 *
 * หลักการ: vault = ~/.zero ทั้งโซน แต่โชว์เฉพาะ brain/ — ที่เหลือ (mcp, share,
 * SKILL, daimon-share, kimi, ไฟล์หลุมระดับ root) ซ่อน 2 ชั้น:
 *   1. app.json userIgnoreFilters → หายจาก graph / search / quick switcher
 *   2. snippets/zero-hide-non-brain.css → หายจาก file explorer (data-path)
 *
 * สแกน top-level แบบ dynamic ทุกครั้ง — เครื่องไหน layout ต่างกันก็ซ่อนถูก
 * idempotent: merge config เดิม ไม่ทับค่าอื่นของผู้ใช้ · ใช้ node builtins ล้วน
 *
 * ใช้: node tools/setup-obsidian.mjs   (install.ps1/install.sh เรียกอัตโนมัติ)
 */
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const ZERO_HOME = process.env.ZERO_HOME || path.join(os.homedir(), '.zero');
const VAULT = path.join(ZERO_HOME, '.obsidian');
const SNIPPET_NAME = 'zero-hide-non-brain';
const SHOW = new Set(['brain']); // whitelist: โชว์เฉพาะ brain — dot-prefixed Obsidian ซ่อนเองอยู่แล้ว

function readJson(p) {
  try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return null; }
}
function writeJsonAtomic(p, obj) {
  const tmp = p + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(obj, null, 2) + '\n');
  fs.renameSync(tmp, p);
}

// 1) สแกน top-level ที่ต้องซ่อน (ทุกอย่างยกเว้น brain + dot-prefixed)
const hidden = [];
for (const e of fs.readdirSync(ZERO_HOME, { withFileTypes: true })) {
  if (e.name.startsWith('.') || SHOW.has(e.name)) continue;
  hidden.push({ name: e.name, dir: e.isDirectory() });
}
hidden.sort((a, b) => a.name.localeCompare(b.name));

// 2) เตรียม .obsidian (สร้างล่วงหน้าได้ — Obsidian เปิด vault ทีหลังจะ merge ไม่ลบ)
fs.mkdirSync(path.join(VAULT, 'snippets'), { recursive: true });

// 3) app.json → userIgnoreFilters (union ของเดิม + ของใหม่)
const appPath = path.join(VAULT, 'app.json');
const app = readJson(appPath) || {};
const filters = new Set(Array.isArray(app.userIgnoreFilters) ? app.userIgnoreFilters : []);
for (const h of hidden) filters.add(h.dir ? `${h.name}/` : h.name);
app.userIgnoreFilters = [...filters].sort();
writeJsonAtomic(appPath, app);

// 4) CSS snippet → ซ่อนใน file explorer (regenerate ทั้งไฟล์ทุกครั้งจาก scan ปัจจุบัน)
const rules = hidden.map((h) =>
  `.nav-${h.dir ? 'folder' : 'file'}[data-path="${h.name}"] { display: none !important; }`,
);
const css = `/* ${SNIPPET_NAME} — สร้างโดย setup-obsidian.mjs ห้ามแก้เอง (รันใหม่ทับทุกครั้ง)\n` +
  ` * ซ่อน non-brain ออกจาก explorer; graph/search ซ่อนด้วย userIgnoreFilters */\n` +
  rules.join('\n') + '\n';
fs.writeFileSync(path.join(VAULT, 'snippets', `${SNIPPET_NAME}.css`), css);

// 5) appearance.json → เปิดใช้ snippet (เก็บ snippet อื่นของผู้ใช้ไว้)
const appearPath = path.join(VAULT, 'appearance.json');
const appear = readJson(appearPath) || {};
const enabled = new Set(Array.isArray(appear.enabledCssSnippets) ? appear.enabledCssSnippets : []);
enabled.add(SNIPPET_NAME);
appear.enabledCssSnippets = [...enabled].sort();
writeJsonAtomic(appearPath, appear);

// 6) graph.json → colorGroups สมอง (จัดกลุ่มสีตามโฟลเดอร์ brain)
// query ทุกกลุ่มไม่ overlap กัน (catch-all ใส่ negation) — เรียงลำดับยังไงสีก็ถูก
// ไม่ทับกลุ่มที่ผู้ใช้เพิ่มเอง: เก็บกลุ่มที่ไม่ใช่ managed/dead ไว้ต่อท้าย
const BRAIN_DIRS = ['00_Fleeting', '10_Notes', '20_Atlas', '30_Sources', '40_Templates', '99_System'];
const GROUP_RGB = {
  '00_Fleeting': 16735370, '10_Notes': 2282478, '20_Atlas': 12339403,
  '30_Sources': 10980346, '40_Templates': 10265519, '99_System': 15680580,
};
const CATCH_ALL = 'path:brain ' + BRAIN_DIRS.map((d) => `-path:brain/${d}`).join(' ');
const GRAPH_GROUPS = [
  ...BRAIN_DIRS.map((d) => ({ query: `path:brain/${d}`, rgb: GROUP_RGB[d] })),
  { query: CATCH_ALL, rgb: 3462041 },
];
// กลุ่มตายจาก layout เก่า — โฟลเดอร์พวกนี้ถูก ignore แล้ว ไม่มีใน graph (ลบทิ้งเสมอ)
const DEAD_GROUP_QUERIES = new Set(['path:mcp', 'path:share', 'path:SKILL', 'path:brain']);
const MANAGED_QUERIES = new Set(GRAPH_GROUPS.map((g) => g.query));
const graphPath = path.join(VAULT, 'graph.json');
const graph = readJson(graphPath) || {};
const keptGroups = (Array.isArray(graph.colorGroups) ? graph.colorGroups : []).filter((g) => {
  const q = String(g?.query ?? '').trim();
  return q && !DEAD_GROUP_QUERIES.has(q) && !MANAGED_QUERIES.has(q);
});
graph.colorGroups = [
  ...GRAPH_GROUPS.map((g) => ({ query: g.query, color: { a: 1, rgb: g.rgb } })),
  ...keptGroups,
];
writeJsonAtomic(graphPath, graph);

console.log(`[zero-obsidian] vault: ${ZERO_HOME}`);
console.log(`[zero-obsidian] ซ่อน ${hidden.length} รายการ: ${hidden.map((h) => h.name + (h.dir ? '/' : '')).join(', ') || '(ไม่มี)'}`);
console.log(`[zero-obsidian] app.json userIgnoreFilters=${app.userIgnoreFilters.length} · snippet ${SNIPPET_NAME} เปิดแล้ว`);
console.log(`[zero-obsidian] graph colorGroups=${graph.colorGroups.length} (managed ${GRAPH_GROUPS.length} + ของผู้ใช้ ${keptGroups.length})`);
console.log('[zero-obsidian] ถ้า Obsidian เปิดค้างอยู่ ให้ reload (Ctrl+R) หรือปิดเปิดใหม่');
