// เช็ค orphan ใน brain + สร้าง Template Index + เชื่อม stub zero-brain-memory เข้าตัวจริง + เดินสายโน้ตลอย
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const BRAIN = 'C:/Users/Administrator/.zero/brain';
const ATLAS = path.join(BRAIN, '20_Atlas');
const now = new Date().toISOString();
const today = now.slice(0, 10);
const shaFile = (p) => crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');

function walk(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) { if (!e.name.startsWith('.')) walk(p, out); }
    else if (e.name.endsWith('.md')) out.push(path.relative(BRAIN, p).replace(/\\/g, '/'));
  }
  return out;
}
const files = walk(BRAIN);
const stemOf = (rel) => path.basename(rel, '.md');
const stems = new Map();
for (const f of files) { const s = stemOf(f); if (!stems.has(s)) stems.set(s, []); stems.get(s).push(f); }

// inbound: ใครลิงก์มาหาไฟล์นี้บ้าง
const LINK_RE = /\[\[([^\]]+)\]\]/g;
const inbound = new Map(files.map(f => [f, 0]));
for (const f of files) {
  const txt = fs.readFileSync(path.join(BRAIN, f), 'utf8');
  for (const m of txt.matchAll(LINK_RE)) {
    const inner = m[1].split('|')[0].split('#')[0].trim();
    if (!inner) continue;
    let targets = [];
    if (inner.endsWith('.md') && inner.includes('/')) {
      const rel = inner.replace(/^\.\//, '');
      if (inbound.has(rel)) targets = [rel];
    } else {
      const stem = inner.includes('/') ? inner.split('/').pop() : inner;
      targets = stems.get(stem) || [];
    }
    for (const t of targets) if (t !== f) inbound.set(t, inbound.get(t) + 1);
  }
}

const orphans = files.filter(f => inbound.get(f) === 0);
const written = [];
function w(rel, content) {
  const fp = path.join(BRAIN, rel);
  fs.writeFileSync(fp + '.tmp', content);
  fs.renameSync(fp + '.tmp', fp);
  written.push(rel);
}

// 1) Template Index — เชื่อมทุก template
const tpls = files.filter(f => f.startsWith('40_Templates/'));
const tplRows = tpls.map(t => `- [[${stemOf(t)}]] — \`${t}\``).join('\n');
w('20_Atlas/Template Index.md', `---
title: Template Index
type: moc
created: ${today}
updated: ${today}
---

# Template Index — แม่แบบของสมอง

> กลุ่มระบบ · ศูนย์กลาง: [[Zero]] · ใช้ผ่าน zero_capture / zero_write ของ MCP

${tplRows}
`);

// 2) stub zero-brain-memory ลิงก์ตัวจริงในสมอง (resolve ได้ทั้ง 2 vault)
const zstub = path.join(ATLAS, 'Skills', 'zero-brain-memory.md');
let zs = fs.readFileSync(zstub, 'utf8');
if (!zs.includes('SKILL/zero-brain-memory/SKILL.md]]')) {
  zs = zs.replace(/- ตัวทำงานจริง: .*/,
    '- ตัวทำงานจริง: [[SKILL/zero-brain-memory/SKILL.md|zero-brain-memory/SKILL.md]] (ต้นฉบับอยู่ในสมองจริง)');
  fs.writeFileSync(zstub + '.tmp', zs);
  fs.renameSync(zstub + '.tmp', zstub);
  written.push('20_Atlas/Skills/zero-brain-memory.md');
}

// 3) เดินสาย orphan ใน 20_Atlas เข้า Zero.md system cluster + root md เข้า Home
const atlasOrphans = orphans.filter(f => f.startsWith('20_Atlas/') && f !== '20_Atlas/Zero.md' && f !== '20_Atlas/Template Index.md');
const zeroPath = path.join(ATLAS, 'Zero.md');
let z = fs.readFileSync(zeroPath, 'utf8');
if (atlasOrphans.length && !z.includes('## แผนที่ย่อย')) {
  z += `\n## แผนที่ย่อย (เชื่อมอัตโนมัติ ${today})\n\n` + atlasOrphans.map(f => `- [[${stemOf(f)}]]`).join('\n') + '\n';
  fs.writeFileSync(zeroPath + '.tmp', z);
  fs.renameSync(zeroPath + '.tmp', zeroPath);
  written.push('20_Atlas/Zero.md');
}
const rootOrphans = orphans.filter(f => !f.includes('/'));
const homePath = path.join(ATLAS, 'Home.md');
let h = fs.readFileSync(homePath, 'utf8');
if (rootOrphans.length && !h.includes('## ไฟล์ราก')) {
  h += `\n## ไฟล์ราก (เชื่อมอัตโนมัติ ${today})\n\n` + rootOrphans.map(f => `- [[${stemOf(f)}]]`).join('\n') + '\n';
  fs.writeFileSync(homePath + '.tmp', h);
  fs.renameSync(homePath + '.tmp', homePath);
  written.push('20_Atlas/Home.md');
}

// manifest + audit
const KB = path.join(BRAIN, '.kb');
const mpath = path.join(KB, 'manifest.jsonl');
const lines = fs.readFileSync(mpath, 'utf8').split('\n').filter(Boolean);
const have = new Set(lines.map(l => JSON.parse(l).path));
const out = lines.map(l => {
  const rec = JSON.parse(l);
  if (written.includes(rec.path)) return JSON.stringify({ ...rec, sha256: shaFile(path.join(BRAIN, rec.path)), updated: now });
  return l;
});
const add = written.filter(rel => !have.has(rel)).map(rel => JSON.stringify({
  id: `sysref-${crypto.createHash('sha256').update(rel).digest('hex').slice(0, 8)}`, path: rel,
  type: 'moc', title: stemOf(rel), domain: 'system', privacy: 'T0',
  created: now, updated: now, sha256: shaFile(path.join(BRAIN, rel))
}));
fs.writeFileSync(mpath + '.tmp', out.concat(add).join('\n') + '\n');
fs.renameSync(mpath + '.tmp', mpath);
fs.appendFileSync(path.join(KB, 'audit.jsonl'), JSON.stringify({
  ts: now, actor: 'miru-kimi-work', action: 'brain_fix_orphans', target: 'vault',
  detail: `orphans=${orphans.length}; template_index=${tpls.length} tpls; wired atlas=${atlasOrphans.length} root=${rootOrphans.length}; stub zero-brain-memory linked to real SKILL.md in brain`
}) + '\n');

console.log(JSON.stringify({
  total_notes: files.length, orphans_before: orphans.length,
  orphan_list: orphans.map(f => f),
  wired_atlas: atlasOrphans.map(stemOf), wired_root: rootOrphans.map(stemOf),
  notes_written: written
}, null, 2));
