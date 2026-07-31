#!/usr/bin/env node
/**
 * find-session.mjs — ค้นหาและอ่าน session เก่าจริงจากทุก store (ห้ามเดา)
 *
 * Stores ที่สแกน ( portable ทุกเครื่อง ผูกกับ homedir ):
 *   miru-zero : ~/.miru_zero/sessions/<hash>/<uuid>/context.jsonl (layout เก่า)
 *             + ~/.miru_zero/sessions/wd_*\/session_*\/ (layout ใหม่ = daimon wire
 *               state.json มี isCustomTitle, session_index.jsonl → workDir)
 *   kimi-code : ~/.kimi-code/sessions/<hash>/<uuid>/context.jsonl
 *   daimon    : ~/.zero/share/daimon-share/daimon/runtime/kimi-code/home/sessions/wd_*\/<id>/
 *               (state.json + agents/main/wire.jsonl + session_index.jsonl → workDir
 *                + ชื่อห้องสะอาดจาก agents/main/sessions/hosted-logical/conversations.sqlite)
 *   (ค้นหา normalize ตัวแยก _-/\.: เป็นช่องว่าง — "session boot" เจอ "SESSION_BOOT")
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
import crypto from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';

const HOME = os.homedir();
const MIRU_HOME = path.join(HOME, '.miru_zero');
const DAIMON_HOME = path.join(HOME, '.zero', 'share', 'daimon-share', 'daimon', 'runtime', 'kimi-code', 'home');
const DAIMON_SQLITE = path.resolve(DAIMON_HOME, '..', '..', '..', 'agents', 'main', 'sessions', 'hosted-logical', 'conversations.sqlite');

/** normalize สำหรับค้นหา — ตัวแยก _ - / \ . : เทียบเท่าช่องว่างเดียว (กัน "session boot" พลาด "SESSION_BOOT") */
function norm(s) {
  return String(s || '').toLowerCase().replace(/[_\-\/\\.:]+/g, ' ').replace(/\s+/g, ' ').trim();
}

/** ชื่อห้องสะอาด (ชื่อใน sidebar) จาก hosted-logical sqlite — node:sqlite built-in (node v24) · ล็อก/ไม่รองรับ = คืนแผนที่ว่าง แล้ว fallback ไป title ของ state.json */
function loadSqliteTitles(dbPath) {
  const map = new Map();
  if (!dbPath || !fs.existsSync(dbPath)) return map;
  try {
    const db = new DatabaseSync(dbPath, { readonly: true });
    try {
      const rows = db
        .prepare("SELECT kernel_session_id, title, workspace_path FROM conversations WHERE title IS NOT NULL AND title != ''")
        .all();
      for (const r of rows) {
        if (r.kernel_session_id) {
          map.set(String(r.kernel_session_id), { title: String(r.title || ''), workDir: String(r.workspace_path || '') });
        }
      }
    } finally {
      db.close();
    }
  } catch { /* sqlite ล็อก/อ่านไม่ได้ → fallback state.json */ }
  return map;
}

const STORES = [
  { name: 'miru-zero', root: path.join(MIRU_HOME, 'sessions'), kind: 'context' },
  // layout ใหม่ของ miru-zero (IDE ของเรา) = daimon wire — wd_*/session_*/ (scanner ข้าม hash dir เก่าให้เอง ไม่ซ้ำกับ context)
  { name: 'miru-zero', root: path.join(MIRU_HOME, 'sessions'), kind: 'wire', index: path.join(MIRU_HOME, 'session_index.jsonl'), titlesDb: null },
  { name: 'kimi-code', root: path.join(HOME, '.kimi-code', 'sessions'), kind: 'context' },
  { name: 'daimon', root: path.join(DAIMON_HOME, 'sessions'), kind: 'wire', index: path.join(DAIMON_HOME, 'session_index.jsonl'), titlesDb: DAIMON_SQLITE },
  { name: 'codex', root: path.join(HOME, '.codex', 'sessions'), kind: 'codex' },
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
      // text (kimi/miru) + input_text/output_text (codex rollout)
      if ((b.type === 'text' || b.type === 'input_text' || b.type === 'output_text') && typeof b.text === 'string') texts.push(b.text);
      else if (b.type === 'think' && typeof b.think === 'string') thinks.push(b.think);
    }
    return { text: texts.join('\n'), think: thinks.join('\n') };
  }
  return { text: String(content), think: '' };
}

