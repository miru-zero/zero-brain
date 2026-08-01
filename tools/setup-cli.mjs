#!/usr/bin/env node
/**
 * setup-cli.mjs — ฝังคำสั่ง `zero` ลง global (เรียกจาก install.ps1 ขั้น 6 / รันเองก็ได้)
 *
 * ทำ 2 อย่าง (idempotent):
 *   1. เขียน shim ~/.zero/bin/zero.cmd (Windows) + ~/.zero/bin/zero (unix) — ชี้ node แบบ absolute
 *   2. เพิ่ม ~/.zero/bin เข้า User PATH ผ่าน registry (HKCU\Environment) — ไม่ใช้ setx (truncate 1024)
 * PATH เปลี่ยนแล้วต้องเปิด terminal ใหม่ถึงมีผล — แจ้งเสมอ
 */
import { chmodSync, mkdirSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const RepoDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const BIN = path.join(homedir(), ".zero", "bin");
const zeroMjs = path.join(RepoDir, "tools", "zero.mjs");
const absNode = process.execPath;

mkdirSync(BIN, { recursive: true });

// 1) shim ทั้งสองแบบ (เขียนทับทุกครั้ง — เนื้อมาจาก repo ปัจจุบันเสมอ)
const cmdShim = path.join(BIN, "zero.cmd");
writeFileSync(cmdShim, `@echo off\r\n"${absNode}" "${zeroMjs}" %*\r\n`);
const shShim = path.join(BIN, "zero");
writeFileSync(shShim, `#!/bin/sh\nexec "${absNode}" "${zeroMjs}" "$@"\n`);
try { chmodSync(shShim, 0o755); } catch { /* Windows ไม่ต้อง chmod */ }
console.log(`[zero-cli] shim พร้อม: ${cmdShim}`);

// 2) User PATH (Windows) — อ่าน/เขียน registry ตรงๆ ไม่ผ่าน setx
if (process.platform === "win32") {
  let cur = "";
  try {
    const out = execFileSync("reg", ["query", "HKCU\\Environment", "/v", "Path"], { encoding: "utf8", stdio: ["pipe", "pipe", "pipe"] });
    cur = /Path\s+REG(?:_EXPAND)?_SZ\s+(.*)/i.exec(out)?.[1]?.trim() ?? "";
  } catch { /* ยังไม่มีค่า Path — จะสร้างใหม่ */ }
  const norm = (p) => p.replace(/[\\/]+$/, "").toLowerCase();
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
} else {
  console.log(`[zero-cli] unix: เพิ่ม ${BIN} เข้า PATH ใน shell profile เอง (shim พร้อมแล้ว)`);
}
