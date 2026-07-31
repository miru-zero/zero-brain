#!/usr/bin/env node
/**
 * verify-install.mjs — ยืนยันว่า zero-brain ติดตั้งสำเร็จจริง (ไม่ใช่แค่ไฟล์อยู่)
 * รัน: node tools/verify-install.mjs — exit 0 เมื่อผ่านทุกข้อ (FAIL ข้อเดียว = exit 1)
 *
 * เช็ค 3 ชั้น:
 * ชั้นไฟล์ — brain/dist/seed/node version/config 4 clients parse ได้ + entry ชี้ไฟล์จริง
 * ชั้นตัวตน — ZERO block (ตัวตนมิรุ+BOOT) อยู่ในช่องที่ client โหลดตอนตื่น + skills ของเราครบทุก client
 * ชั้นวิ่ง — spawn dist/index.js คุย MCP จริง: initialize → tools/list → tools/call zero_health
 */
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { homedir } from "node:os";
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HOME = homedir();
const RepoDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const Dist = path.join(RepoDir, "dist", "index.js");
const BrainRoot = path.resolve(process.env.ZERO_BRAIN_ROOT ?? path.join(HOME, ".zero", "brain"));

let passed = 0;
let failed = 0;
let skipped = 0;
function check(name, cond, extra = "") {
  if (cond) {
    passed++;
    console.log(`  ✔ ${name}`);
  } else {
    failed++;
    console.error(`  ✘ ${name} ${extra}`);
  }
}
function skip(name, why) {
  skipped++;
  console.log(`  - ${name} — SKIP (${why})`);
}

// ---------- ชั้นไฟล์ ----------
console.log("ชั้นไฟล์:");
const nodeMajor = Number(process.versions.node.split(".")[0]);
check(`node ≥ 18 (ตอนนี้ ${process.versions.node})`, nodeMajor >= 18);
check("brain root มีจริง", existsSync(BrainRoot), BrainRoot);
check("brain init แล้ว (.kb/manifest.jsonl)", existsSync(path.join(BrainRoot, ".kb", "manifest.jsonl")));
check("dist/index.js มีจริง (build แล้ว)", existsSync(Dist), Dist);
check("seed/ มีจริง", existsSync(path.join(RepoDir, "seed")));

function checkJsonClient(client, cfgPath) {
  if (!existsSync(cfgPath)) {
    skip(client, "ไม่มี config — client ไม่ได้ติดตั้ง");
    return;
  }
  let cfg;
  try {
    // ตัด BOM — ไฟล์ที่เคยถูก PowerShell แตะมี BOM แล้ว JSON.parse พัง
    cfg = JSON.parse(readFileSync(cfgPath, "utf8").replace(/^﻿/, ""));
  } catch (e) {
    check(`${client} config parse ได้`, false, String(e));
    return;
  }
  const entry = cfg?.mcpServers?.["zero-brain"] ?? cfg?.mcp?.servers?.["zero-brain"];
  check(`${client} มี entry zero-brain`, !!entry, cfgPath);
  if (!entry) return;
  check(`${client} command เป็น absolute node`, path.isAbsolute(entry.command ?? ""), entry.command ?? "");
  check(`${client} command ชี้ไฟล์จริง`, existsSync(entry.command ?? ""), entry.command ?? "");
  check(`${client} args ชี้ dist จริง`, Array.isArray(entry.args) && existsSync(entry.args[0] ?? ""), JSON.stringify(entry.args));
}

checkJsonClient("kimi-code", path.join(HOME, ".kimi-code", "mcp.json"));
checkJsonClient("kimi-claw", path.join(HOME, ".kimi", "kimi-claw", "openclaw.json"));

