#!/usr/bin/env node
/**
 * backup-edit.mjs — TIMELINE backup ก่อนแก้ไฟล์ (แบบ VSCode Timeline แต่เก็บในสมอง)
 * กฎ: ก่อนแก้/ลบไฟล์ใดก็ตามที่ไม่ใช่ไฟล์สมอง ให้สำเนาต้นฉบับเข้า
 *
 * layout (อ่าน path รู้เลยว่างานไหน ไฟล์ไหน — ป๊าสั่ง 2026-08-08):
 *   ~/.zero/brain/99_System/backup_edit/<โปรเจ็ค>/<โฟลเดอร์ย่อย...>/<ชื่อ_สกุล>/<วันที่>/<เวลา>.<สกุลจริง>
 *   เช่น M:\Zero_Lab\nodeAPI\WEB\zero.js → backup_edit/zero_lab/nodeAPI/WEB/zero_js/20260807/20260807-085647-070.js
 * - โปรเจ็ค = โฟลเดอร์แรกใต้ไดรฟ์ (path ใต้ Users\<name>\ ข้ามไปเอาชั้นถัดไป) — normalize เป็นตัวเล็ก
 * - ทุกครั้งได้ไฟล์ใหม่ (ไม่ทับ) — ย้อนได้เสมอโดยไม่ต้องพึ่ง git
 * - dedupe: เนื้อไฟล์ซ้ำ snapshot ล่าสุด (sha256) → ข้าม ไม่สร้าง blob เปล่า (ประหยัดดิสก์/เวลา)
 * - INDEX.md ที่ root สรุปกี่โปรเจ็ค โปรเจ็คละกี่ไฟล์/กี่ snapshot (Obsidian เปิดดูได้)
 *
 * ใช้:
 *   node tools/backup-edit.mjs <file...>                 สำเนาก่อนแก้ (พิมพ์ JSON ต่อบรรทัด)
 *   node tools/backup-edit.mjs --list <file>             ดู timeline ของไฟล์
 *   node tools/backup-edit.mjs --restore <file> [--at <YYYYMMDD-HHmmss>]  ย้อน (สำเนาปัจจุบันก่อนเสมอ)
 *   node tools/backup-edit.mjs --migrate                 ย้าย layout เก่า (<วันที่>/<ts>__<encoded>.bak) → layout ใหม่
 *   node tools/backup-edit.mjs --index                   สร้าง INDEX.md ใหม่จาก manifest
 *   node tools/backup-edit.mjs --init-workspace <dir>    สร้าง .zero/{logs,tmp,out} + .gitignore ในโปรเจ็ค
 */
import { appendFileSync, copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmdirSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { homedir } from "node:os";
import path from "node:path";

const ROOT = path.resolve(process.env.ZERO_BRAIN_ROOT ?? path.join(homedir(), ".zero", "brain"));
const BASE = path.join(ROOT, "99_System", "backup_edit");

function stamp(d = new Date()) {
  const p = (n, w = 2) => String(n).padStart(w, "0");
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}
function todayStr() {
  return stamp().slice(0, 8);
}
/** normalize ชื่อโฟลเดอร์: ตัวเล็ก อักขระนอกเหนือ a-z0-9/ไทย → _ */
function norm(s) {
  return (
    s
      .toLowerCase()
      .replace(/[^a-z0-9ก-๙]+/g, "_")
      .replace(/_{2,}/g, "_")
      .replace(/^_+|_+$/g, "") || "x"
  );
}
function sha256file(p) {
  return createHash("sha256").update(readFileSync(p)).digest("hex");
}

/**
 * แยก abs path → layout: { project, mids, fileFolder, realExt }
 * - project: โฟลเดอร์แรกใต้ไดรฟ์ · ถ้าอยู่ใต้ Users\<name>\ ข้ามไปเอาชั้นถัดไป (เช่น Documents→ชื่อโปรเจ็คจริง)
 * - mids: โฟลเดอร์ย่อยระหว่าง project กับไฟล์ (คงชื่อเดิม)
 * - fileFolder: <ชื่อไฟล์>_<สกุล> เช่น zero.js → zero_js
 */
function layoutFor(abs) {
  const parsed = path.parse(abs);
  const drive = parsed.root.replace(/^[A-Za-z]:.*/, (m) => m[0]).toLowerCase() || "drive";
  const dirOnly = path.dirname(abs).replace(/^[A-Za-z]:[\\/]?/, "");
  const segs = dirOnly.split(/[\\/]/).filter(Boolean);
  let project, mids;
  if (segs.length === 0) {
    project = `${drive}_root`;
    mids = [];
  } else if (segs[0].toLowerCase() === "users" && segs.length >= 3) {
    project = norm(segs[2]);
    mids = segs.slice(3);
  } else {
    project = norm(segs[0]);
    mids = segs.slice(1);
  }
  const realExt = parsed.ext.replace(/^\./, "").toLowerCase();
  const fileFolder = norm(parsed.name) + (realExt ? `_${norm(realExt)}` : "");
  return { project, mids, fileFolder, realExt };
}

/** stamp แบบไม่ชนกัน: มีมิลลิวินาที + ถ้ายังชน (backup ถี่ใน ms เดียวกัน) ต่อท้าย -n */
function uniqueBakPath(dir, realExt) {
  const p = (n, w = 2) => String(n).padStart(w, "0");
  const d = new Date();
  const base = `${stamp(d)}-${p(d.getMilliseconds(), 3)}`;
  const ext = realExt || "bak";
  let name = `${base}.${ext}`;
  let i = 1;
  while (existsSync(path.join(dir, name))) {
    name = `${base}-${i}.${ext}`;
    i++;
  }
  return path.join(dir, name);
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
    try {
      out.push(JSON.parse(t));
    } catch {
      /* ข้ามบรรทัดเสีย */
    }
  }
  return out;
}

