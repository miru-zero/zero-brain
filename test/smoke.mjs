/**
 * smoke.mjs — smoke test รันบน dist ครบ 8 ข้อตาม SPEC
 * รัน: node test/smoke.mjs (ต้อง npm run build ก่อน) — exit 0 เมื่อผ่านทั้งหมด
 */
import { execFileSync, spawn } from "node:child_process";
import { appendFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, unlinkSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const serverEntry = path.join(here, "..", "dist", "index.js");
const root = mkdtempSync(path.join(tmpdir(), "zero-brain-smoke-"));

let passed = 0;
let failed = 0;
function check(name, cond, extra = "") {
  if (cond) {
    passed++;
    console.log(`  ✔ ${name}`);
  } else {
    failed++;
    console.error(`  ✘ ${name} ${extra}`);
  }
}

// ---- minimal MCP stdio client (newline-delimited JSON-RPC) ----
class McpClient {
  constructor(entry, env) {
    this.proc = spawn(process.execPath, [entry], { env: { ...process.env, ...env } });
    this.buf = "";
    this.nextId = 1;
    this.pending = new Map();
    this.proc.stdout.on("data", (d) => {
      this.buf += d.toString();
      let idx;
      while ((idx = this.buf.indexOf("\n")) >= 0) {
        const line = this.buf.slice(0, idx).trim();
        this.buf = this.buf.slice(idx + 1);
        if (!line) continue;
        let msg;
        try { msg = JSON.parse(line); } catch { continue; }
        if (msg.id !== undefined && this.pending.has(msg.id)) {
          const { resolve, reject } = this.pending.get(msg.id);
          this.pending.delete(msg.id);
          if (msg.error) reject(new Error(msg.error.message));
          else resolve(msg.result);
        }
      }
    });
    this.proc.stderr.on("data", () => {});
  }
  request(method, params) {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.proc.stdin.write(JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n");
      setTimeout(() => {
        if (this.pending.has(id)) {
          this.pending.delete(id);
          reject(new Error(`timeout: ${method}`));
        }
      }, 15000);
    });
  }
  notify(method, params) {
    this.proc.stdin.write(JSON.stringify({ jsonrpc: "2.0", method, params }) + "\n");
  }
  async call(name, args = {}) {
    const result = await this.request("tools/call", { name, arguments: args });
    const text = result?.content?.[0]?.text ?? "{}";
    let parsed;
    try { parsed = JSON.parse(text); } catch { parsed = { raw: text }; }
    return { isError: result?.isError === true, data: parsed };
  }
  close() { this.proc.kill("SIGTERM"); }
}

const client = new McpClient(serverEntry, { ZERO_BRAIN_ROOT: root, ZERO_LOCK_TIMEOUT_MS: "2000" });

