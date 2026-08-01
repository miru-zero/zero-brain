#!/usr/bin/env node
/**
 * setup-cli.mjs — ฝังคำสั่ง `zero` ลง global (เรียกจาก install.ps1 ขั้น 7 / รันเองก็ได้)
 *
 * ทำ 3 อย่าง (idempotent):
 *   1. เขียน shim ~/.zero/bin/zero.cmd (Windows) + ~/.zero/bin/zero (unix) — ชี้ node แบบ absolute
 *   2. เพิ่ม ~/.zero/bin เข้า User PATH ผ่าน registry (HKCU\Environment) — ไม่ใช้ setx (truncate 1024)
 *   3. collision check — หา zero.* ตัวอื่นที่มาก่อน shim เราใน PATH แล้วเตือนดังๆ
 *      (บทเรียนจริง: shim เก่า .local/bin/zero.bat ชน ทำ zero health หลุดไปหา kimi CLI)
 * PATH เปลี่ยนแล้วต้องเปิด terminal ใหม่ถึงมีผล — แจ้งเสมอ
 */
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const RepoDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const BIN = path.join(homedir(), ".zero", "bin");
const zeroMjs = path.join(RepoDir, "tools", "zero.mjs");
const absNode = process.execPath;
const norm = (p) => p.replace(/[\\/]+$/, "").toLowerCase();

function queryReg(root) {
  try {
    const out = execFileSync("reg", ["query", root, "/v", "Path"], { encoding: "utf8", stdio: ["pipe", "pipe", "pipe"] });
    return /Path\s+REG(?:_EXPAND)?_SZ\s+(.*)/i.exec(out)?.[1]?.trim() ?? "";
  } catch { return ""; }
}

mkdirSync(BIN, { recursive: true });

// 1) shim ทั้งสองแบบ (เขียนทับทุกครั้ง — เนื้อมาจาก repo ปัจจุบันเสมอ)
const cmdShim = path.join(BIN, "zero.cmd");
writeFileSync(cmdShim, `@echo off\r\n"${absNode}" "${zeroMjs}" %*\r\n`);
const shShim = path.join(BIN, "zero");
writeFileSync(shShim, `#!/bin/sh\nexec "${absNode}" "${zeroMjs}" "$@"\n`);
try { chmodSync(shShim, 0o755); } catch { /* Windows ไม่ต้อง chmod */ }
console.log(`[zero-cli] shim พร้อม: ${cmdShim}`);

if (process.platform !== "win32") {
  console.log(`[zero-cli] unix: เพิ่ม ${BIN} เข้า PATH ใน shell profile เอง (shim พร้อมแล้ว)`);
  process.exit(0);
}

// 2) User PATH — อ่าน/เขียน registry ตรงๆ ไม่ผ่าน setx
const cur = queryReg("HKCU\\Environment");
const hasBin = cur.split(";").filter(Boolean).some((p) => norm(p) === norm(BIN));
if (hasBin) {
  console.log("[zero-cli] PATH มี ~/.zero/bin อยู่แล้ว");
} else {
  const next = cur ? cur.replace(/;+$/, "") + ";" + BIN : BIN;
  try {
    execFileSync("reg", ["add", "HKCU\\Environment", "/v", "Path", "/t", "REG_EXPAND_SZ", "/d", next, "/f"], { stdio: "pipe" });
    console.log(`[zero-cli] เพิ่ม ${BIN} เข้า User PATH แล้ว — เปิด terminal ใหม่เพื่อใช้ zero ได้ทุกที่`);
  } catch (e) {
    // PATH พังไม่ถือว่า install พัง — shim ยังเรียกตรงๆ ได้
    console.log(`[zero-cli] เตือน: เขียน PATH ไม่สำเร็จ (${e.message}) — เพิ่ม ${BIN} เข้า PATH เองภายหลัง`);
  }
}

// 3) collision check — ใครชนะ zero ใน PATH (Machine ก่อน User ตามกฎ cmd)
const expand = (s) => s.replace(/%([^%]+)%/g, (_, n) => process.env[n] ?? `%${n}%`);
const ZERO_NAMES = ["zero.cmd", "zero.bat", "zero.exe", "zero.ps1", "zero"];
const merged = [queryReg("HKLM\\SYSTEM\\CurrentControlSet\\Control\\Session Manager\\Environment"), queryReg("HKCU\\Environment")].join(";");
const dirs = merged.split(";").filter(Boolean).map(expand);
let winner = null;
for (const d of dirs) {
  for (const n of ZERO_NAMES) {
    const p = path.join(d, n);
    if (existsSync(p)) { winner = p; break; }
  }
  if (winner) break;
}
if (!winner) {
  console.log("[zero-cli] เตือน: PATH ยังไม่มี zero ตัวไหนเลย — เปิด terminal ใหม่ก่อนใช้");
} else if (norm(winner) === norm(cmdShim)) {
  console.log("[zero-cli] collision check: shim เราชนะ (priority แรก)");
} else {
  // ตัวชนะไม่ใช่ shim เรา — ถ้าเนื้อมันชี้กลับมาหาเรา (delegation) ถือว่าโอเค ไม่งั้นเตือนดังๆ
  let delegates = false;
  try { delegates = readFileSync(winner, "utf8").includes(".zero\\bin\\zero.cmd"); } catch { /* exe/อ่านไม่ได้ */ }
  if (delegates) {
    console.log(`[zero-cli] collision check: ${winner} มาก่อน แต่ delegate มาที่ shim เรา — OK`);
  } else {
    console.log(`[zero-cli] ⚠ COLLISION: ${winner} มาก่อน shim เราใน PATH — คำสั่ง zero จะไปหาโปรแกรมนั้น!`);
    console.log(`[zero-cli]    แก้โดย: เปลี่ยนเนื้อไฟล์นั้นให้ชี้มาที่ ${cmdShim} (backup ก่อนเสมอ)`);
  }
}