const isSystemish = (t) =>
  /^<(system|system-reminder|meta|attachment)\b/i.test(t.trim()) ||
  // blob ที่ runtime ฉีดเข้ามา (codex developer/env context) — ไม่ใช่เสียงผู้ใช้จริง
  /^(# AGENTS\.md instructions|<INSTRUCTIONS>|<recommended_plugins>|<environment_context|<user_instructions)/i.test(t.trim());

/** อ่านหัวไฟล์เท่าที่จำเป็น (session meta + ข้อความแรกอยู่หัวเสมอ) — ไฟล์ใหญ่ 4GB ห้ามอ่านทั้งก้อน */
function readHead(file, bytes = 96 * 1024) {
  const fd = fs.openSync(file, 'r');
  try {
    const buf = Buffer.alloc(bytes);
    const n = fs.readSync(fd, buf, 0, bytes, 0);
    return buf.toString('utf8', 0, n);
  } finally { fs.closeSync(fd); }
}

/** อ่านท้ายไฟล์ (ข้อความสุดท้าย/outcome อยู่ท้ายเสมอ) */
function readTail(file, bytes = 256 * 1024) {
  const fd = fs.openSync(file, 'r');
  try {
    const size = fs.fstatSync(fd).size;
    const start = Math.max(0, size - bytes);
    const buf = Buffer.alloc(Math.min(bytes, size));
    const n = fs.readSync(fd, buf, 0, buf.length, start);
    return buf.toString('utf8', 0, n);
  } finally { fs.closeSync(fd); }
}

/** ไฟล์เล็กพอจะอ่านทั้งก้อนไหม (เกินนี้ใช้ head/tail/chunked แทน) */
const FULL_READ_MAX = 3 * 1024 * 1024;
function readIfSmall(file, max = FULL_READ_MAX) {
  try {
    return fs.statSync(file).size <= max ? fs.readFileSync(file, 'utf8') : null;
  } catch { return null; }
}

/** ค้น q (lowercase) ในไฟล์แบบทีละ chunk — คืน snippet รอบจุดแรกที่เจอ หรือ null (ไม่โหลดทั้งไฟล์) */
function chunkedGrep(file, q, { capBytes = 64 * 1024 * 1024 } = {}) {
  const fd = fs.openSync(file, 'r');
  try {
    const size = fs.fstatSync(fd).size;
    const limit = Math.min(size, capBytes);
    const CHUNK = 4 * 1024 * 1024;
    const buf = Buffer.alloc(CHUNK);
    let offset = 0, carry = '';
    while (offset < limit) {
      const n = fs.readSync(fd, buf, 0, Math.min(CHUNK, limit - offset), offset);
      if (n <= 0) break;
      const hay = norm(carry + buf.toString('utf8', 0, n));
      const i = hay.indexOf(q);
      if (i >= 0) return hay.slice(Math.max(0, i - 80), i + q.length + 80);
      carry = hay.slice(-(q.length + 200));
      offset += n;
    }
    return null;
  } finally { fs.closeSync(fd); }
}

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
      const full = readIfSmall(ctx); // ไฟล์ใหญ่อ่านเฉพาะหัว — msgCount = -1 (ไม่นับ)
      let text;
      if (full != null) text = full;
      else {
        msgCount = -1;
        text = readHead(ctx);
      }
      try {
        for (const line of text.split('\n')) {
          if (!line.trim()) continue;
          let d; try { d = JSON.parse(line); } catch { continue; }
          if (msgCount >= 0 && (d.role === 'user' || d.role === 'assistant')) msgCount++;
          if (d.role === 'user') {
            const { text: t } = extractContent(d.content);
            if (t) {
              if (!firstUserAny) firstUserAny = t;
              if (!firstUser && !isSystemish(t)) firstUser = truncate(stripTags(t), 120);
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

function loadSessionIndex(indexPath) {
  const idx = new Map();
  if (!indexPath || !fs.existsSync(indexPath)) return idx;
  try {
    for (const line of fs.readFileSync(indexPath, 'utf8').split('\n')) {
      if (!line.trim()) continue;
      try {
        const d = JSON.parse(line);
        if (d.sessionId) idx.set(d.sessionId, { workDir: d.workDir || '' });
      } catch { /* skip */ }
    }
  } catch { /* skip */ }
  return idx;
}

function scanWireStore(store) {
  const out = [];
  const idx = loadSessionIndex(store.index);
  const titles = loadSqliteTitles(store.titlesDb); // ชื่อห้องสะอาดจาก sidebar (sqlite, ถ้า store มี)
  for (const wdDir of walkDirs(store.root, 0)) {
    if (!path.basename(wdDir).startsWith('wd_')) continue; // wire layout อยู่ใต้ wd_* เท่านั้น — กันกิน hash dir ของ context store ที่ root เดียวกัน (miru-zero)
    for (const sessDir of walkDirs(wdDir, 0)) {
      const id = path.basename(sessDir);
      if (id.startsWith('ctitle-')) continue; // session ภายในสำหรับปั้มชื่อห้อง ไม่ใช่ห้องจริง
      const st = readJsonSafe(path.join(sessDir, 'state.json'));
      if (!st) continue;
      const wire = path.join(sessDir, 'agents', 'main', 'wire.jsonl');
      let msgCount = 0, firstUser = '', firstUserAny = '';
      if (fs.existsSync(wire)) {
        const full = readIfSmall(wire);
        let text;
        if (full != null) text = full;
        else { msgCount = -1; text = readHead(wire); }
        try {
          for (const line of text.split('\n')) {
            if (!line.includes('context.append_message')) continue;
            let d; try { d = JSON.parse(line); } catch { continue; }
            if (d.type !== 'context.append_message' || !d.message) continue;
            const r = d.message.role;
            if (msgCount >= 0 && (r === 'user' || r === 'assistant')) msgCount++;
            if (r === 'user') {
              const { text: t } = extractContent(d.message.content);
              if (t) {
                if (!firstUserAny) firstUserAny = t;
                if (!firstUser && !isSystemish(t)) firstUser = truncate(stripTags(t), 120);
              }
            }
          }
        } catch { /* partial ok */ }
      }
      const t = titles.get(id);
      // title chain: sqlite sidebar → state.title เฉพาะตอนผู้ใช้ตั้งเอง (isCustomTitle) → firstUser (title auto ของ daimon เป็นขยะ raw ห้ามใช้)
      out.push({
        store: store.name, id, dir: sessDir, kind: 'wire',
        title: t?.title || (st.isCustomTitle ? cleanTitle(st.title) : '') || firstUser || truncate(stripTags(firstUserAny), 90),
        workDir: t?.workDir || idx.get(id)?.workDir || '',
        mtime: Date.parse(st.updatedAt || '') || 0,
        msgCount,
      });
    }
  }
  return out;
}

// ---------- codex store (rollout-*.jsonl ใต้ ~/.codex/sessions/YYYY/MM/DD) ----------

function parseCodexSession(file) {
  const p = { id: '', cwd: '', originator: 'codex' };
  let mtime = 0, msgCount = 0, firstUser = '', firstUserAny = '';
  try { mtime = fs.statSync(file).mtimeMs; } catch { return null; }
  const full = readIfSmall(file);
  let text;
  if (full != null) text = full;
  else { msgCount = -1; text = readHead(file); } // rollout ใหญ่ (รวม 4.3GB) อ่านเฉพาะหัว
  try {
    for (const line of text.split('\n')) {
      if (!line.trim()) continue;
      let d; try { d = JSON.parse(line); } catch { continue; }
      const pl = d.payload;
      if (!pl || typeof pl !== 'object') continue;
      if (d.type === 'session_meta') {
        if (pl.id) p.id = String(pl.id);
        if (pl.cwd) p.cwd = String(pl.cwd);
        if (pl.originator) p.originator = String(pl.originator);
        continue;
      }
      if (d.type !== 'response_item' || pl.type !== 'message') continue;
      if (msgCount >= 0 && (pl.role === 'user' || pl.role === 'assistant')) msgCount++;
      if (pl.role === 'user') {
        const { text: t } = extractContent(pl.content);
        if (t) {
          if (!firstUserAny) firstUserAny = t;
          if (!firstUser && !isSystemish(t)) firstUser = truncate(stripTags(t), 120);
        }
      }
    }
  } catch { /* partial ok */ }
  const id = p.id || path.basename(file, '.jsonl');
  return {
    store: 'codex', id, dir: path.dirname(file), file, kind: 'codex',
    title: firstUser || truncate(stripTags(firstUserAny), 90),
    workDir: p.cwd, runtime: p.originator, mtime, msgCount,
  };
}

function scanCodexStore(store) {
  const out = [];
  for (const year of walkDirs(store.root, 0)) {
    for (const month of walkDirs(year, 0)) {
      for (const day of walkDirs(month, 0)) {
        let files;
        try { files = fs.readdirSync(day).filter((f) => f.startsWith('rollout-') && f.endsWith('.jsonl')); } catch { continue; }
        for (const f of files) {
          const s = parseCodexSession(path.join(day, f));
          if (s) out.push(s);
        }
      }
    }
  }
  return out;
}

/** อ่านข้อความจาก codex rollout — message + function_call + function_call_output (ไฟล์ >64MB อ่านหัว+ท้าย) */
function readCodexMessages(file) {
  const msgs = [];
  if (!fs.existsSync(file)) return msgs;
  const full = readIfSmall(file, 64 * 1024 * 1024);
  const text = full != null ? full : readHead(file, 2 * 1024 * 1024) + '\n' + readTail(file, 2 * 1024 * 1024);
  if (full == null) msgs.push({ role: '_notice', text: 'rollout ใหญ่เกิน 64MB — แสดงเฉพาะหัว+ท้ายไฟล์' });
  for (const line of text.split('\n')) {
    if (!line.includes('"response_item"')) continue;
    let d; try { d = JSON.parse(line); } catch { continue; }
    const pl = d.payload;
    if (!pl || typeof pl !== 'object') continue;
    if (d.type === 'response_item' && pl.type === 'message') {
      const { text, think } = extractContent(pl.content);
      msgs.push({ role: pl.role, text, think });
    } else if (d.type === 'response_item' && pl.type === 'function_call') {
      const args = typeof pl.arguments === 'string' ? pl.arguments : JSON.stringify(pl.arguments ?? '');
      msgs.push({ role: 'tool_call', text: `${pl.name ?? '?'} ${args}`.trim() });
    } else if (d.type === 'response_item' && pl.type === 'function_call_output') {
      const out = typeof pl.output === 'string' ? pl.output : JSON.stringify(pl.output ?? '');
      msgs.push({ role: 'tool', text: out });
    }
  }
  return msgs;
}

// ---------- public API ----------
export function listSessions({ limit = 20, store = null, dedupe = true } = {}) {
  let all = [];
  for (const s of STORES) {
    if (store && s.name !== store) continue;
    if (!fs.existsSync(s.root)) continue;
    all = all.concat(s.kind === 'context' ? scanContextStore(s) : s.kind === 'wire' ? scanWireStore(s) : scanCodexStore(s));
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

/** grep ข้อความดิบในไฟล์ context/wire/rollout ของ session — คืน snippet รอบจุดที่เจอ หรือ null (chunked ไม่โหลดทั้งไฟล์) */
function grepSessionContent(sess, q) {
  const files = sess.kind === 'context'
    ? [path.join(sess.dir, 'context.jsonl')]
    : sess.kind === 'codex'
      ? [sess.file]
      : [path.join(sess.dir, 'agents', 'main', 'wire.jsonl')];
  for (const f of files) {
    if (!fs.existsSync(f)) continue;
    const small = readIfSmall(f);
    let snippet;
    if (small != null) {
      const ns = norm(small);
      const i = ns.indexOf(q);
      if (i < 0) continue;
      snippet = ns.slice(Math.max(0, i - 80), i + q.length + 80);
    } else {
      snippet = chunkedGrep(f, q);
      if (snippet == null) continue;
    }
    try {
      // พยายามดึงเฉพาะ field text ถ้า parse ได้ — ถ้าไม่ได้ใช้ดิบ
      return truncate(stripTags(JSON.parse(`{"t":${JSON.stringify(snippet)}}`).t), 200);
    } catch { return truncate(stripTags(snippet), 200); }
  }
  return null;
}

export function findSessions(query, { limit = 20, content = false } = {}) {
  const q = norm(query);
  if (!q) return [];
  const all = listSessions({ limit: 100000 });
  const hits = [];
  for (const s of all) {
    const meta = norm(s.id).includes(q) || norm(s.title).includes(q) || norm(s.workDir).includes(q);
    if (meta) { hits.push(s); continue; }
    if (content) {
      const snippet = grepSessionContent(s, q);
      if (snippet != null) hits.push({ ...s, snippet });
    }
    if (hits.length >= limit) break;
  }
  return hits.slice(0, limit);
}

// ---------- match: "เคยทำเรื่องนี้ไหม วิธีไหน ได้ผลไหม" ----------

/**
 * อ่าน session 1 ครั้ง → { forkKey, lastText, tools }
 * forkKey = hash ของ user texts ช่วงหัว (1200 ตัวแรก) — ห้อง fork/ลองซ้ำ share prefix เดียวกัน
 * (heuristic ไม่ใช่หลักฐาน fork 100%: ห้องที่ diverge เร็วมากอาจหลุดกลุ่ม ห้องที่เหมือนกันยาวอาจรวมกัน)
 */
function enrichSession(sess) {
  const f = sess.kind === 'context'
    ? path.join(sess.dir, 'context.jsonl')
    : sess.kind === 'codex'
      ? sess.file
      : path.join(sess.dir, 'agents', 'main', 'wire.jsonl');
  const userTexts = [], userTextsNonSystem = [];
  const tools = new Set();
  let lastText = '', lastTextAny = '';
  if (fs.existsSync(f)) {
    try {
      // ไฟล์เล็ก: parse ทั้งหมดแม่น / ไฟล์ใหญ่: หัว (forkKey+tools ช่วงต้น) + ท้าย (outcome+tools ช่วงจบ)
      const full = readIfSmall(f);
      const text = full != null ? full : readHead(f) + '\n' + readTail(f);
      for (const line of text.split('\n')) {
        if (!line.trim()) continue;
        let d; try { d = JSON.parse(line); } catch { continue; }
        let role, content, toolCalls;
        if (sess.kind === 'context') {
          role = d.role; content = d.content; toolCalls = d.tool_calls;
        } else if (sess.kind === 'codex') {
          const pl = d.payload;
          if (!pl || typeof pl !== 'object') continue;
          if (d.type === 'response_item' && pl.type === 'message') {
            role = pl.role; content = pl.content;
          } else if (d.type === 'response_item' && pl.type === 'function_call') {
            if (pl.name) tools.add(String(pl.name));
            continue;
          } else if (d.type === 'response_item' && pl.type === 'function_call_output') {
            role = 'tool'; content = typeof pl.output === 'string' ? pl.output : JSON.stringify(pl.output ?? '');
          } else continue;
        } else {
          if (d.type !== 'context.append_message' || !d.message) continue;
          role = d.message.role; content = d.message.content;
        }
        if (role === 'user') {
          const { text } = extractContent(content);
          if (text) {
            userTexts.push(stripTags(text));
            if (!isSystemish(text)) userTextsNonSystem.push(stripTags(text));
          }
        }
        if (Array.isArray(toolCalls)) {
          for (const t of toolCalls) {
            const n = t?.function?.name ?? t?.name;
            if (n) tools.add(n);
          }
        }
        if (role === 'user' || role === 'assistant' || role === 'tool') {
          const { text } = extractContent(content);
          if (text) {
            lastTextAny = truncate(stripTags(text), 150);
            if (!isSystemish(text)) lastText = lastTextAny;
          }
        }
      }
    } catch { /* partial ok */ }
  }
  const joined = (userTextsNonSystem.length ? userTextsNonSystem : userTexts).join('\n');
  const forkKey = crypto.createHash('sha1').update(joined.slice(0, 1200)).digest('hex').slice(0, 10);
  return { forkKey, lastText: lastText || lastTextAny, tools: [...tools] };
}

/**
 * matchSessions(query) — ค้นเนื้อแชททุก session แล้วจับกลุ่มห้อง fork/ลองซ้ำ:
 * แสดง 1 รายการต่อกลุ่ม อ้างอิง N uuid + tools ที่เคยใช้ + outcome hint (ข้อความสุดท้ายของห้องใหม่สุด)
 */
export function matchSessions(query, { limit = 20 } = {}) {
  const q = norm(query);
  if (!q) return [];
  const groups = new Map();
  for (const s of listSessions({ limit: 100000 })) {
    // ชื่อห้อง/id/workDir match ก็นับ — ไม่บังคับ grep เนื้อ (กัน "session boot" พลาดห้อง SESSION_BOOT)
    const metaHit = norm(s.id).includes(q) || norm(s.title).includes(q) || norm(s.workDir).includes(q);
    const snippet = metaHit ? `[ชื่อห้อง] ${s.title || s.id}` : grepSessionContent(s, q);
    if (snippet == null) continue;
    const e = enrichSession(s);
    let g = groups.get(e.forkKey);
    if (!g) {
      g = { key: e.forkKey, refs: [], count: 0, title: '', snippet, outcome_hint: '', tools: new Set(), mtime: 0 };
      groups.set(e.forkKey, g);
    }
    g.count += 1;
    g.refs.push({ store: s.store, id: s.id, ...(s.alsoIn?.length ? { alsoIn: s.alsoIn } : {}) });
    for (const t of e.tools) g.tools.add(t);
    if (s.mtime >= g.mtime) {
      g.mtime = s.mtime; g.title = s.title; g.snippet = snippet; g.outcome_hint = e.lastText;
    }
  }
  return [...groups.values()]
    .map((g) => ({ ...g, tools: [...g.tools] }))
    .sort((a, b) => b.mtime - a.mtime)
    .slice(0, limit);
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
    : session.kind === 'codex'
      ? readCodexMessages(session.file)
      : readWireMessages(session.dir);

  const VISIBLE = full ? null : new Set(['user', 'assistant', 'tool', 'tool_call']);
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
    session: { store: session.store, id: session.id, dir: session.dir, title: session.title, workDir: session.workDir || undefined, runtime: session.runtime || undefined, msgCount: session.msgCount, mtime: new Date(session.mtime).toISOString() },
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
    const msgs = s.msgCount < 0 ? '?' : String(s.msgCount);
    console.log(`${s.store.padEnd(9)} ${s.id.slice(0, 13).padEnd(14)} ${t}  msgs:${msgs.padStart(4)}  ${truncate(s.title || '(no title)', 90)}${dup}`);
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
  } else if (cmd === 'match') {
    const q = args.find((a) => !a.startsWith('--'));
    if (!q) { console.error('ใส่คำค้น: match <query>'); process.exit(2); }
    const groups = matchSessions(q, { limit });
    if (json) return console.log(JSON.stringify(groups, null, 2));
    for (const g of groups) {
      const t = new Date(g.mtime).toISOString().slice(0, 16).replace('T', ' ');
      console.log(`● ${g.count > 1 ? `fork ${g.count} ห้อง` : '1 ห้อง'}  ${t}  ${truncate(g.title || '(no title)', 80)}`);
      console.log(`  refs: ${g.refs.map((r) => `${r.id.slice(0, 8)}…(${r.store}${r.alsoIn ? '+' + r.alsoIn.length : ''})`).join(', ')}`);
      if (g.tools.length) console.log(`  tools เคยใช้: ${g.tools.join(', ')}`);
      if (g.outcome_hint) console.log(`  outcome hint: ${g.outcome_hint}`);
      console.log(`  ⌕ …${g.snippet}…`);
    }
    console.log(`— ${groups.length} กลุ่ม`);
  } else if (cmd === 'read') {
    const id = args.find((a) => !a.startsWith('--') && a !== argValue(args, '--limit', null));
    if (!id) { console.error('ใส่ id: read <id|prefix>'); process.exit(2); }
    const r = readSession(id, { limit, full: args.includes('--full'), archives: args.includes('--archives') });
    if (r.error) { console.error(r.error); if (r.candidates) console.error(JSON.stringify(r.candidates, null, 2)); process.exit(1); }
    if (json) return console.log(JSON.stringify(r, null, 2));
    const s = r.session;
    console.log(`# ${s.store} ${s.id}\n# title: ${s.title}\n# dir: ${s.dir}${s.workDir ? `\n# workDir: ${s.workDir}` : ''}${s.runtime ? `\n# runtime: ${s.runtime}` : ''}\n# msgs: ${s.msgCount} | แสดง ${r.shown}/${r.total}\n`);
    r.messages.forEach((m, i) => {
      const tag = m.role === 'user' ? '👤' : m.role === 'assistant' ? '🤖' : '🔧';
      console.log(`[${i}] ${tag} ${m.role}${m.tool_calls ? ' +tool_calls' : ''}${m.file ? ` (${m.file})` : ''}`);
      if (m.text) console.log(`    ${m.text.replace(/\n/g, '\n    ')}`);
      if (m.think) console.log(`    💭 ${truncate(m.think, 200)}`);
    });
  } else {
    console.log(`find-session — ค้น+อ่าน session เก่าจริง
  list [--limit N] [--store miru-zero|kimi-code|daimon|codex] [--json]
  find <query> [--content] [--limit N] [--json]   ค้น id/ชื่อห้อง(sidebar)/workDir (+เนื้อแชทถ้า --content) — ตัวแยก _-. ไม่มีผล
  match <query> [--limit N] [--json]              "เคยทำไหม วิธีไหน ผลไง" — match ชื่อห้อง+เนื้อ จับกลุ่มห้อง fork แสดง 1 อ้างอิง N uuid
  read <id|prefix> [--limit N] [--full] [--archives] [--json]`);
    process.exit(cmd ? 2 : 0);
  }
}

if (process.argv[1] && import.meta.url === new URL(`file:///${process.argv[1].replace(/\\/g, '/')}`).href) {
  main().catch((e) => { console.error(e.message); process.exit(1); });
}
