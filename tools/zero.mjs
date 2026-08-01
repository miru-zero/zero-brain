#!/usr/bin/env node
/**
 * zero — CLI กลางของระบบ zero (คำสั่งเดียวครบทุกอย่าง)
 *
 * ติดตั้งลง PATH อัตโนมัติตอน install (tools/setup-cli.mjs → ~/.zero/bin)
 * ใช้ได้จากทุกที่:  zero <command> [args...]
 *
 *   zero init [dir]     วิเคราะห์โปรเจ็ค + ผูก agent เข้าระบบ zero (AGENTS.md + .zero/ZERO.md)
 *   zero health         เช็คสมองผ่าน MCP จริง (notes/orphans/dead links)
 *   zero backup <file>  สำเนาไฟล์เข้า timeline ก่อนแก้ (ย้อนได้ไม่ต้องพึ่ง git)
 *   zero setup          ผูก zero เข้าทุก agent client (codex / kimi-claw / kimi-code / daimon)
 *   zero obsidian       ซ่อน non-brain + จัดกลุ่มสี graph
 *   zero verify         เช็ค install ครบ 3 ชั้น
 *   zero smoke          รัน smoke test 121 ข้อ
 */
import { spawn, spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const RepoDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const T = (f) => path.join(RepoDir, "tools", f);

const CMDS = {
  init: { run: T("zero-init.mjs"), desc: "วิเคราะห์โปรเจ็ค + ผูก agent เข้าระบบ zero [dir]" },
  backup: { run: T("backup-edit.mjs"), desc: "สำเนาไฟล์เข้า timeline ก่อนแก้ <file...>" },
  setup: { run: T("setup-agents.mjs"), desc: "ผูก zero เข้าทุก agent client" },
  obsidian: { run: T("setup-obsidian.mjs"), desc: "ซ่อน non-brain + จัดกลุ่มสี graph" },
  cli: { run: T("setup-cli.mjs"), desc: "ติดตั้งคำสั่ง zero ลง PATH อีกครั้ง" },
  verify: { run: T("verify-install.mjs"), desc: "เช็ค install ครบ 3 ชั้น" },
  smoke: { run: path.join(RepoDir, "test", "smoke.mjs"), desc: "รัน smoke test" },
};

function help() {
  console.log("zero — CLI ของระบบ zero-brain\n");
  console.log("  zero health          เช็คสมองผ่าน MCP จริง");
  for (const [k, v] of Object.entries(CMDS)) console.log(`  zero ${k.padEnd(10)} ${v.desc}`);
  console.log("\n  zero help            คำสั่งทั้งหมด");
}

/** zero_health ผ่าน MCP stdio จริง (spawn dist/index.js คุย JSON-RPC ตรงๆ) */
function health() {
  return new Promise((resolve) => {
    const dist = path.join(RepoDir, "dist", "index.js");
    if (!existsSync(dist)) {
      console.error("✗ ไม่เจอ dist/index.js — รัน npm run build ก่อน");
      return resolve(1);
    }
    const srv = spawn(process.execPath, [dist], { stdio: ["pipe", "pipe", "pipe"] });
    let buf = "";
    const res = new Map();
    srv.stdout.on("data", (d) => {
      buf += d.toString();
      let i;
      while ((i = buf.indexOf("\n")) >= 0) {
        const line = buf.slice(0, i).trim();
        buf = buf.slice(i + 1);
        if (!line) continue;
        try { const m = JSON.parse(line); if (m.id) res.set(m.id, m); } catch { /* ข้าม */ }
      }
    });
    const send = (o) => srv.stdin.write(JSON.stringify(o) + "\n");
    const wait = (id, ms = 8000) => new Promise((ok, no) => {
      const t0 = Date.now();
      const iv = setInterval(() => {
        if (res.has(id)) { clearInterval(iv); ok(res.get(id)); }
        else if (Date.now() - t0 > ms) { clearInterval(iv); no(new Error("timeout")); }
      }, 50);
    });
    (async () => {
      try {
        send({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "zero-cli", version: "1" } } });
        await wait(1);
        send({ jsonrpc: "2.0", method: "notifications/initialized" });
        send({ jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "zero_health", arguments: {} } });
        const r = await wait(2);
        const text = r.result?.content?.[0]?.text;
        if (text) {
          try {
            const j = JSON.parse(text);
            const c = j.counts ?? {};
            console.log(`สมอง: notes=${j.notes ?? "?"} · orphans=${c.orphans ?? "?"} (fleeting ${j.orphans_fleeting ?? "?"}) · dead_links=${c.dead_links ?? "?"} · dead_body=${c.dead_body_links ?? "?"} · corrupt=${c.corrupt_lines ?? "?"}`);
            if (j.packs_unverified || c.packs_unverified) console.log(`เตือน: packs_unverified=${c.packs_unverified}`);
            resolve(0);
          } catch { console.log(text); resolve(0); }
        } else {
          console.error("✗ zero_health ไม่ตอบ:", JSON.stringify(r).slice(0, 200));
          resolve(1);
        }
      } catch (e) {
        console.error("✗ เชื่อม MCP ไม่ได้:", e.message);
        resolve(1);
      } finally {
        srv.kill();
      }
    })();
  });
}

const [cmd, ...rest] = process.argv.slice(2);
if (!cmd || cmd === "help" || cmd === "--help" || cmd === "-h") {
  help();
  process.exit(0);
}
if (cmd === "health") {
  process.exit(await health());
}
const c = CMDS[cmd];
if (!c) {
  console.error(`✗ ไม่รู้จักคำสั่ง: ${cmd}\n`);
  help();
  process.exit(1);
}
if (!existsSync(c.run)) {
  console.error(`✗ ไม่เจอ ${c.run}`);
  process.exit(1);
}
const r = spawnSync(process.execPath, [c.run, ...rest], { stdio: "inherit" });
process.exit(r.status ?? 1);
