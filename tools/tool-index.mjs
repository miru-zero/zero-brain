#!/usr/bin/env node
/**
 * tool-index.mjs — สแกนเครื่องมือในเครื่องนี้ แล้วเขียน "Tool Index" เข้าสมอง (20_Atlas)
 *
 * ไอเดียยืมจาก reverse-skill (tool-index auto-scan) แต่เขียนผ่าน MCP zero_write_note/zero_update_note
 * เท่านั้น — กฎสมอง: ห้ามแตะไฟล์ vault ตรง (manifest จะพัง)
 *
 * ใช้:  node tools/tool-index.mjs        (หรือ `zero tools` หลังติดตั้ง CLI)
 * ทำซ้ำได้เรื่อยๆ — ถ้ามีโน้ต Tool Index อยู่แล้วจะอัปเดตใบเดิม ไม่สร้างซ้ำ
 */
import { spawn, spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const RepoDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const dist = path.join(RepoDir, "dist", "index.js");
if (!existsSync(dist)) {
  console.error("✗ ไม่เจอ dist/index.js — รัน npm run build ก่อน");
  process.exit(1);
}

const IS_WIN = process.platform === "win32";
const WHERE = IS_WIN ? "where" : "which";

/** รายการเครื่องมือที่สนใจ — [ชื่อ, คำสั่งเช็ค, arg เวอร์ชัน] */
const CANDIDATES = [
  ["node", "node", "--version"],
  ["npm", IS_WIN ? "npm.cmd" : "npm", "--version"],
  ["python", "python", "--version"],
  ["pip", IS_WIN ? "pip.cmd" : "pip", "--version"],
  ["git", "git", "--version"],
  ["java", "java", "-version"],
  ["jadx", "jadx", "--version"],
  ["apktool", IS_WIN ? "apktool.bat" : "apktool", "--version"],
  ["adb", "adb", "version"],
  ["frida", "frida", "--version"],
  ["radare2", "radare2", "-v"],
  ["nmap", "nmap", "--version"],
  ["tshark", "tshark", "--version"],
  ["openssl", "openssl", "version"],
  ["docker", "docker", "--version"],
  ["gh", "gh", "--version"],
  ["code", IS_WIN ? "code.cmd" : "code", "--version"],
  ["pwsh", "pwsh", "--version"],
  ["obsidian-cli", IS_WIN ? "Obsidian.com" : "obsidian", "--version"],
];

function findOnPath(cmd) {
  const r = spawnSync(WHERE, [cmd], { encoding: "utf8", timeout: 5000 });
  if (r.status !== 0) return null;
  const first = (r.stdout || "").split(/\r?\n/).map((s) => s.trim()).filter(Boolean)[0];
  return first ?? null;
}

function getVersion(cmd, arg) {
  const r = spawnSync(cmd, [arg], { encoding: "utf8", timeout: 5000 });
  const out = `${r.stdout ?? ""}${r.stderr ?? ""}`.split(/\r?\n/).map((s) => s.trim()).filter(Boolean)[0];
  return out ? out.slice(0, 80) : null;
}

console.log(`สแกน ${CANDIDATES.length} เครื่องมือ...`);
const rows = [];
for (const [name, cmd, varg] of CANDIDATES) {
  const p = findOnPath(cmd);
  const ver = p ? getVersion(cmd, varg) : null;
  rows.push({ name, ok: !!p, ver: ver ?? "-", path: p ?? "-" });
}
const found = rows.filter((r) => r.ok).length;
console.log(`เจอ ${found}/${rows.length}`);

const now = new Date().toISOString();
const host = os.hostname();
const table = rows
  .map((r) => `| ${r.name} | ${r.ok ? "✅" : "❌"} | ${r.ver.replace(/\|/g, "/")} | ${r.ok ? "`" + r.path.replace(/`/g, "'") + "`" : "-"} |`)
  .join("\n");
const body = `# Tool Index — ${host}

สแกนอัตโนมัติโดย tools/tool-index.mjs (zero tools) — เจาะจงเครื่องนี้เครื่องเดียว ย้ายเครื่องต้องสแกนใหม่

- เวลาสแกน: ${now}
- OS: ${os.platform()} ${os.arch()} (${os.release()})
- ผล: เจอ ${found}/${rows.length}

| tool | มีไหม | version | path |
|---|---|---|---|
${table}
`;

// ---------- เขียนเข้าสมองผ่าน MCP stdio ----------
const srv = spawn(process.execPath, [dist], { stdio: ["pipe", "pipe", "pipe"] });
let buf = "";
const pending = new Map();
let nextId = 1;
srv.stdout.on("data", (d) => {
  buf += d.toString();
  let i;
  while ((i = buf.indexOf("\n")) >= 0) {
    const line = buf.slice(0, i).trim();
    buf = buf.slice(i + 1);
    if (!line) continue;
    try {
      const msg = JSON.parse(line);
      if (msg.id && pending.has(msg.id)) { pending.get(msg.id)(msg); pending.delete(msg.id); }
    } catch { /* ignore non-json */ }
  }
});
function call(method, params) {
  const id = nextId++;
  return new Promise((resolve, reject) => {
    pending.set(id, resolve);
    srv.stdin.write(JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n");
    setTimeout(() => { if (pending.has(id)) { pending.delete(id); reject(new Error("timeout")); } }, 20000);
  });
}
const textOf = (r) => r.result?.content?.map((c) => c.text).join("\n") ?? "";

await call("initialize", { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "zero-tool-index", version: "1" } });
srv.stdin.write(JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }) + "\n");

// หา hub กลาง (MOC "Zero") ไว้ผูกลิงก์กัน orphan — ถ้าไม่เจอ (สมองใหม่มาก) ข้ามเงียบๆ
const hubSearch = await call("tools/call", { name: "zero_search", arguments: { query: "Zero", type: "moc", limit: 10 } });
let hubId = null;
try {
  const j = JSON.parse(textOf(hubSearch));
  hubId = j.results?.find((x) => x.title === "Zero")?.id ?? null;
} catch { /* no hub */ }

// หาโน้ต Tool Index เดิม (ของเครื่องนี้) — มีแล้วอัปเดต ไม่สร้างซ้ำ
const search = await call("tools/call", { name: "zero_search", arguments: { query: `Tool Index — ${host}`, limit: 5 } });
let existingId = null;
try {
  const j = JSON.parse(textOf(search));
  existingId = j.results?.find((x) => x.title === `Tool Index — ${host}`)?.id ?? null;
} catch { /* treat as not found */ }

let noteId = existingId;
if (existingId) {
  const r = await call("tools/call", { name: "zero_update_note", arguments: { id: existingId, body, title: `Tool Index — ${host}` } });
  console.log("อัปเดตโน้ตเดิม:", textOf(r).slice(0, 200));
} else {
  const r = await call("tools/call", {
    name: "zero_write_note",
    arguments: { title: `Tool Index — ${host}`, body, type: "moc", domain: "system", tags: ["tool-index", "inventory"] },
  });
  const out = textOf(r);
  console.log("สร้างโน้ตใหม่:", out.slice(0, 200));
  try { noteId = JSON.parse(out).id ?? null; } catch { /* keep null */ }
}
if (hubId && noteId) {
  const r = await call("tools/call", { name: "zero_link", arguments: { from_id: noteId, to_id: hubId, rel: "part_of" } });
  console.log("ผูกเข้า hub:", textOf(r).slice(0, 160));
} else {
  console.log("! ไม่เจอ hub MOC หรือ note id — ข้ามการผูกลิงก์");
}
srv.kill();
process.exit(0);
