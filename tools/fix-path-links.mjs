// ตัด path prefix ออกจาก wikilink เก่า [[01 Projects/X/Stem]] -> [[Stem]]
// ทำเฉพาะลิงก์ที่ stem มีไฟล์จริงใน vault (resolve ได้) — นับ unresolved ก่อน/หลัง
import fs from 'node:fs';
import path from 'node:path';
import { homedir } from 'node:os';

// portable: argv[2] > ZERO_BRAIN_ROOT > ~/.zero/brain
const ROOT = process.argv[2] ?? process.env.ZERO_BRAIN_ROOT ?? path.join(homedir(), '.zero', 'brain');
const SKIP = new Set(['.obsidian', '.trash', '99_System/.git']);

function walk(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    const rel = path.relative(ROOT, p).replace(/\\/g, '/');
    if (e.isDirectory()) {
      if (e.name.startsWith('.') ) continue;
      walk(p, out);
    } else if (e.name.endsWith('.md')) out.push(rel);
  }
  return out;
}

const files = walk(ROOT);
const stems = new Map(); // stem -> count
for (const f of files) {
  const s = path.basename(f, '.md');
  stems.set(s, (stems.get(s) || 0) + 1);
}

const LINK_RE = /\[\[([^\]]+)\]\]/g;
function unresolvedCount() {
  let n = 0;
  const ex = [];
  for (const f of files) {
    const txt = fs.readFileSync(path.join(ROOT, f), 'utf8');
    for (const m of txt.matchAll(LINK_RE)) {
      const inner = m[1].split('|')[0].split('#')[0].trim();
      if (!inner) continue;
      const stem = inner.includes('/') ? inner.split('/').pop() : inner;
      if (!stems.has(stem)) {
        n++;
        if (ex.length < 15) ex.push(`${f} -> [[${m[1]}]]`);
      }
    }
  }
  return { n, ex };
}

const before = unresolvedCount();

// แก้ไข: ลิงก์ที่มี / และ stem มีไฟล์จริง -> ตัด path ทิ้ง
let touchedFiles = 0, rewritten = 0;
for (const f of files) {
  const fp = path.join(ROOT, f);
  let txt = fs.readFileSync(fp, 'utf8');
  let changed = false;
  const out = txt.replace(LINK_RE, (whole, inner) => {
    const [targetPart, ...aliasParts] = inner.split('|');
    const alias = aliasParts.length ? '|' + aliasParts.join('|') : '';
    const [pathPart, ...hashParts] = targetPart.split('#');
    const hash = hashParts.length ? '#' + hashParts.join('#') : '';
    const t = pathPart.trim();
    if (!t.includes('/')) return whole;
    const stem = t.split('/').pop();
    if (!stems.has(stem)) return whole; // ไม่มีไฟล์จริง ปล่อยไว้
    changed = true; rewritten++;
    return `[[${stem}${hash}${alias}]]`;
  });
  if (changed) {
    fs.writeFileSync(fp + '.tmp', out);
    fs.renameSync(fp + '.tmp', fp);
    touchedFiles++;
  }
}

// นับใหม่หลังแก้ (stems เดิมยัง valid)
const after = unresolvedCount();
console.log(JSON.stringify({ unresolved_before: before.n, rewritten_links: rewritten, files_touched: touchedFiles, unresolved_after: after.n, remaining_examples: after.ex }, null, 2));
