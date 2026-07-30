#!/usr/bin/env node
/**
 * backup-edit.mjs — TIMELINE backup ก่อนแก้ไฟล์ (แบบ VSCode Timeline แต่เก็บในสมอง)
 * กฎ: ก่อนแก้/ลบไฟล์ใดก็ตามที่ไม่ใช่ไฟล์สมอง ให้สำเนาต้นฉบับเข้า
 *   ~/.zero/brain/99_System/backup_edit/<วันที่>/<เวลา>__<path-encoded>.bak
 * ทุกครั้งได้ไฟล์ใหม่ (ไม่ทับ) — ย้อนได้เสมอโดยไม่ต้องพึ่ง git
 *
 * ใช้:
 *   node tools/backup-edit.mjs <file...>                 สำเนาก่อนแก้ (พิมพ์ JSON ต่อบรรทัด)
 *   node tools/backup-edit.mjs --list <file>             ดู timeline ของไฟล์
 *   node tools/backup-edit.mjs --restore <file> [--at <YYYYMMDD-HHmmss>]  ย้อน (สำเนาปัจจุบันก่อนเสมอ)
 *   node tools/backup-edit.mjs --init-workspace <dir>    สร้าง .zero/{logs,tmp,out} + .gitignore ในโปรเจ็ค
 *
 * หมายเหตุ: นามสกุล .bak เสมอ — backup ของ .md จะไม่ไปปนใน Obsidian graph
 */
import { appendFileSync, copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";

const ROOT = path.resolve(process.env.ZERO_BRAIN_ROOT ?? path.join(homedir(), ".zero", "brain"));
const BASE = path.join(ROOT, "99_System", "backup_edit");

function stamp(d = new Date()) {
  const p = (n, w = 2) => String(n).padStart(w, "0");
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}
/** stamp แบบไม่ชนกัน: มีมิลลิวินาที + ถ้ายังชน (backup ถี่ใน ms เดียวกัน) ต่อท้าย -n */
function uniqueBakPath(dir, abs) {
  const p = (n, w = 2) => String(n).padStart(w, "0");
  const d = new Date();
  const base = `${stamp(d)}-${p(d.getMilliseconds(), 3)}`;
  let name = `${base}__${encode(abs)}.bak`;
  let i = 1;
  while (existsSync(path.join(dir, name))) {
    name = `${base}-${i}__${encode(abs)}.bak`;
    i++;
  }
  return path.join(dir, name);
}
function todayStr() {
  return stamp().slice(0, 8);
}
/** เข้ารหัส path ให้เป็นชื่อไฟล์เดียว — C:\a\b\c.js → C_a_b_c.js */
function encode(p) {
  return p.replace(/^([A-Za-z]):/, "$1").replace(/[\\/]/g, "_");
}

function manifestFile() {
  return path.join(BASE, "index.jsonl");
}
function appendManifest(e) {
  mkdirSync(BASE, { recursive: true });
  appendFileSync(manifestFile(), JSON.stringify(e) + "\n", "utf8");
}
function readManifest() {
  if (!existsSync(manifestFile())) return [];
  const out = [];
  for (const line of readFileSync(manifestFile(), "utf8").split(/\r?\n/)) {
    const t = line.trim();
    if (!t) continue;
    try { out.push(JSON.parse(t)); } catch { /* ข้ามบรรทัดเสีย */ }
  }
  return out;
}

function backupOne(file) {
  const abs = path.resolve(file);
  if (!existsSync(abs)) throw new Error(`ไม่พบไฟล์: ${abs}`);
  const dir = path.join(BASE, todayStr());
  mkdirSync(dir, { recursive: true });
  const bak = uniqueBakPath(dir, abs);
  copyFileSync(abs, bak);
  // manifest ts = timestamp ในชื่อไฟล์เป๊ะๆ (มี ms+counter) — --at ชี้ได้ทีละ snapshot ไม่ชนกัน
  const ts = path.basename(bak).split("__")[0];
  appendManifest({ ts, src: abs, bak });
  return { src: abs, bak };
}

function initWorkspace(dir) {
  const abs = path.resolve(dir);
  if (!existsSync(abs)) throw new Error(`ไม่พบโปรเจ็ค: ${abs}`);
  const z = path.join(abs, ".zero");
  for (const sub of ["logs", "tmp", "out"]) {
    mkdirSync(path.join(z, sub), { recursive: true });
  }
  const gi = path.join(z, ".gitignore");
  if (!existsSync(gi)) {
    writeFileSync(gi, "# .zero/ เป็นพื้นที่ทำงานส่วนตัวของ agent — git ไม่ track\n*\n", "utf8");
  }
  console.log(JSON.stringify({ ok: true, workspace: z, dirs: ["logs", "tmp", "out"] }));
}

// ---------- main ----------
const args = process.argv.slice(2);
try {
  if (args[0] === "--init-workspace") {
    if (!args[1]) throw new Error("ต้องระบุ dir");
    initWorkspace(args[1]);
  } else if (args[0] === "--list") {
    if (!args[1]) throw new Error("ต้องระบุ file");
    const abs = path.resolve(args[1]);
    const hits = readManifest().filter((e) => e.src === abs);
    console.log(JSON.stringify({ file: abs, count: hits.length, backups: hits.map((h) => ({ ts: h.ts, bak: h.bak })) }, null, 2));
  } else if (args[0] === "--restore") {
    if (!args[1]) throw new Error("ต้องระบุ file");
    const abs = path.resolve(args[1]);
    const atIdx = args.indexOf("--at");
    const at = atIdx >= 0 ? args[atIdx + 1] : undefined;
    const hits = readManifest().filter((e) => e.src === abs && (!at || e.ts === at));
    if (hits.length === 0) throw new Error(`ไม่มี backup ของ ${abs}${at ? ` ที่ ${at}` : ""}`);
    const latest = hits[hits.length - 1];
    if (existsSync(abs)) {
      const cur = backupOne(abs); // กฎ: ก่อนย้อนต้องสำเนาปัจจุบัน — timeline ไม่เสียอะไรเลย
      console.log(JSON.stringify({ backed_up_current: cur.bak }));
    }
    copyFileSync(latest.bak, abs);
    console.log(JSON.stringify({ ok: true, restored: abs, from: latest.bak, ts: latest.ts }));
  } else if (args.length > 0) {
    for (const f of args) {
      console.log(JSON.stringify(backupOne(f)));
    }
  } else {
    console.error("ใช้: backup-edit.mjs <file...> | --list <file> | --restore <file> [--at ts] | --init-workspace <dir>");
    process.exit(1);
  }
} catch (e) {
  console.error(JSON.stringify({ error: e instanceof Error ? e.message : String(e) }));
  process.exit(1);
}
