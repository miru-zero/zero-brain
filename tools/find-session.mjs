#!/usr/bin/env node
/**
 * find-session.mjs — ค้นหาและอ่าน session เก่าจริงจากทุก store (ห้ามเดา)
 *
 * Stores ที่สแกน ( portable ทุกเครื่อง ผูกกับ homedir ):
 *   miru-zero : ~/.miru_zero/sessions/<hash>/<uuid>/context.jsonl
 *   kimi-code : ~/.kimi-code/sessions/<hash>/<uuid>/context.jsonl
 *   daimon    : ~/.zero/share/daimon-share/daimon/runtime/kimi-code/home/sessions/wd_*\/<id>/
 *               (state.json + agents/main/wire.jsonl + session_index.jsonl → workDir)
 *
 * CLI:
 *   node find-session.mjs list [--limit N] [--store S] [--json]
 *   node find-session.mjs find <query> [--limit N] [--json]
 *   node find-session.mjs read <id|prefix> [--limit N] [--full] [--archives] [--json]
 *
 * ใช้เป็น library ได้: import { listSessions, findSessions, readSession } from './find-session.mjs'
 */
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const HOME = os.homedir();
const DAIMON_HOME = path.join(HOME, '.zero', 'share', 'daimon-share', 'daimon', 'runtime', 'kimi-code', 'home');

const STORES = [
  { name: 'miru-zero', root: path.join(HOME, '.miru_zero', 'sessions'), kind: 'context' },
  { name: 'kimi-code', root: path.join(HOME, '.kimi-code', 'sessions'), kind: 'context' },
  { name: 'daimon', root: path.join(DAIMON_HOME, 'sessions'), kind: 'wire' },
];

// ---------- helpers ----------
function* walkDirs(root, depth) {
  if (depth < 0 || !fs.existsSync(root)) return;
  let entries;
  try { entries = fs.readdirSync(root, { withFileTypes: true }); } catch { return; }
  for (const e of entries) {
    if (!e.isDirectory()) continue;
    const p = path.join(root, e.name);
    yield p;
    if (depth > 0) yield* walkDirs(p, depth - 1);
  }
}

function readJsonSafe(p) {
  try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return null; }
}

/** content อาจเป็น string หรือ array of blocks — คืน { text, think } */
function extractContent(content) {
  if (content == null) return { text: '', think: '' };
  if (typeof content === 'string') return { text: content, think: '' };
  if (Array.isArray(content)) {
    const texts = [], thinks = [];
    for (const b of content) {
      if (!b || typeof b !== 'object') continue;
      if (b.type === 'text' && typeof b.text === 'string') texts.push(b.text);
      else if (b.type === 'think' && typeof b.think === 'string') thinks.push(b.think);
    }
    return { text: texts.join('\n'), think: thinks.join('\n') };
  }
  return { text: String(content), think: '' };
}

const isSystemish = (t) => /^<(system|system-reminder|meta|attachment)\b/i.test(t.trim());

