// re-hash ทุกไฟล์ .md ใน brain แล้วอัพเดต sha256 ใน .kb/manifest.jsonl + audit
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const ROOT = 'C:/Users/Administrator/.zero/brain';
const KB = path.join(ROOT, '.kb');
const now = new Date().toISOString();

const sha = (p) => crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');

const lines = fs.readFileSync(path.join(KB, 'manifest.jsonl'), 'utf8').split('\n').filter(Boolean);
let updated = 0, missing = 0;
const out = lines.map((l) => {
  const rec = JSON.parse(l);
  const fp = path.join(ROOT, rec.path);
  if (!fs.existsSync(fp)) { missing++; return l; }
  const h = sha(fp);
  if (h !== rec.sha256) {
    updated++;
    return JSON.stringify({ ...rec, sha256: h, updated: now });
  }
  return l;
});

const tmp = path.join(KB, 'manifest.jsonl.tmp');
fs.writeFileSync(tmp, out.join('\n') + '\n');
fs.renameSync(tmp, path.join(KB, 'manifest.jsonl'));

const audit = { ts: now, actor: 'miru-kimi-work', action: 'brain_fix_path_links', target: 'vault', detail: `rewrote 83 legacy path wikilinks in 24 files; re-hashed manifest (${updated} records updated, ${missing} missing files)` };
fs.appendFileSync(path.join(KB, 'audit.jsonl'), JSON.stringify(audit) + '\n');
console.log(JSON.stringify({ manifest_records: lines.length, updated, missing }, null, 2));