// codex = TOML (parse ด้วย regex พอ)
const codexToml = path.join(HOME, ".codex", "config.toml");
if (!existsSync(codexToml)) {
  skip("codex", "ไม่มี config.toml");
} else {
  const t = readFileSync(codexToml, "utf8");
  check("codex มี section [mcp_servers.zero-brain]", /\[mcp_servers\.zero-brain\]/.test(t));
  const m = /^command\s*=\s*"([^"]+)"/m.exec(t.split("[mcp_servers.zero-brain]")[1] ?? "");
  check("codex command เป็น absolute node", !!m && path.isAbsolute(m[1]) && existsSync(m[1]), m?.[1] ?? "");
}

// daimon (Kimi Work)
const daimonRoot = [
  path.join(HOME, ".zero", "share", "daimon-share", "daimon"),
  path.join(HOME, ".zero", "daimon-share", "daimon"),
].find((p) => existsSync(p));
if (!daimonRoot) {
  skip("daimon", "ไม่ได้ติดตั้ง Kimi Work");
} else {
  const runtimeHome = path.join(daimonRoot, "runtime", "kimi-code", "home");
  if (existsSync(runtimeHome)) {
    checkJsonClient("daimon", path.join(runtimeHome, "mcp.json"));
  } else {
    skip("daimon", "ไม่มี runtime home");
  }
}

// ---------- ชั้นตัวตน: agent ตื่นมาเป็นมิรุไหม (identity + BOOT อยู่ใน system-prompt channel) ----------
// MCP ติดตั้งครบแต่ agent ไม่มีตัวตน = ตื่นมาเปล่าๆ (เคสจริงที่ป๊าเป็นห่วง) — ชั้นนี้บังคับพิสูจน์
console.log("ชั้นตัวตน (identity + BOOT ในช่องที่ client โหลดตอนตื่น):");
function checkIdentity(client, filePath) {
  if (!existsSync(filePath)) {
    skip(`${client} identity`, `ไม่มีไฟล์ ${path.basename(filePath)} — client ไม่ได้ติดตั้ง`);
    return;
  }
  const t = readFileSync(filePath, "utf8");
  check(`${client} มี ZERO block`, t.includes("ZERO:BEGIN"), filePath);
  check(`${client} block มีตัวตนมิรุ`, t.includes("มิรุ (Miru)"));
  check(`${client} block มี BOOT (zero_home ก่อนตอบงาน)`, t.includes("zero_home") && t.includes("BOOT"));
}

checkIdentity("codex", path.join(HOME, ".codex", "AGENTS.md"));
checkIdentity("kimi-claw", path.join(HOME, ".kimi_openclaw", "workspace", "AGENTS.md"));
checkIdentity("kimi-code", path.join(HOME, ".kimi-code", "AGENTS.md"));
if (daimonRoot) {
  checkIdentity("daimon", path.join(daimonRoot, "agents", "main", "memory", "vault", "about_user.md"));
}

// skills ของเราเองต้องอยู่ครบทุก client ที่มี skills dir (เคสจริง: เครื่องอื่นเห็นแค่ zero-brain-memory ขาด zero)
const skillSrcAll = path.join(RepoDir, "skills");
if (existsSync(skillSrcAll)) {
  const repoSkills = readdirSync(skillSrcAll, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name);
  for (const [client, dir] of [
    ["kimi-code", path.join(HOME, ".kimi-code", "skills")],
    ...(daimonRoot ? [["daimon", path.join(daimonRoot, "skills")]] : []),
  ]) {
    if (!existsSync(dir)) {
      skip(`${client} skills`, "ไม่มีโฟลเดอร์ skills");
      continue;
    }
    const missing = repoSkills.filter((n) => !existsSync(path.join(dir, n, "SKILL.md")));
    check(`${client} skills ของเราครบจาก repo (${repoSkills.join("/")})`, missing.length === 0, `ขาด: ${missing.join(",")}`);
  }
}