/** ตัด tag ของ runtime (<meta .../>, <attachment>…</attachment>, <system>…</system>) ออกจากข้อความ */
function stripTags(t) {
  return (t || '')
    .replace(/<meta\b[^>]*\/?>/gi, ' ')
    .replace(/<attachment>[\s\S]*?<\/attachment>/gi, ' ')
    .replace(/<\/?system-reminder\b[^>]*>/gi, ' ')
    .replace(/<\/?system\b[^>]*>/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function cleanTitle(t) {
  if (!t || typeof t !== 'string') return '';
  return stripTags(t);
}

function truncate(s, n = 160) {
  s = (s || '').replace(/\s+/g, ' ').trim();
  return s.length > n ? s.slice(0, n - 1) + '…' : s;
}

// ---------- store scanners ----------
function scanContextStore(store) {
  // root/<hash>/<uuid>/context.jsonl
  const out = [];
  for (const hashDir of walkDirs(store.root, 0)) {
    for (const sessDir of walkDirs(hashDir, 0)) {
      const ctx = path.join(sessDir, 'context.jsonl');
      if (!fs.existsSync(ctx)) continue;
      const id = path.basename(sessDir);
      const st = readJsonSafe(path.join(sessDir, 'state.json'));
      let mtime = 0, msgCount = 0, firstUser = '', firstUserAny = '';
      try { mtime = fs.statSync(ctx).mtimeMs; } catch { /* skip */ }
      try {
        for (const line of fs.readFileSync(ctx, 'utf8').split('\n')) {
          if (!line.trim()) continue;
          let d; try { d = JSON.parse(line); } catch { continue; }
          if (d.role === 'user' || d.role === 'assistant') msgCount++;
          if (d.role === 'user') {
            const { text } = extractContent(d.content);
            if (text) {
              if (!firstUserAny) firstUserAny = text;
              if (!firstUser && !isSystemish(text)) firstUser = truncate(stripTags(text), 120);
            }
          }
        }
      } catch { continue; }
      out.push({
        store: store.name, id, dir: sessDir, kind: 'context',
        title: cleanTitle(st?.custom_title) || firstUser || truncate(stripTags(firstUserAny), 90),
        mtime, msgCount,
      });
    }
  }
  return out;
}

function loadDaimonIndex() {
  const idx = new Map();
  const p = path.join(DAIMON_HOME, 'session_index.jsonl');
  if (!fs.existsSync(p)) return idx;
  try {
    for (const line of fs.readFileSync(p, 'utf8').split('\n')) {
      if (!line.trim()) continue;
      try {
        const d = JSON.parse(line);
        if (d.sessionId) idx.set(d.sessionId, { workDir: d.workDir || '' });
      } catch { /* skip */ }
    }
  } catch { /* skip */ }
  return idx;
}

function scanDaimonStore(store) {
  const out = [];
  const idx = loadDaimonIndex();
  for (const wdDir of walkDirs(store.root, 0)) {
    for (const sessDir of walkDirs(wdDir, 0)) {
      const st = readJsonSafe(path.join(sessDir, 'state.json'));
      if (!st) continue;
      const id = path.basename(sessDir);
      const wire = path.join(sessDir, 'agents', 'main', 'wire.jsonl');
      let msgCount = 0, firstUser = '', firstUserAny = '';
      if (fs.existsSync(wire)) {
        try {
          for (const line of fs.readFileSync(wire, 'utf8').split('\n')) {
            if (!line.includes('context.append_message')) continue;
            let d; try { d = JSON.parse(line); } catch { continue; }
            if (d.type !== 'context.append_message' || !d.message) continue;
            const r = d.message.role;
            if (r === 'user' || r === 'assistant') msgCount++;
            if (r === 'user') {
              const { text } = extractContent(d.message.content);
              if (text) {
                if (!firstUserAny) firstUserAny = text;
                if (!firstUser && !isSystemish(text)) firstUser = truncate(stripTags(text), 120);
              }
            }
          }
        } catch { /* partial ok */ }
      }
      out.push({
        store: store.name, id, dir: sessDir, kind: 'wire',
        title: cleanTitle(st.title) || firstUser || truncate(stripTags(firstUserAny), 90),
        workDir: idx.get(id)?.workDir || '',
        mtime: Date.parse(st.updatedAt || '') || 0,
        msgCount,
      });
    }
  }
  return out;
}

// ---------- public API ----------
export function listSessions({ limit = 20, store = null, dedupe = true } = {}) {
  let all = [];
  for (const s of STORES) {
    if (store && s.name !== store) continue;
    if (!fs.existsSync(s.root)) continue;
    all = all.concat(s.kind === 'context' ? scanContextStore(s) : scanDaimonStore(s));
  }
  all.sort((a, b) => b.mtime - a.mtime);
  if (dedupe) {
    // session เดียวกันอาจมีสำเนาในหลาย store (เช่น miru-zero ↔ kimi-code sync กัน) — เก็บตัวใหม่สุด จำ store อื่นไว้ใน alsoIn
    const byId = new Map();
    for (const s of all) {
      const cur = byId.get(s.id);
      if (cur) cur.alsoIn = [...(cur.alsoIn || []), s.store];
      else byId.set(s.id, { ...s });
    }
    all = [...byId.values()];
  }
  return all.slice(0, limit);
}

/** grep ข้อความดิบในไฟล์ context/wire ของ session — คืน snippet รอบจุดที่เจอ หรือ null */
function grepSessionContent(sess, q) {
  const files = sess.kind === 'context'
    ? [path.join(sess.dir, 'context.jsonl')]
    : [path.join(sess.dir, 'agents', 'main', 'wire.jsonl')];
  for (const f of files) {
    if (!fs.existsSync(f)) continue;
    let raw;
    try { raw = fs.readFileSync(f, 'utf8'); } catch { continue; }
    const i = raw.toLowerCase().indexOf(q);
    if (i < 0) continue;
    const snippet = raw.slice(Math.max(0, i - 80), i + q.length + 80);
    try {
      // พยายามดึงเฉพาะ field text ถ้า parse ได้ — ถ้าไม่ได้ใช้ดิบ
      return truncate(stripTags(JSON.parse(`{"t":${JSON.stringify(snippet)}}`).t), 200);
    } catch { return truncate(stripTags(snippet), 200); }
  }
  return null;
}

export function findSessions(query, { limit = 20, content = false } = {}) {
  const q = String(query || '').toLowerCase();
  if (!q) return [];
  const all = listSessions({ limit: 100000 });
  const hits = [];
  for (const s of all) {
    const meta = s.id.toLowerCase().includes(q) || (s.title || '').toLowerCase().includes(q) || (s.workDir || '').toLowerCase().includes(q);
    if (meta) { hits.push(s); continue; }
    if (content) {
      const snippet = grepSessionContent(s, q);
      if (snippet != null) hits.push({ ...s, snippet });
    }
    if (hits.length >= limit) break;
  }
  return hits.slice(0, limit);
}

function resolveSession(idOrPrefix) {
  const q = String(idOrPrefix).toLowerCase();
  const hits = listSessions({ limit: 100000 }).filter((s) => s.id.toLowerCase() === q || s.id.toLowerCase().startsWith(q));
  if (hits.length === 0) return { error: `ไม่พบ session '${idOrPrefix}' ในทุก store` };
  if (hits.length > 1) {
    return { error: `เจอ ${hits.length} session ขึ้นต้นด้วย '${idOrPrefix}' — ระบุให้ยาวขึ้น`, candidates: hits.map((h) => ({ store: h.store, id: h.id, title: h.title })) };
  }
  return { session: hits[0] };
}

function readContextMessages(sessDir, { archives = false } = {}) {
  const files = ['context.jsonl'];
  if (archives) {
    try {
      const extra = fs.readdirSync(sessDir)
        .filter((f) => /^context_\d+\.jsonl$/.test(f))
        .sort((a, b) => parseInt(a.match(/\d+/)[0], 10) - parseInt(b.match(/\d+/)[0], 10));
      files.push(...extra);
    } catch { /* skip */ }
  }
  const msgs = [];
  for (const f of files) {
    const p = path.join(sessDir, f);
    if (!fs.existsSync(p)) continue;
    for (const line of fs.readFileSync(p, 'utf8').split('\n')) {
      if (!line.trim()) continue;
      let d; try { d = JSON.parse(line); } catch { continue; }
      msgs.push({ role: d.role, ...extractContent(d.content), file: f, hasToolCalls: !!d.tool_calls });
    }
  }
  return msgs;
}

function readWireMessages(sessDir) {
  const wire = path.join(sessDir, 'agents', 'main', 'wire.jsonl');
  const msgs = [];
  if (!fs.existsSync(wire)) return msgs;
  for (const line of fs.readFileSync(wire, 'utf8').split('\n')) {
    if (!line.includes('append_message')) continue;
    let d; try { d = JSON.parse(line); } catch { continue; }
    if (d.type !== 'context.append_message' || !d.message) continue;
    msgs.push({ role: d.message.role, ...extractContent(d.message.content) });
  }
  return msgs;
}

export function readSession(idOrPrefix, { limit = 40, full = false, archives = false } = {}) {
  const { session, error, candidates } = resolveSession(idOrPrefix);
  if (error) return { error, candidates };
  const raw = session.kind === 'context'
    ? readContextMessages(session.dir, { archives })
    : readWireMessages(session.dir);

  const VISIBLE = full ? null : new Set(['user', 'assistant', 'tool']);
  const msgs = raw
    .filter((m) => (full ? m.text || m.think : VISIBLE.has(m.role)))
    .map((m) => ({
      role: m.role,
      text: full ? m.text : truncate(m.text, 300),
      ...(full && m.think ? { think: m.think } : {}),
      ...(m.hasToolCalls ? { tool_calls: true } : {}),
      ...(m.file && m.file !== 'context.jsonl' ? { file: m.file } : {}),
    }));
  return {
    session: { store: session.store, id: session.id, dir: session.dir, title: session.title, workDir: session.workDir || undefined, msgCount: session.msgCount, mtime: new Date(session.mtime).toISOString() },
    total: msgs.length,
    shown: Math.min(msgs.length, limit),
    messages: msgs.slice(-limit),
  };
}

// ---------- CLI ----------
function argValue(args, flag, dflt) {
  const i = args.indexOf(flag);
  return i >= 0 && args[i + 1] != null ? args[i + 1] : dflt;
}

function printList(items, json) {
  if (json) return console.log(JSON.stringify(items, null, 2));
  for (const s of items) {
    const t = new Date(s.mtime).toISOString().slice(0, 16).replace('T', ' ');
    const dup = s.alsoIn?.length ? ` (+${s.alsoIn.join(',')})` : '';
    console.log(`${s.store.padEnd(9)} ${s.id.slice(0, 13).padEnd(14)} ${t}  msgs:${String(s.msgCount).padStart(4)}  ${truncate(s.title || '(no title)', 90)}${dup}`);
    if (s.workDir) console.log(`           ↳ ${s.workDir}`);
    if (s.snippet) console.log(`           ⌕ …${s.snippet}…`);
  }
  console.log(`— ${items.length} session`);
}

async function main() {
  const [cmd, ...args] = process.argv.slice(2);
  const json = args.includes('--json');
  const limit = parseInt(argValue(args, '--limit', '20'), 10) || 20;

  if (cmd === 'list') {
    printList(listSessions({ limit, store: argValue(args, '--store', null) }), json);
  } else if (cmd === 'find') {
    const q = args.find((a) => !a.startsWith('--'));
    if (!q) { console.error('ใส่คำค้น: find <query>'); process.exit(2); }
    printList(findSessions(q, { limit, content: args.includes('--content') }), json);
  } else if (cmd === 'read') {
    const id = args.find((a) => !a.startsWith('--') && a !== argValue(args, '--limit', null));
    if (!id) { console.error('ใส่ id: read <id|prefix>'); process.exit(2); }
    const r = readSession(id, { limit, full: args.includes('--full'), archives: args.includes('--archives') });
    if (r.error) { console.error(r.error); if (r.candidates) console.error(JSON.stringify(r.candidates, null, 2)); process.exit(1); }
    if (json) return console.log(JSON.stringify(r, null, 2));
    const s = r.session;
    console.log(`# ${s.store} ${s.id}\n# title: ${s.title}\n# dir: ${s.dir}${s.workDir ? `\n# workDir: ${s.workDir}` : ''}\n# msgs: ${s.msgCount} | แสดง ${r.shown}/${r.total}\n`);
    r.messages.forEach((m, i) => {
      const tag = m.role === 'user' ? '👤' : m.role === 'assistant' ? '🤖' : '🔧';
      console.log(`[${i}] ${tag} ${m.role}${m.tool_calls ? ' +tool_calls' : ''}${m.file ? ` (${m.file})` : ''}`);
      if (m.text) console.log(`    ${m.text.replace(/\n/g, '\n    ')}`);
      if (m.think) console.log(`    💭 ${truncate(m.think, 200)}`);
    });
  } else {
    console.log(`find-session — ค้น+อ่าน session เก่าจริง
  list [--limit N] [--store miru-zero|kimi-code|daimon] [--json]
  find <query> [--content] [--limit N] [--json]   ค้น id/title/workDir (+เนื้อแชทถ้า --content)
  read <id|prefix> [--limit N] [--full] [--archives] [--json]`);
    process.exit(cmd ? 2 : 0);
  }
}

if (process.argv[1] && import.meta.url === new URL(`file:///${process.argv[1].replace(/\\/g, '/')}`).href) {
  main().catch((e) => { console.error(e.message); process.exit(1); });
}