/** INDEX.md ที่ root — สรุปกี่โปรเจ็ค โปรเจ็คละกี่ไฟล์/กี่ snapshot (อ่านใน Obsidian ได้) */
function rebuildIndex() {
  const entries = readManifest();
  const byProject = new Map(); // project -> { files:Set<src>, snapshots, latest }
  for (const e of entries) {
    const { project } = layoutFor(e.src ?? "");
    if (!byProject.has(project)) byProject.set(project, { files: new Set(), snapshots: 0, latest: "" });
    const g = byProject.get(project);
    g.files.add(e.src);
    g.snapshots++;
    if ((e.ts ?? "") > g.latest) g.latest = e.ts;
  }
  const totalFiles = new Set(entries.map((e) => e.src)).size;
  const lines = [
    `# Backup Edit — INDEX`,
    ``,
    `กฎ: [[Edit Backup and Workspace Rules]] · ศูนย์กลาง: [[Zero]]`,
    ``,
    `อัปเดตล่าสุด: ${stamp()} · โปรเจ็ค: ${byProject.size} · ไฟล์ที่มี backup: ${totalFiles} · snapshots: ${entries.length}`,
    ``,
    `| โปรเจ็ค | ไฟล์ | snapshots | snapshot ล่าสุด |`,
    `|---|---|---|---|`,
  ];
  for (const [proj, g] of [...byProject.entries()].sort()) {
    lines.push(`| ${proj} | ${g.files.size} | ${g.snapshots} | ${g.latest} |`);
  }
  lines.push(``, `> layout: \\<โปรเจ็ค\\>/\\<โฟลเดอร์ย่อย...\\>/\\<ชื่อ_สกุล\\>/\\<วันที่\\>/\\<เวลา\\>.\\<สกุลจริง\\> — เครื่องมือ: \`tools/backup-edit.mjs\` (manifest: index.jsonl)`);
  mkdirSync(BASE, { recursive: true });
  writeFileSync(path.join(BASE, "INDEX.md"), lines.join("\n") + "\n", "utf8");
}

function backupOne(file) {
  const abs = path.resolve(file);
  if (!existsSync(abs)) throw new Error(`ไม่พบไฟล์: ${abs}`);
  const hash = sha256file(abs);
  // dedupe: เนื้อซ้ำ snapshot ล่าสุด → ไม่สร้าง blob เปล่า
  const prev = readManifest().filter((e) => e.src === abs);
  const latest = prev[prev.length - 1];
  if (latest?.hash === hash) {
    return { src: abs, skipped: "unchanged", bak: latest.bak };
  }
  const { project, mids, fileFolder, realExt } = layoutFor(abs);
  const dir = path.join(BASE, project, ...mids, fileFolder, todayStr());
  mkdirSync(dir, { recursive: true });
  const bak = uniqueBakPath(dir, realExt);
  copyFileSync(abs, bak);
  // manifest ts = timestamp ในชื่อไฟล์เป๊ะๆ (มี ms+counter) — --at ชี้ได้ทีละ snapshot ไม่ชนกัน
  const ts = path.basename(bak).replace(/\.[^.]+$/, "");
  appendManifest({ ts, src: abs, bak, hash });
  rebuildIndex();
  return { src: abs, bak };
}

