// fix-ghost-links.mjs — แปลง wikilink ที่ชี้ "เป้าหมายที่ไม่มีจริง" (ghost nodes ในกราฟ Obsidian)
// ให้เป็น code span แทน เพื่อให้กราฟสะอาดโดยไม่ทิ้งข้อมูล
// แก้เฉพาะ pattern ที่รู้ว่าเป็น ghost โดยตั้งใจ: share/..., SKILL/..., legacy-xxxx, dateId ที่ไฟล์ไม่มีจริง, [[wikilink]] ตัวอย่าง
// เป้าหมายอื่นที่ไม่เข้า pattern → รายงานไว้เฉยๆ ไม่แตะ
// usage: node tools/fix-ghost-links.mjs [--dry-run]
import fs from 'node:fs';
import path from 'node:path';
import { homedir } from 'node:os';

const ZERO = process.env.ZERO_HOME ?? path.join(homedir(), '.zero');
const BRAIN = process.env.ZERO_BRAIN_ROOT ?? path.join(ZERO, 'brain');
const DRY = process.argv.includes('--dry-run');

function walk(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) { if (!e.name.startsWith('.') && e.name !== 'node_modules') walk(p, out); }
    else if (e.name.toLowerCase().endsWith('.md')) out.push(p);
  }
  return out;
}

const files = walk(BRAIN);
const basenames = new Set();
const pathsLower = new Set();
for (const f of files) {
  const rel = path.relative(BRAIN, f).replace(/\\/g, '/');
  basenames.add(path.basename(rel, '.md').toLowerCase());
  pathsLower.add(rel.toLowerCase().replace(/\.md$/, ''));
  pathsLower.add(rel.toLowerCase());
}
const exists = (t) => {
  const tl = t.toLowerCase();
  const bn = t.split('/').pop().replace(/\.md$/i, '').toLowerCase();
  return pathsLower.has(tl) || pathsLower.has(tl + '.md') || basenames.has(bn);
};

// mask บริเวณ fenced code + inline code (Obsidian ไม่นับลิงก์ใน code เป็นเส้นกราฟ)
function codeMask(src) {
  const mask = new Array(src.length).fill(false);
  const fenceRe = /^(`{3,}|~{3,}).*$/gm;
  let m, open = null;
  const lines = src.split('\n');
  let pos = 0;
  for (const line of lines) {
    const fm = line.match(/^\s*(`{3,}|~{3,})/);
    if (fm) {
      if (open === null) open = fm[1][0];
      else if (fm[1][0] === open) open = null;
    }
    if (open !== null || fm) for (let i = pos; i < pos + line.length + 1 && i < src.length; i++) mask[i] = true;
    pos += line.length + 1;
  }
  const inlineRe = /`[^`\n]+`/g;
  while ((m = inlineRe.exec(src))) for (let i = m.index; i < m.index + m[0].length; i++) mask[i] = true;
  return mask;
}

// pattern ที่ "แก้อัตโนมัติ" ได้ (รู้ว่าเป็น ghost โดยตั้งใจ ไม่ใช่พิมพ์ผิด)
const AUTO = [
  { re: /^share\//i, keep: 'target' },          // stub ชี้ไฟล์นอก vault
  { re: /^SKILL\//i, keep: 'target' },          // stub zero-brain-memory
  { re: /^legacy-[0-9a-f]{6,}$/i, keep: 'target' }, // โน้ต legacy ที่ไม่ได้ migrate
  { re: /^20\d{6}-\d{6}-[a-z0-9]+/i, keep: 'alias' }, // dateId ที่ไฟล์ไม่มีจริง (เก็บ alias/id)
  { re: /^wikilinks?$/i, keep: 'target' },      // ตัวอย่างในเอกสาร ที่หลุดนอก code span
];

const LINK_RE = /\[\[([^\]|#]+)(?:#[^\]|]+)?(?:\|([^\]]*))?\]\]/g;
const report = { filesChanged: 0, linksFixed: 0, unknown: new Map() };

for (const f of files) {
  const src = fs.readFileSync(f, 'utf8');
  const mask = codeMask(src);
  const edits = []; // {start, end, text}
  let m;
  while ((m = LINK_RE.exec(src))) {
    if (mask[m.index]) continue; // อยู่ใน code → กราฟไม่นับอยู่แล้ว
    const target = m[1].trim();
    const alias = (m[2] ?? '').trim();
    if (exists(target)) continue;
    const rule = AUTO.find(r => r.re.test(target));
    if (!rule) {
      const rel = path.relative(BRAIN, f).replace(/\\/g, '/');
      if (!report.unknown.has(target)) report.unknown.set(target, []);
      report.unknown.get(target).push(rel);
      continue;
    }
    const shown = (rule.keep === 'alias' && alias) ? alias : target;
    edits.push({ start: m.index, end: m.index + m[0].length, text: '`' + shown + '`' });
  }
  if (!edits.length) continue;
  let out = src;
  for (const e of edits.sort((a, b) => b.start - a.start)) out = out.slice(0, e.start) + e.text + out.slice(e.end);
  if (!DRY) { fs.writeFileSync(f + '.tmp', out); fs.renameSync(f + '.tmp', f); }
  report.filesChanged++;
  report.linksFixed += edits.length;
}

console.log(JSON.stringify({
  dry_run: DRY,
  files_changed: report.filesChanged,
  links_fixed: report.linksFixed,
  unknown_ghosts_left: [...report.unknown.entries()].map(([t, refs]) => ({ target: t, refs })),
}, null, 2));