try {
  await client.request("initialize", {
    protocolVersion: "2024-11-05",
    capabilities: {},
    clientInfo: { name: "smoke-test", version: "0.1.0" },
  });
  client.notify("notifications/initialized", {});

  // ---- 1. init → โฟลเดอร์ครบ ----
  console.log("1) brain_init");
  const init = await client.call("zero_init", {});
  const dirs = [
    ".kb/packs", ".kb/approvals", "00_Fleeting", "10_Notes", "20_Atlas",
    "30_Sources", "40_Templates/base", "99_System/snapshots",
  ];
  const files = [
    ".kb/manifest.jsonl", ".kb/links.jsonl", ".kb/aliases.json",
    ".kb/health.json", ".kb/audit.jsonl",
    ".kb/packs/self.yaml", ".kb/packs/people.yaml", ".kb/packs/security.yaml",
    "20_Atlas/Home.md", "20_Atlas/Today.md",
  ];
  check("init คืน ok", init.data.ok === true);
  check("โฟลเดอร์ครบ", dirs.every((d) => existsSync(path.join(root, d))),
    dirs.filter((d) => !existsSync(path.join(root, d))).join(","));
  check("ไฟล์ kernel/packs/atlas ครบ", files.every((f) => existsSync(path.join(root, f))),
    files.filter((f) => !existsSync(path.join(root, f))).join(","));

  // ---- 2. capture → ไฟล์อยู่ใน 00_Fleeting ----
  console.log("2) brain_capture");
  const cap = await client.call("zero_capture", { text: "ความคิดด่วน: ทดสอบ smoke" });
  check("capture คืน ok + id", cap.data.ok === true && typeof cap.data.id === "string");
  const fleetingFiles = readdirSync(path.join(root, "00_Fleeting")).filter((f) => f.endsWith(".md"));
  check("ไฟล์อยู่ใน 00_Fleeting", fleetingFiles.length === 1 && fleetingFiles[0].startsWith(cap.data.id));

  // ---- 3. write atomic โดยไม่มี evidence → ต้อง error ----
  console.log("3) brain_write_note atomic ไม่มี evidence");
  const noEv = await client.call("zero_write_note", {
    title: "Gravity pulls masses together",
    body: "mass ดึงดูดกัน",
    type: "atomic",
  });
  check("ต้อง error", noEv.isError === true && typeof noEv.data.error === "string",
    JSON.stringify(noEv.data));
  check("error ชี้ทาง (fleeting/evidence)", /evidence/.test(noEv.data.error ?? "") && /fleeting/.test(noEv.data.error ?? ""));

  // ---- 4. write atomic พร้อม evidence → สำเร็จ ----
  console.log("4) brain_write_note atomic พร้อม evidence");
  const note1 = await client.call("zero_write_note", {
    title: "Gravity pulls masses together",
    body: "วัตถุทุกมวลดึงดูดกันด้วยแรงโน้มถ่วง",
    type: "atomic",
    domain: "physics",
    tags: ["physics", "fundamental"],
    aliases: ["gravity-law"],
    evidence: ["Newton, Principia (1687)"],
  });
  check("เขียนสำเร็จ", note1.data.ok === true && typeof note1.data.id === "string", JSON.stringify(note1.data));
  const notesFiles = readdirSync(path.join(root, "10_Notes")).filter((f) => f.endsWith(".md"));
  check("ไฟล์อยู่ใน 10_Notes รูปแบบ <id> - <slug>.md",
    notesFiles.some((f) => f.startsWith(`${note1.data.id} - `) && f.endsWith(".md")),
    notesFiles.join(","));
  const manifestLines = readFileSync(path.join(root, ".kb/manifest.jsonl"), "utf8").trim().split("\n").filter(Boolean);
  check("manifest มี record ของโน้ต", manifestLines.some((l) => JSON.parse(l).id === note1.data.id));

  // โน้ต T1 สำหรับ test 5
  const noteT1 = await client.call("zero_write_note", {
    title: "Secret project codename Falcon",
    body: "โปรเจกต์ลับ falcon กำลังพัฒนา",
    type: "atomic",
    domain: "security",
    privacy: "T1",
    evidence: ["internal memo 2026-01"],
  });
  check("เขียนโน้ต T1 สำเร็จ", noteT1.data.ok === true);

  // ---- 5. search ----
  console.log("5) brain_search + privacy filter");
  const s1 = await client.call("zero_search", { query: "gravity" });
  check("search เจอโน้ต gravity", s1.data.results?.some((r) => r.id === note1.data.id));
  const s2 = await client.call("zero_search", { query: "falcon" });
  check("โน้ต T1 ไม่โผล่ default", (s2.data.results ?? []).length === 0, JSON.stringify(s2.data));
  const s3 = await client.call("zero_search", { query: "falcon", include_private: true });
  check("โน้ต T1 โผล่เมื่อ include_private", s3.data.results?.some((r) => r.id === noteT1.data.id));
  const auditSoFar = readFileSync(path.join(root, ".kb/audit.jsonl"), "utf8");
  check("include_private ถูก audit", auditSoFar.includes("brain_search_include_private"));

  // ---- 6. link สองโน้ต → links.jsonl มี record ----
  console.log("6) brain_link");
  const link = await client.call("zero_link", { from_id: note1.data.id, to_id: noteT1.data.id, rel: "supports" });
  check("link คืน ok", link.data.ok === true, JSON.stringify(link.data));
  const linkLines = readFileSync(path.join(root, ".kb/links.jsonl"), "utf8").trim().split("\n").filter(Boolean);
  check("links.jsonl มี record", linkLines.some((l) => {
    const r = JSON.parse(l);
    return r.from === note1.data.id && r.to === noteT1.data.id && r.rel === "supports";
  }));
  const read1 = await client.call("zero_read", { id_or_alias: note1.data.id });
  check("links ถูกเขียนลง frontmatter", read1.data.frontmatter?.links?.some((l) => l.to === noteT1.data.id));

  // ---- 7. resolve ด้วย alias → ได้ id ถูก ----
  console.log("7) brain_resolve");
  const res = await client.call("zero_resolve", { name: "gravity-law" });
  check("resolve alias ได้ id ถูก", res.data.id === note1.data.id, JSON.stringify(res.data));

  // ---- 8. health → คืน orphans/dead_links ----
  console.log("8) brain_health");
  const health = await client.call("zero_health", {});
  check("health คืน orphans/dead_links/notes",
    Array.isArray(health.data.orphans) && Array.isArray(health.data.dead_links) && typeof health.data.notes === "number",
    JSON.stringify(health.data));
  check("fleeting ที่ยังไม่ลิงก์ไม่นับ orphan (นับแยกใน orphans_fleeting)",
    !health.data.orphans?.includes(cap.data.id) && (health.data.orphans_fleeting ?? 0) >= 1,
    JSON.stringify({ orphans: health.data.orphans, orphans_fleeting: health.data.orphans_fleeting }));
  check("health.json ถูกเขียน", existsSync(path.join(root, ".kb/health.json")) &&
    JSON.parse(readFileSync(path.join(root, ".kb/health.json"), "utf8")).notes === health.data.notes);

  // ---- 9. T2 approval gate (กฎเหล็กข้อ 5) ----
  console.log("9) T2 approval gate");
  const noteT2 = await client.call("zero_write_note", {
    title: "Diagnosis private matter",
    body: "ข้อมูลสุขภาพส่วนตัวที่เปราะบาง",
    type: "atomic",
    domain: "health",
    privacy: "T2",
    evidence: ["personal record 2026-07"],
  });
  check("เขียนโน้ต T2 สำเร็จ", noteT2.data.ok === true, JSON.stringify(noteT2.data));
  const readBlocked = await client.call("zero_read", { id_or_alias: noteT2.data.id });
  check("อ่าน T2 โดยไม่มี approval ต้องถูกบล็อก", readBlocked.isError === true &&
    /T2/.test(readBlocked.data.error ?? "") && /approvals/.test(readBlocked.data.error ?? ""),
    JSON.stringify(readBlocked.data));
  const searchT2 = await client.call("zero_search", { query: "diagnosis", include_private: true });
  check("T2 ไม่โผล่ search แม้ include_private", !(searchT2.data.results ?? []).some((r) => r.id === noteT2.data.id));
  const auditT2a = readFileSync(path.join(root, ".kb/audit.jsonl"), "utf8");
  check("การบล็อก T2 ถูก audit", auditT2a.includes("brain_read_t2_blocked"));
  // ป๊าอนุมัติด้วยมือ (จำลอง: สร้างไฟล์ approval)
  mkdirSync(path.join(root, ".kb/approvals"), { recursive: true });
  writeFileSync(path.join(root, ".kb/approvals", `${noteT2.data.id}.json`),
    JSON.stringify({ approved_by: "ป๊า", at: "2026-07-29", expires: null }) + "\n", "utf8");
  const readApproved = await client.call("zero_read", { id_or_alias: noteT2.data.id });
  check("อ่าน T2 ได้หลังป๊าอนุมัติ", readApproved.isError !== true && readApproved.data.id === noteT2.data.id,
    JSON.stringify(readApproved.data));
  const searchT2b = await client.call("zero_search", { query: "diagnosis", include_private: true });
  check("T2 โผล่ search หลังอนุมัติ", (searchT2b.data.results ?? []).some((r) => r.id === noteT2.data.id));
  const auditT2b = readFileSync(path.join(root, ".kb/audit.jsonl"), "utf8");
  check("การอ่าน T2 ที่อนุมัติถูก audit", auditT2b.includes("brain_read_t2_approved"));
  // approval หมดอายุต้องบล็อก
  writeFileSync(path.join(root, ".kb/approvals", `${noteT2.data.id}.json`),
    JSON.stringify({ approved_by: "ป๊า", at: "2026-07-29", expires: "2020-01-01T00:00:00Z" }) + "\n", "utf8");
  const readExpired = await client.call("zero_read", { id_or_alias: noteT2.data.id });
  check("approval หมดอายุต้องบล็อก", readExpired.isError === true);
  rmSync(path.join(root, ".kb/approvals", `${noteT2.data.id}.json`));

  // ---- 10. T1 read ถูก audit ----
  console.log("10) T1 read audit");
  const readT1 = await client.call("zero_read", { id_or_alias: noteT1.data.id });
  check("อ่าน T1 ได้", readT1.isError !== true);
  check("การอ่าน T1 ถูก audit", readFileSync(path.join(root, ".kb/audit.jsonl"), "utf8").includes("brain_read_t1"));

  // ---- 11. health สแกน body wikilinks + Today ไม่รั่ว T2 ----
  console.log("11) body-link scanner + Today privacy");
  const noteDeadLink = await client.call("zero_write_note", {
    title: "Note with dangling wikilink",
    body: "เนื้อโน้ตอ้างถึง [[target-that-does-not-exist]] ซึ่งไม่มีในสมอง",
    type: "atomic",
    evidence: ["smoke test fixture"],
  });
  check("เขียนโน้ตที่มี dead body link สำเร็จ", noteDeadLink.data.ok === true);
  const health2 = await client.call("zero_health", {});
  check("dead_body_links จับลิงก์ตายใน body ได้",
    (health2.data.dead_body_links ?? []).some((d) => d.includes("target-that-does-not-exist")),
    JSON.stringify(health2.data.dead_body_links));
  check("health.json มี dead_body_links",
    Array.isArray(JSON.parse(readFileSync(path.join(root, ".kb/health.json"), "utf8")).dead_body_links));
  const home = await client.call("zero_home", {});
  check("Today.md ไม่รั่วชื่อโน้ต T2", !(home.data.today ?? "").includes("Diagnosis private matter"),
    "T2 title leaked into Today.md");

  // ---- 12. brain_nightly ----
  console.log("12) brain_nightly");
  const night = await client.call("zero_nightly", {});
  check("nightly คืน ok + queue", night.data.ok === true && Array.isArray(night.data.fleeting_queue),
    JSON.stringify(night.data).slice(0, 200));
  check("queue มี fleeting ที่ยัง active", night.data.fleeting_queue?.some((f) => f.id === cap.data.id));
  check("snapshot ถูกเขียน", typeof night.data.snapshot_path === "string" &&
    existsSync(path.join(root, night.data.snapshot_path)), night.data.snapshot_path);
  check("nightly ถูก audit", readFileSync(path.join(root, ".kb/audit.jsonl"), "utf8").includes("brain_nightly"));
  const todayAfter = readFileSync(path.join(root, "20_Atlas/Today.md"), "utf8");
  check("Today.md ไม่รั่ว T2 หลัง nightly", !todayAfter.includes("Diagnosis private matter"));

  // ---- 13. pack provenance ----
  console.log("13) pack provenance");
  const p1 = await client.call("zero_list_packs", {});
  check("packs ทั้งหมด unreviewed เมื่อยังไม่มี lock",
    p1.data.packs?.every((p) => p.status === "unreviewed"), JSON.stringify(p1.data.packs));
  const selfHash = p1.data.packs.find((p) => p.file === "self.yaml")?.sha256;
  writeFileSync(path.join(root, ".kb/packs.lock.json"), JSON.stringify({ "self.yaml": selfHash }, null, 2) + "\n", "utf8");
  const p2 = await client.call("zero_list_packs", {});
  check("self.yaml verified หลังล็อก", p2.data.packs?.find((p) => p.file === "self.yaml")?.status === "verified");
  const peoplePath = path.join(root, ".kb/packs/people.yaml");
  writeFileSync(peoplePath, readFileSync(peoplePath, "utf8") + "\n# touched\n", "utf8");
  writeFileSync(path.join(root, ".kb/packs.lock.json"),
    JSON.stringify({ "self.yaml": selfHash, "people.yaml": p1.data.packs.find((p) => p.file === "people.yaml")?.sha256 }, null, 2) + "\n", "utf8");
  const p3 = await client.call("zero_list_packs", {});
  check("people.yaml modified หลังถูกแก้", p3.data.packs?.find((p) => p.file === "people.yaml")?.status === "modified");
  const health3 = await client.call("zero_health", {});
  check("health เตือน packs_unverified",
    (health3.data.packs_unverified ?? []).some((p) => p.includes("modified") || p.includes("unreviewed")),
    JSON.stringify(health3.data.packs_unverified));

  // ---- 14. v1.2.1 durability (atomic write / link dedup / orphan ไม่นับ fleeting) ----
  console.log("14) v1.2.1 durability");
  const upd = await client.call("zero_update_note", { id: note1.data.id, body: "แก้ typo แล้ว — แรงโน้มถ่วงแปรผันตาม GMm/r^2" });
  check("update_note แก้ body ได้", upd.data.ok === true);
  const read2 = await client.call("zero_read", { id_or_alias: note1.data.id });
  check("body เปลี่ยนจริง", (read2.data.body ?? "").includes("GMm/r^2"), (read2.data.body ?? "").slice(0, 60));
  const before = readFileSync(path.join(root, ".kb/links.jsonl"), "utf8").trim().split("\n").filter(Boolean).length;
  const link2 = await client.call("zero_link", { from_id: note1.data.id, to_id: noteT1.data.id, rel: "supports" });
  const after = readFileSync(path.join(root, ".kb/links.jsonl"), "utf8").trim().split("\n").filter(Boolean).length;
  check("link ซ้ำถูก dedup (deduped=true)", link2.data.deduped === true, JSON.stringify(link2.data));
  check("links.jsonl ไม่โตเมื่อซ้ำ", after === before, `before=${before} after=${after}`);
  const health4 = await client.call("zero_health", {});
  check("orphans ไม่นับ fleeting ที่ยังไม่ลิงก์", !(health4.data.orphans ?? []).includes(cap.data.id),
    JSON.stringify(health4.data.orphans));
  check("orphans_fleeting นับ fleeting แยก", (health4.data.orphans_fleeting ?? 0) >= 1);
  const tmpLeft = [...readdirSync(path.join(root, "10_Notes")), ...readdirSync(path.join(root, "00_Fleeting")), ...readdirSync(path.join(root, "20_Atlas"))].filter((f) => f.includes(".tmp-"));
  check("ไม่มีไฟล์ .tmp-* ค้าง (atomic write)", tmpLeft.length === 0, tmpLeft.join(","));

  // ---- 15. v2.0.0 token-saving (search limit/offset, slim home, health counts) ----
  console.log("15) v2.0.0 token-saving");
  for (let i = 0; i < 3; i++) {
    await client.call("zero_write_note", {
      title: `Token probe ${i}`,
      body: "probe gravity extra",
      type: "atomic",
      evidence: ["probe fixture"],
    });
  }
  const sLim = await client.call("zero_search", { query: "gravity", limit: 2 });
  check("search limit=2 คืนแค่ 2 รายการ", (sLim.data.results ?? []).length === 2, JSON.stringify(sLim.data).slice(0, 150));
  check("search คืน total เต็ม (≥4)", (sLim.data.total ?? 0) >= 4, `total=${sLim.data.total}`);
  const sOff = await client.call("zero_search", { query: "gravity", limit: 50, offset: 2 });
  check("search offset ข้ามได้", (sOff.data.results ?? []).length === (sLim.data.total ?? 0) - 2,
    `offset results=${(sOff.data.results ?? []).length} total=${sLim.data.total}`);
  const homeSlim = await client.call("zero_home", {});
  check("home default ไม่คืน Home.md (คืน path+chars)", homeSlim.data.home === undefined &&
    typeof homeSlim.data.home_path === "string" && typeof homeSlim.data.home_chars === "number",
    JSON.stringify(homeSlim.data).slice(0, 150));
  const homeFull = await client.call("zero_home", { include_home: true });
  check("include_home=true คืน Home.md", typeof homeFull.data.home === "string" && homeFull.data.home.includes("Zero Brain"));
  const healthSlim = await client.call("zero_health", {});
  check("health คืน counts ครบทุกหมวด", typeof healthSlim.data.counts?.orphans === "number" &&
    typeof healthSlim.data.counts?.dead_links === "number" &&
    typeof healthSlim.data.counts?.dead_body_links === "number" &&
    typeof healthSlim.data.counts?.packs_unverified === "number",
    JSON.stringify(healthSlim.data.counts));
  check("health ยังคืน arrays (top-N) เหมือนเดิม", Array.isArray(healthSlim.data.orphans) && Array.isArray(healthSlim.data.dead_body_links));
  const healthJson = JSON.parse(readFileSync(path.join(root, ".kb/health.json"), "utf8"));
  check("health.json เก็บค่าเต็มไว้เสมอ", Array.isArray(healthJson.dead_body_links) && typeof healthJson.notes === "number");

  // ---- 16. v2.1.0 install UX — --init CLI สร้างโครงสมองเอง ----
  console.log("16) v2.1.0 install UX");
  const root2 = mkdtempSync(path.join(tmpdir(), "zero-brain-init-"));
  try {
    const out = execFileSync(process.execPath, [serverEntry, "--init"], {
      env: { ...process.env, ZERO_BRAIN_ROOT: root2 },
      encoding: "utf8",
      timeout: 15000,
    });
    const initRes = JSON.parse(out);
    check("--init exit 0 + คืน ok", initRes.ok === true, out.slice(0, 120));
    check("--init คืน root ตรงที่สั่ง", typeof initRes.root === "string" && path.resolve(initRes.root) === path.resolve(root2));
    check("--init สร้างโฟลเดอร์+ไฟล์ kernel ครบ",
      [".kb/manifest.jsonl", ".kb/links.jsonl", ".kb/aliases.json", ".kb/health.json", ".kb/audit.jsonl",
        "20_Atlas/Home.md", "20_Atlas/Today.md"].every((f) => existsSync(path.join(root2, f))) &&
      [".kb/packs", "00_Fleeting", "10_Notes", "20_Atlas", "30_Sources", "40_Templates/base", "99_System/snapshots"]
        .every((d) => existsSync(path.join(root2, d))));
    const out2 = execFileSync(process.execPath, [serverEntry, "--init"], {
      env: { ...process.env, ZERO_BRAIN_ROOT: root2 },
      encoding: "utf8",
      timeout: 15000,
    });
    check("--init ซ้ำไม่พัง (already_existed)", JSON.parse(out2).already_existed === true);
  } finally {
    rmSync(root2, { recursive: true, force: true });
  }

  // ---- 17. v2.2.0 bootstrap seed — init สร้างไฟล์กฎ+templates ครบ ----
  console.log("17) v2.2.0 bootstrap seed");
  const root3 = mkdtempSync(path.join(tmpdir(), "zero-brain-seed-"));
  try {
    execFileSync(process.execPath, [serverEntry, "--init"], {
      env: { ...process.env, ZERO_BRAIN_ROOT: root3 },
      encoding: "utf8",
      timeout: 15000,
    });
    const seedFiles = [
      "AGENTS.md",
      "20_Atlas/Brain Operating Model.md",
      "20_Atlas/Memory Placement Rules.md",
      "20_Atlas/Hotcache.md",
      "40_Templates/base/atomic.md",
      "40_Templates/base/entity.md",
      "40_Templates/base/source.md",
      "40_Templates/base/log.md",
      "40_Templates/base/moc.md",
    ];
    check("init สร้างไฟล์ seed ครบ 9 ไฟล์", seedFiles.every((f) => existsSync(path.join(root3, f))),
      seedFiles.filter((f) => !existsSync(path.join(root3, f))).join(","));
    const hot = readFileSync(path.join(root3, "20_Atlas/Hotcache.md"), "utf8");
    check("Hotcache แทน {{date}} แล้ว", !hot.includes("{{date}}") && /\[\d{4}-\d{2}-\d{2}\]/.test(hot));
    const atomic = readFileSync(path.join(root3, "40_Templates/base/atomic.md"), "utf8");
    check("template atomic มี frontmatter+evidence", atomic.includes("type: atomic") && atomic.includes("evidence:"));
    // idempotent: แก้ Hotcache แล้ว init ซ้ำ ต้องไม่ทับ
    writeFileSync(path.join(root3, "20_Atlas/Hotcache.md"), hot + "\nMARK-BY-USER\n", "utf8");
    execFileSync(process.execPath, [serverEntry, "--init"], {
      env: { ...process.env, ZERO_BRAIN_ROOT: root3 },
      encoding: "utf8",
      timeout: 15000,
    });
    check("init ซ้ำไม่ทับไฟล์ที่ผู้ใช้แก้", readFileSync(path.join(root3, "20_Atlas/Hotcache.md"), "utf8").includes("MARK-BY-USER"));
  } finally {
    rmSync(root3, { recursive: true, force: true });
  }

  // ---- 18. v2.3.0 corrupt-line health + zero_compact ----
  console.log("18) corrupt-line health + zero_compact");
  const manifestFile = path.join(root, ".kb/manifest.jsonl");
  appendFileSync(manifestFile, "GARBAGE-LINE-NOT-JSON{\n", "utf8");
  const hCorrupt = await client.call("zero_health", {});
  check("health เห็น corrupt_lines.manifest ≥ 1", (hCorrupt.data.corrupt_lines?.manifest ?? 0) >= 1,
    JSON.stringify(hCorrupt.data.corrupt_lines));
  check("health counts.corrupt_lines ≥ 1", (hCorrupt.data.counts?.corrupt_lines ?? 0) >= 1);
  check("health.json เก็บ corrupt_lines", typeof JSON.parse(readFileSync(path.join(root, ".kb/health.json"), "utf8")).corrupt_lines?.manifest === "number");
  // links.jsonl: ปลอมบรรทัดซ้ำ แล้ว compact ต้องกวาดออก
  const linksFile = path.join(root, ".kb/links.jsonl");
  const firstLink = readFileSync(linksFile, "utf8").trim().split("\n").filter(Boolean)[0];
  appendFileSync(linksFile, firstLink + "\n" + firstLink + "\n", "utf8");
  const comp = await client.call("zero_compact", {});
  check("compact คืน ok", comp.data.ok === true, JSON.stringify(comp.data));
  check("compact ลด links (dedup ซ้ำ)", (comp.data.links_after ?? 0) < (comp.data.links_before ?? 0),
    `before=${comp.data.links_before} after=${comp.data.links_after}`);
  const manifestAfter = readFileSync(manifestFile, "utf8").trim().split("\n").filter(Boolean);
  check("manifest หลัง compact parse ได้ทุกบรรทัด (corrupt หลุด)", manifestAfter.every((l) => { try { JSON.parse(l); return true; } catch { return false; } }));
  const uniqueIds = new Set(manifestAfter.map((l) => JSON.parse(l).id));
  check("manifest เหลือ 1 record ต่อ id", uniqueIds.size === manifestAfter.length, `lines=${manifestAfter.length} unique=${uniqueIds.size}`);
  const hClean = await client.call("zero_health", {});
  check("health หลัง compact corrupt = 0", (hClean.data.counts?.corrupt_lines ?? -1) === 0,
    JSON.stringify(hClean.data.corrupt_lines));
  check("compact ถูก audit", readFileSync(path.join(root, ".kb/audit.jsonl"), "utf8").includes("brain_compact"));
  check("health รายงาน t1_reads_24h (เคยอ่าน T1 ในข้อ 10)", (hClean.data.t1_reads_24h ?? 0) >= 1,
    `t1_reads_24h=${hClean.data.t1_reads_24h}`);
  check("health รายงาน repo_dirty เป็น boolean (repo นี้เป็น git)", typeof hClean.data.repo_dirty === "boolean",
    `repo_dirty=${hClean.data.repo_dirty}`);

  // ---- 19. v2.3.0 write lock ----
  console.log("19) write lock");
  const lockFile = path.join(root, ".kb/write.lock");
  writeFileSync(lockFile, "held-by-smoke\n", "utf8");
  const lockedCap = await client.call("zero_capture", { text: "capture ขณะ lock ถูกถือ" });
  check("capture ติด lock ต้อง error", lockedCap.isError === true, JSON.stringify(lockedCap.data));
  check("error บอกสาเหตุ (write.lock)", /write\.lock/.test(lockedCap.data.error ?? ""), lockedCap.data.error ?? "");
  unlinkSync(lockFile);
  const freeCap = await client.call("zero_capture", { text: "capture หลังปล่อย lock" });
  check("capture หลังปล่อย lock สำเร็จ", freeCap.data.ok === true, JSON.stringify(freeCap.data));
  // stale lock: mtime เก่าเกิน 60s → server ถือว่าคนถือตายไป กวาดแล้วทำงานต่อได้
  writeFileSync(lockFile, "stale\n", "utf8");
  const old = new Date(Date.now() - 120_000);
  utimesSync(lockFile, old, old);
  const staleCap = await client.call("zero_capture", { text: "capture ข้าม stale lock" });
  check("stale lock ถูกกวาดอัตโนมัติ (capture สำเร็จ)", staleCap.data.ok === true, JSON.stringify(staleCap.data).slice(0, 120));
  check("lock ไม่ค้างหลังทำงานจบ", !existsSync(lockFile));

  // ---- 20. v2.3.0 concurrent writers ไม่ทำ JSONL เสีย ----
  console.log("20) concurrent writers");
  const client2 = new McpClient(serverEntry, { ZERO_BRAIN_ROOT: root, ZERO_LOCK_TIMEOUT_MS: "2000" });
  try {
    await client2.request("initialize", {
      protocolVersion: "2024-11-05",
      capabilities: {},
      clientInfo: { name: "smoke-test-2", version: "0.1.0" },
    });
    client2.notify("notifications/initialized", {});
    const batch = [];
    for (let i = 0; i < 5; i++) {
      batch.push(client.call("zero_capture", { text: `race-A-${i}` }));
      batch.push(client2.call("zero_capture", { text: `race-B-${i}` }));
    }
    const results = await Promise.all(batch);
    check("10 captures พร้อมกัน 2 process สำเร็จหมด", results.every((r) => r.data.ok === true),
      JSON.stringify(results.find((r) => !r.data.ok)?.data ?? "").slice(0, 120));
    const ids = new Set(results.map((r) => r.data.id));
    check("id ไม่ชนกันเลย", ids.size === results.length, `unique=${ids.size}/${results.length}`);
    const manifestRace = readFileSync(manifestFile, "utf8").trim().split("\n").filter(Boolean);
    check("manifest ทุกบรรทัดยัง parse ได้ (ไม่มีบรรทัดสลับ)", manifestRace.every((l) => { try { JSON.parse(l); return true; } catch { return false; } }));
  } finally {
    client2.close();
  }

  // ---- 21. v2.3.0 T2 encryption at rest ----
  console.log("21) T2 encryption at rest");
  const secretBody = "ความลับระดับชาติ TOPSECRET-XYZ-991";
  const noteEnc = await client.call("zero_write_note", {
    title: "Encrypted secret note",
    body: secretBody,
    type: "atomic",
    privacy: "T2",
    evidence: ["smoke encryption fixture"],
  });
  check("เขียนโน้ต T2 สำเร็จ", noteEnc.data.ok === true, JSON.stringify(noteEnc.data));
  const encAbs = path.join(root, noteEnc.data.path);
  const diskContent = readFileSync(encAbs, "utf8");
  check("บนดิสก์มี prefix enc:v1:", diskContent.includes("enc:v1:"));
  check("บนดิสก์ไม่มี plaintext ความลับ", !diskContent.includes("TOPSECRET-XYZ-991"), "plaintext leaked on disk");
  // อนุมัติแล้วอ่าน → ได้ plaintext ตรงต้นฉบับ
  writeFileSync(path.join(root, ".kb/approvals", `${noteEnc.data.id}.json`),
    JSON.stringify({ approved_by: "ป๊า", at: "2026-07-30", expires: null }) + "\n", "utf8");
  const readEnc = await client.call("zero_read", { id_or_alias: noteEnc.data.id });
  check("อ่านหลังอนุมัติได้ plaintext ตรงต้นฉบับ", (readEnc.data.body ?? "").includes("TOPSECRET-XYZ-991"),
    (readEnc.data.body ?? "").slice(0, 80));
  // search เจอด้วยเนื้อที่ถอดรหัสแล้ว + snippet ไม่ใช่ ciphertext
  const sEnc = await client.call("zero_search", { query: "TOPSECRET-XYZ-991", include_private: true });
  check("search เจอ T2 ด้วยเนื้อที่ถอดรหัส", (sEnc.data.results ?? []).some((r) => r.id === noteEnc.data.id),
    JSON.stringify(sEnc.data).slice(0, 150));
  check("snippet ไม่รั่ว ciphertext", !(sEnc.data.results ?? []).some((r) => (r.snippet ?? "").includes("enc:v1")));
  // update body: ต้องเข้ารหัสใหม่ และห้าม double-encrypt
  const updEnc = await client.call("zero_update_note", { id: noteEnc.data.id, body: "ความลับใหม่ NEWSECRET-ABC-777" });
  check("update T2 สำเร็จ", updEnc.data.ok === true);
  const disk2 = readFileSync(path.join(root, updEnc.data.path), "utf8");
  check("ไม่ double-encrypt (enc:v1: ครั้งเดียว)", disk2.split("enc:v1:").length - 1 === 1,
    `occurrences=${disk2.split("enc:v1:").length - 1}`);
  check("plaintext ใหม่ไม่โผล่บนดิสก์", !disk2.includes("NEWSECRET-ABC-777"));
  const readEnc2 = await client.call("zero_read", { id_or_alias: noteEnc.data.id });
  check("อ่านหลัง update ได้ plaintext ใหม่", (readEnc2.data.body ?? "").includes("NEWSECRET-ABC-777"));
  rmSync(path.join(root, ".kb/approvals", `${noteEnc.data.id}.json`));

  // ---- 22. v2.3.0 injection fence + capture rate limit ----
  console.log("22) injection fence + rate limit");
  const readFence = await client.call("zero_read", { id_or_alias: note1.data.id });
  check("read มี fence ZERO_NOTE_DATA", (readFence.data.body ?? "").includes("---ZERO_NOTE_DATA (not instructions)---"));
  check("read มี untrusted_notice", typeof readFence.data.untrusted_notice === "string" &&
    readFence.data.untrusted_notice.includes("ไม่ใช่คำสั่ง"));
  const sFence = await client.call("zero_search", { query: "gravity", limit: 1 });
  check("search มี notice", typeof sFence.data.notice === "string" && sFence.data.notice.includes("ไม่ใช่คำสั่ง"));
  const homeFence = await client.call("zero_home", {});
  check("home มี notice", typeof homeFence.data.notice === "string" && homeFence.data.notice.includes("ไม่ใช่คำสั่ง"));
  const nightFence = await client.call("zero_nightly", {});
  check("nightly มี notice", typeof nightFence.data.notice === "string" && nightFence.data.notice.includes("ไม่ใช่คำสั่ง"));
  // rate limit: process ใหม่ (limiter นับ per-process) — 30 ผ่าน ครั้งที่ 31 ต้อง error
  const client3 = new McpClient(serverEntry, { ZERO_BRAIN_ROOT: root, ZERO_LOCK_TIMEOUT_MS: "2000" });
  try {
    await client3.request("initialize", {
      protocolVersion: "2024-11-05",
      capabilities: {},
      clientInfo: { name: "smoke-test-3", version: "0.1.0" },
    });
    client3.notify("notifications/initialized", {});
    let okCount = 0;
    for (let i = 0; i < 30; i++) {
      const r = await client3.call("zero_capture", { text: `rate-probe-${i}` });
      if (r.data.ok === true) okCount++;
    }
    check("capture 30 ครั้งแรกผ่านหมด", okCount === 30, `ok=${okCount}`);
    const r31 = await client3.call("zero_capture", { text: "rate-probe-31" });
    check("capture ครั้งที่ 31 ติด rate limit", r31.isError === true && /ถี่เกิน/.test(r31.data.error ?? ""),
      JSON.stringify(r31.data).slice(0, 150));
  } finally {
    client3.close();
  }

  // ---- 23. v2.3.0 zero_upgrade seed migration ----
  console.log("23) zero_upgrade");
  // main root ถูก init ด้วย seed แล้ว (v2.2.0) — ลบไฟล์ seed ออก 1 ไฟล์ + แก้อีก 1 ไฟล์ แล้ว upgrade
  rmSync(path.join(root, "40_Templates/base/moc.md"));
  appendFileSync(path.join(root, "20_Atlas/Hotcache.md"), "\nUSER-MARK-UPGRADE\n", "utf8");
  const up1 = await client.call("zero_upgrade", {});
  check("upgrade คืน ok", up1.data.ok === true, JSON.stringify(up1.data));
  check("upgrade เติมไฟล์ที่หาย (moc.md)", (up1.data.created ?? []).some((f) => f.endsWith("40_Templates/base/moc.md")),
    JSON.stringify(up1.data.created));
  check("upgrade ไม่ทับไฟล์ที่ผู้ใช้แก้", readFileSync(path.join(root, "20_Atlas/Hotcache.md"), "utf8").includes("USER-MARK-UPGRADE"));
  const up2 = await client.call("zero_upgrade", {});
  check("upgrade ซ้ำไม่มีอะไรต้องเติม (already_up_to_date)", up2.data.already_up_to_date === true,
    JSON.stringify(up2.data).slice(0, 120));
  check("upgrade ถูก audit", readFileSync(path.join(root, ".kb/audit.jsonl"), "utf8").includes("brain_upgrade"));
  // ---- 24. v2.3.1 Obsidian-visible links block (กราฟ OB วาดเส้นจาก [[wikilinks]] ใน body เท่านั้น) ----
  console.log("24) links block ที่กราฟ Obsidian เห็น");
  // (a) write_note ที่ส่ง links ตั้งแต่เกิด → block พร้อม stem จริงในไฟล์
  const lb1 = await client.call("zero_write_note", {
    title: "Block link source concept",
    body: "ต้นทางของลิงก์",
    type: "atomic",
    evidence: ["smoke links-block fixture"],
    links: [{ to: note1.data.id, rel: "related" }],
  });
  check("เขียนโน้ตพร้อม links สำเร็จ", lb1.data.ok === true, JSON.stringify(lb1.data));
  const lb1Body = readFileSync(path.join(root, lb1.data.path), "utf8");
  check("block ถูกเขียนลงไฟล์ (zero-links:begin)", lb1Body.includes("<!-- zero-links:begin -->"));
  check("block มี wikilink เป็น stem ไฟล์จริง",
    new RegExp(`\\[\\[${note1.data.id} - [^\\]|]+\\|${note1.data.id}\\]\\]`).test(lb1Body),
    lb1Body.slice(-300));
  // (b) zero_link เพิ่ม → block regenerate ทั้งสองใบ (เห็นเส้นสองทิศ)
  await client.call("zero_link", { from_id: lb1.data.id, to_id: noteT1.data.id, rel: "supports" });
  const readLb1 = await client.call("zero_read", { id_or_alias: lb1.data.id });
  check("read เห็น block หลัง link", (readLb1.data.body ?? "").includes("zero-links:begin") &&
    (readLb1.data.body ?? "").includes("[["));
  const readT1b = await client.call("zero_read", { id_or_alias: noteT1.data.id });
  check("ฝั่งปลายลิงก์ก็มี block (เชื่อมสองทิศ)", (readT1b.data.body ?? "").includes("zero-links:begin"));
  // (c) write_note ไม่ส่ง links → warning คำว่า "ลอย" + ไม่มี block
  const noLink = await client.call("zero_write_note", {
    title: "Floating note warning probe",
    body: "โน้ตไม่มีลิงก์",
    type: "atomic",
    evidence: ["smoke warning fixture"],
  });
  check("write ไม่มี links เตือนคำว่า ลอย", (noLink.data.warnings ?? []).some((w) => w.includes("ลอย")),
    JSON.stringify(noLink.data.warnings));
  check("โน้ตไม่มี links ไม่สร้าง block", !readFileSync(path.join(root, noLink.data.path), "utf8").includes("zero-links:begin"));
  // (d) update_note no-op → block ยังอันเดียว (idempotent) + เนื้อเดิมไม่หาย
  await client.call("zero_update_note", { id: lb1.data.id });
  const lb1Body2 = readFileSync(path.join(root, lb1.data.path), "utf8");
  check("update no-op block ยังอันเดียว", lb1Body2.split("zero-links:begin").length - 1 === 1,
    `occ=${lb1Body2.split("zero-links:begin").length - 1}`);
  check("update no-op เนื้อเดิมไม่หาย", lb1Body2.includes("ต้นทางของลิงก์"));
  // (e) T2 encrypted: update no-op แล้วไม่พัง — ciphertext คงเดิม ไม่มี block แปลกปลอม
  const updEncNoop = await client.call("zero_update_note", { id: noteEnc.data.id });
  check("update no-op บนโน้ต T2 สำเร็จ", updEncNoop.data.ok === true);
  const diskEnc3 = readFileSync(path.join(root, updEncNoop.data.path), "utf8");
  check("T2 ยัง enc:v1: ครั้งเดียว (ไม่ double-encrypt)", diskEnc3.split("enc:v1:").length - 1 === 1);
  check("T2 ciphertext ไม่มี block แปลกปลอม", !diskEnc3.includes("zero-links:begin"));
} catch (err) {
  failed++;
  console.error("FATAL:", err);
} finally {
  client.close();
  rmSync(root, { recursive: true, force: true });
}

console.log(`\nผลลัพธ์: ผ่าน ${passed} / ${passed + failed}`);
if (failed > 0) {
  console.error(`SMOKE TEST FAILED (${failed} ข้อ)`);
  process.exit(1);
}
console.log("SMOKE TEST PASSED (ครบ 24 ข้อ)");
process.exit(0);
