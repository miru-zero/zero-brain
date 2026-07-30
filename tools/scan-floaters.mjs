// จำลอง Obsidian resolution: stem → shortest path ชนะ / path → exact หรือ suffix match
// รายงาน ghost links + zero-inbound (orphan) แยกตาม 2 vault semantics
import fs from 'node:fs';
import path from 'node:path';
import { homedir } from 'node:os';

// portable: argv[2] = zero zone root (default ~/.zero) · ZERO_BRAIN_ROOT override brain
const ZERO = process.argv[2] ?? path.join(homedir(), '.zero');
const BRAIN = process.env.ZERO_BRAIN_ROOT ?? path.join(ZERO, 'brain');

function walk(dir, base, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) { if (!e.name.startsWith('.')) walk(p, base, out); }
    else if (e.name.endsWith('.md')) out.push(path.relative(base, p).replace(/\\/g, '/'));
  }
  return out;
}

const brainFiles = walk(BRAIN, BRAIN);
const zeroFiles = walk(ZERO, ZERO).filter(f => !f.startsWith('.obsidian') && !f.startsWith('brain/.obsidian'));

function makeResolver(files) {
  const noExt = files.map(f => f.replace(/\.md$/, ''));
  return (inner) => {
    if (inner.includes('/')) {
      if (noExt.includes(inner)) return inner;
      const suf = noExt.filter(f => f.endsWith('/' + inner));
      if (suf.length) return suf.sort((a, b) => a.length - b.length)[0];
      return null;
    }
    const matches = noExt.filter(f => f.split('/').pop() === inner);
    if (matches.length) return matches.sort((a, b) => a.length - b.length)[0];
    return null;
  };
}

const LINK_RE = /\[\[([^\]]+)\]\]/g;
function scan(files, base, brainPrefix) {
  const resolve = makeResolver(files);
  const inbound = new Map(files.map(f => [f.replace(/\.md$/, ''), 0]));
  const ghosts = new Map();
  for (const f of files) {
    if (brainPrefix && !f.startsWith('brain/')) continue; // อ่านลิงก์จากโน้ตสมองเท่านั้น
    let txt;
    try { txt = fs.readFileSync(path.join(base, f), 'utf8'); } catch { continue; }
    for (const m of txt.matchAll(LINK_RE)) {
      const inner = m[1].split('|')[0].split('#')[0].trim().replace(/\.md$/, '');
      if (!inner) continue;
      const hit = resolve(inner);
      if (!hit) {
        if (!ghosts.has(inner)) ghosts.set(inner, new Set());
        ghosts.get(inner).add(f);
      } else if (hit !== f.replace(/\.md$/, '')) {
        inbound.set(hit, (inbound.get(hit) || 0) + 1);
      }
    }
  }
  const brainSet = brainPrefix
    ? brainFiles.map(f => ('brain/' + f).replace(/\.md$/, ''))
    : brainFiles.map(f => f.replace(/\.md$/, ''));
  const orphans = brainSet.filter(f => (inbound.get(f) || 0) === 0);
  return { orphan_count: orphans.length, orphans, ghost_kinds: ghosts.size, ghosts_top: [...ghosts.entries()].map(([g, from]) => ({ ghost: g, count: from.size })).sort((a, b) => b.count - a.count).slice(0, 10) };
}

console.log(JSON.stringify({
  brain_vault_view: scan(brainFiles, BRAIN, false),
  zero_vault_view: scan(zeroFiles, ZERO, true)
}, null, 2));