/** ย้าย layout เก่า (<วันที่>/<ts>__<encoded>.bak) → layout ใหม่ (โปรเจ็ค/โฟลเดอร์/ชื่อ_สกุล/วันที่) */
function migrate() {
  const entries = readManifest();
  if (entries.length === 0) {
    console.log(JSON.stringify({ ok: true, moved: 0, note: "ไม่มี backup ให้ย้าย" }));
    return;
  }
  const out = [];
  let moved = 0;
  let kept = 0;
  const missing = [];
  for (const e of entries) {
    const isOldLayout = path.basename(e.bak ?? "").includes("__");
    if (!isOldLayout) {
      kept++;
      out.push(e);
      continue;
    }
    if (!existsSync(e.bak)) {
      missing.push(e.bak);
      out.push(e); // เก็บ entry ไว้เป็นหลักฐาน แม้ไฟล์หาย
      continue;
    }
    const { project, mids, fileFolder } = layoutFor(e.src);
    const realExt = path.extname(e.src).replace(/^\./, "").toLowerCase() || "bak";
    const date = (e.ts ?? todayStr()).slice(0, 8);
    const dir = path.join(BASE, project, ...mids, fileFolder, date);
    mkdirSync(dir, { recursive: true });
    let name = `${e.ts}.${realExt}`;
    let i = 1;
    while (existsSync(path.join(dir, name))) {
      name = `${e.ts}-${i}.${realExt}`;
      i++;
    }
    const to = path.join(dir, name);
    renameSync(e.bak, to);
    out.push({ ...e, bak: to });
    moved++;
  }
  writeFileSync(manifestFile(), out.map((x) => JSON.stringify(x)).join("\n") + "\n", "utf8");
  // ล้างโฟลเดอร์วันที่เก่า (<BASE>/YYYYMMDD) ที่ว่างแล้ว
  let cleaned = 0;
  for (const d of readdirSync(BASE, { withFileTypes: true })) {
    if (d.isDirectory() && /^\d{8}$/.test(d.name)) {
      try {
        rmdirSync(path.join(BASE, d.name));
        cleaned++;
      } catch {
        /* ยังไม่ว่าง — ข้าม */
      }
    }
  }
  rebuildIndex();
  console.log(JSON.stringify({ ok: true, moved, kept, missing: missing.length, cleaned_dirs: cleaned }, null, 2));
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
    writeFileSync(gi, "# .zero/ เป็นพื้นที่ทำงานส่วนตัวของ agent — git ไม่ track\n# ยกเว้น ZERO.md (anchor กฎโปรเจ็ค — commit ได้ถ้าทีมอยากแชร์)\n*\n!ZERO.md\n", "utf8");
  }
  // ZERO.md — md ยึดที่โปรเจ็ค: agent ที่มาทำงานอ่านกฎชุดเดียวกันทุกรอบ ไม่ใช่สั่งรอบเดียวจบ
  const zm = path.join(z, "ZERO.md");
  if (!existsSync(zm)) {
    const name = path.basename(abs);
    writeFileSync(zm, [
      `# ZERO — ${name}`,
      ``,
      `โปรเจ็คนี้ผูกกับ zero-brain (สมองกลางที่ \`~/.zero/brain\`) — agent ทุกตัวที่มาทำงานที่นี่อ่านไฟล์นี้ก่อนและยึดกฎทุกรอบ`,
      ``,
      `## สมอง`,
      `- MCP server: \`zero-brain\` (tools ขึ้นต้น \`zero_*\`) — vault: \`~/.zero/brain\``,
      `- Project Scope ของโปรเจ็คนี้: \`<!-- ใส่ id/title ของ Scope ใน 10_Notes/Projects -->\``,
      `- ค้นบริบทก่อนทำงาน: \`zero_search\` / \`zero_home\``,
      ``,
      `## กฎทำงานในโปรเจ็คนี้`,
      `1. แก้ไฟล์สำคัญ → สำเนาก่อนทุกครั้ง: \`node ~/.zero/mcp/zero-brain/tools/backup-edit.mjs <file>\` (timeline ย้อนได้ไม่ต้องพึ่ง git)`,
      `2. log / tmp / output ของ agent → ใส่ \`.zero/\` (logs/, tmp/, out/) เท่านั้น ห้ามวางมั่วที่ root โปรเจ็ค`,
      `3. โน้ตใหม่ห้ามลอย — ทุก \`zero_write_note\` ต้อง links เข้า Scope หรือ MOC อย่างน้อย 1 เส้น (กราฟ Obsidian เห็นเฉพาะ [[wikilinks]] ใน body — zero-brain regenerate block ให้อัตโนมัติ)`,
      `4. จบงาน → \`zero_capture\` สรุปสิ่งที่ทำ/ตัดสินใจ แล้วลิงก์เข้า Project Scope ข้างบน`,
      ``,
    ].join("\n"), "utf8");
  }
  console.log(JSON.stringify({ ok: true, workspace: z, dirs: ["logs", "tmp", "out"], anchor: zm }));
}

// ---------- main ----------
const args = process.argv.slice(2);
try {
  if (args[0] === "--init-workspace") {
    if (!args[1]) throw new Error("ต้องระบุ dir");
    initWorkspace(args[1]);
  } else if (args[0] === "--migrate") {
    migrate();
  } else if (args[0] === "--index") {
    rebuildIndex();
    console.log(JSON.stringify({ ok: true, index: path.join(BASE, "INDEX.md") }));
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
      console.log(JSON.stringify({ backed_up_current: cur.bak ?? cur.skipped }));
    }
    copyFileSync(latest.bak, abs);
    console.log(JSON.stringify({ ok: true, restored: abs, from: latest.bak, ts: latest.ts }));
  } else if (args.length > 0) {
    for (const f of args) {
      console.log(JSON.stringify(backupOne(f)));
    }
  } else {
    console.error("ใช้: backup-edit.mjs <file...> | --list <file> | --restore <file> [--at ts] | --migrate | --index | --init-workspace <dir>");
    process.exit(1);
  }
} catch (e) {
  console.error(JSON.stringify({ error: e instanceof Error ? e.message : String(e) }));
  process.exit(1);
}