// ---------- ชั้นวิ่ง: spawn MCP คุยจริง ----------
console.log("ชั้นวิ่ง (spawn MCP จริง):");
function mcpProbe() {
  return new Promise((resolve) => {
    const proc = spawn(process.execPath, [Dist], {
      env: { ...process.env, ZERO_BRAIN_ROOT: BrainRoot, ZERO_BRAIN_ACTOR: "verify-install" },
    });
    let buf = "";
    const pending = new Map();
    let nextId = 1;
    const done = (okCount, failName, extra) => {
      proc.kill("SIGTERM");
      resolve({ okCount, failName, extra });
    };
    const send = (method, params) => {
      const id = nextId++;
      proc.stdin.write(JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n");
      return id;
    };
    const timer = setTimeout(() => done(0, "timeout 15s", ""), 15000);
    // เริ่มมือshake — ส่ง initialize ทันทีที่ spawn
    pending.set(
      send("initialize", {
        protocolVersion: "2024-11-05",
        capabilities: {},
        clientInfo: { name: "verify-install", version: "1.0.0" },
      }),
      { name: "initialize", okCount: 0 },
    );
    proc.stdout.on("data", (d) => {
      buf += d.toString();
      let idx;
      while ((idx = buf.indexOf("\n")) >= 0) {
        const line = buf.slice(0, idx).trim();
        buf = buf.slice(idx + 1);
        if (!line) continue;
        let msg;
        try {
          msg = JSON.parse(line);
        } catch {
          continue;
        }
        if (msg.id === undefined) continue;
        const stage = pending.get(msg.id);
        pending.delete(msg.id);
        if (msg.error) {
          clearTimeout(timer);
          done(stage?.okCount ?? 0, `${stage?.name}: ${msg.error.message}`, "");
          return;
        }
        if (stage?.name === "initialize") {
          proc.stdin.write(JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized", params: {} }) + "\n");
          pending.set(send("tools/list", {}), { name: "tools/list", okCount: 1 });
        } else if (stage?.name === "tools/list") {
          const names = (msg.result?.tools ?? []).map((t) => t.name);
          const need = ["zero_init", "zero_capture", "zero_write_note", "zero_read", "zero_search",
            "zero_link", "zero_resolve", "zero_health", "zero_home", "zero_nightly", "zero_audit",
            "zero_list_packs", "zero_update_note", "zero_compact", "zero_upgrade",
            "zero_find_session", "zero_read_session", "zero_match", "zero_episode", "zero_episodes"];
          const missing = need.filter((n) => !names.includes(n));
          if (missing.length > 0) {
            clearTimeout(timer);
            done(1, "tools/list ขาด tools", missing.join(","));
            return;
          }
          pending.set(send("tools/call", { name: "zero_health", arguments: {} }), { name: "zero_health", okCount: 2 });
        } else if (stage?.name === "zero_health") {
          clearTimeout(timer);
          const text = msg.result?.content?.[0]?.text ?? "{}";
          let data;
          try {
            data = JSON.parse(text);
          } catch {
            data = {};
          }
          if (data.ok === true && typeof data.notes === "number") done(3, "", "");
          else done(2, "zero_health ตอบผิดรูป", text.slice(0, 120));
        }
      }
    });
    proc.stderr.on("data", () => {});
    proc.on("error", (e) => {
      clearTimeout(timer);
      done(0, "spawn ไม่ได้", String(e));
    });
  });
}

const probe = await mcpProbe();
check("MCP initialize ตอบ", probe.okCount >= 1, probe.failName);
check("tools/list ครบ 20 tools (รวม episodes)", probe.okCount >= 2, probe.failName + " " + (probe.extra ?? ""));
check("zero_health วิ่งจริงคืน ok", probe.okCount >= 3, probe.failName + " " + (probe.extra ?? ""));

console.log(`\nผลลัพธ์: PASS ${passed} / FAIL ${failed} / SKIP ${skipped}`);
if (failed > 0) {
  console.error("VERIFY FAILED — แก้ข้อ ✘ แล้วรันใหม่ (ถ้า config พึ่งแก้ อย่าลืม restart client)");
  process.exit(1);
}
console.log("VERIFY PASSED — zero-brain พร้อมใช้งาน");
process.exit(0);
