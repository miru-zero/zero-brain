/**
 * smoke.mjs — smoke test รันบน dist ครบ 8 ข้อตาม SPEC
 * รัน: node test/smoke.mjs (ต้อง npm run build ก่อน) — exit 0 เมื่อผ่านทั้งหมด
 */
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const serverEntry = path.join(here, "..", "dist", "index.js");
const root = mkdtempSync(path.join(tmpdir(), "central-brain-smoke-"));

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

const client = new McpClient(serverEntry, { CENTRAL_BRAIN_ROOT: root });

try {
  await client.request("initialize", {
    protocolVersion: "2024-11-05",
    capabilities: {},
    clientInfo: { name: "smoke-test", version: "0.1.0" },
  });
  client.notify("notifications/initialized", {});

  // ---- 1. init → โฟลเดอร์ครบ ----
  console.log("1) brain_init");
  const init = await client.call("brain_init", {});
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
  const cap = await client.call("brain_capture", { text: "ความคิดด่วน: ทดสอบ smoke" });
  check("capture คืน ok + id", cap.data.ok === true && typeof cap.data.id === "string");
  const fleetingFiles = readdirSync(path.join(root, "00_Fleeting")).filter((f) => f.endsWith(".md"));
  check("ไฟล์อยู่ใน 00_Fleeting", fleetingFiles.length === 1 && fleetingFiles[0].startsWith(cap.data.id));

  // ---- 3. write atomic โดยไม่มี evidence → ต้อง error ----
  console.log("3) brain_write_note atomic ไม่มี evidence");
  const noEv = await client.call("brain_write_note", {
    title: "Gravity pulls masses together",
    body: "mass ดึงดูดกัน",
    type: "atomic",
  });
  check("ต้อง error", noEv.isError === true && typeof noEv.data.error === "string",
    JSON.stringify(noEv.data));
  check("error ชี้ทาง (fleeting/evidence)", /evidence/.test(noEv.data.error ?? "") && /fleeting/.test(noEv.data.error ?? ""));

  // ---- 4. write atomic พร้อม evidence → สำเร็จ ----
  console.log("4) brain_write_note atomic พร้อม evidence");
  const note1 = await client.call("brain_write_note", {
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
  const noteT1 = await client.call("brain_write_note", {
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
  const s1 = await client.call("brain_search", { query: "gravity" });
  check("search เจอโน้ต gravity", s1.data.results?.some((r) => r.id === note1.data.id));
  const s2 = await client.call("brain_search", { query: "falcon" });
  check("โน้ต T1 ไม่โผล่ default", (s2.data.results ?? []).length === 0, JSON.stringify(s2.data));
  const s3 = await client.call("brain_search", { query: "falcon", include_private: true });
  check("โน้ต T1 โผล่เมื่อ include_private", s3.data.results?.some((r) => r.id === noteT1.data.id));
  const auditSoFar = readFileSync(path.join(root, ".kb/audit.jsonl"), "utf8");
  check("include_private ถูก audit", auditSoFar.includes("brain_search_include_private"));

  // ---- 6. link สองโน้ต → links.jsonl มี record ----
  console.log("6) brain_link");
  const link = await client.call("brain_link", { from_id: note1.data.id, to_id: noteT1.data.id, rel: "supports" });
  check("link คืน ok", link.data.ok === true, JSON.stringify(link.data));
  const linkLines = readFileSync(path.join(root, ".kb/links.jsonl"), "utf8").trim().split("\n").filter(Boolean);
  check("links.jsonl มี record", linkLines.some((l) => {
    const r = JSON.parse(l);
    return r.from === note1.data.id && r.to === noteT1.data.id && r.rel === "supports";
  }));
  const read1 = await client.call("brain_read", { id_or_alias: note1.data.id });
  check("links ถูกเขียนลง frontmatter", read1.data.frontmatter?.links?.some((l) => l.to === noteT1.data.id));

  // ---- 7. resolve ด้วย alias → ได้ id ถูก ----
  console.log("7) brain_resolve");
  const res = await client.call("brain_resolve", { name: "gravity-law" });
  check("resolve alias ได้ id ถูก", res.data.id === note1.data.id, JSON.stringify(res.data));

  // ---- 8. health → คืน orphans/dead_links ----
  console.log("8) brain_health");
  const health = await client.call("brain_health", {});
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
  const noteT2 = await client.call("brain_write_note", {
    title: "Diagnosis private matter",
    body: "ข้อมูลสุขภาพส่วนตัวที่เปราะบาง",
    type: "atomic",
    domain: "health",
    privacy: "T2",
    evidence: ["personal record 2026-07"],
  });
  check("เขียนโน้ต T2 สำเร็จ", noteT2.data.ok === true, JSON.stringify(noteT2.data));
  const readBlocked = await client.call("brain_read", { id_or_alias: noteT2.data.id });
  check("อ่าน T2 โดยไม่มี approval ต้องถูกบล็อก", readBlocked.isError === true &&
    /T2/.test(readBlocked.data.error ?? "") && /approvals/.test(readBlocked.data.error ?? ""),
    JSON.stringify(readBlocked.data));
  const searchT2 = await client.call("brain_search", { query: "diagnosis", include_private: true });
  check("T2 ไม่โผล่ search แม้ include_private", !(searchT2.data.results ?? []).some((r) => r.id === noteT2.data.id));
  const auditT2a = readFileSync(path.join(root, ".kb/audit.jsonl"), "utf8");
  check("การบล็อก T2 ถูก audit", auditT2a.includes("brain_read_t2_blocked"));
  // ป๊าอนุมัติด้วยมือ (จำลอง: สร้างไฟล์ approval)
  mkdirSync(path.join(root, ".kb/approvals"), { recursive: true });
  writeFileSync(path.join(root, ".kb/approvals", `${noteT2.data.id}.json`),
    JSON.stringify({ approved_by: "ป๊า", at: "2026-07-29", expires: null }) + "\n", "utf8");
  const readApproved = await client.call("brain_read", { id_or_alias: noteT2.data.id });
  check("อ่าน T2 ได้หลังป๊าอนุมัติ", readApproved.isError !== true && readApproved.data.id === noteT2.data.id,
    JSON.stringify(readApproved.data));
  const searchT2b = await client.call("brain_search", { query: "diagnosis", include_private: true });
  check("T2 โผล่ search หลังอนุมัติ", (searchT2b.data.results ?? []).some((r) => r.id === noteT2.data.id));
  const auditT2b = readFileSync(path.join(root, ".kb/audit.jsonl"), "utf8");
  check("การอ่าน T2 ที่อนุมัติถูก audit", auditT2b.includes("brain_read_t2_approved"));
  // approval หมดอายุต้องบล็อก
  writeFileSync(path.join(root, ".kb/approvals", `${noteT2.data.id}.json`),
    JSON.stringify({ approved_by: "ป๊า", at: "2026-07-29", expires: "2020-01-01T00:00:00Z" }) + "\n", "utf8");
  const readExpired = await client.call("brain_read", { id_or_alias: noteT2.data.id });
  check("approval หมดอายุต้องบล็อก", readExpired.isError === true);
  rmSync(path.join(root, ".kb/approvals", `${noteT2.data.id}.json`));

  // ---- 10. T1 read ถูก audit ----
  console.log("10) T1 read audit");
  const readT1 = await client.call("brain_read", { id_or_alias: noteT1.data.id });
  check("อ่าน T1 ได้", readT1.isError !== true);
  check("การอ่าน T1 ถูก audit", readFileSync(path.join(root, ".kb/audit.jsonl"), "utf8").includes("brain_read_t1"));

  // ---- 11. health สแกน body wikilinks + Today ไม่รั่ว T2 ----
  console.log("11) body-link scanner + Today privacy");
  const noteDeadLink = await client.call("brain_write_note", {
    title: "Note with dangling wikilink",
    body: "เนื้อโน้ตอ้างถึง [[target-that-does-not-exist]] ซึ่งไม่มีในสมอง",
    type: "atomic",
    evidence: ["smoke test fixture"],
  });
  check("เขียนโน้ตที่มี dead body link สำเร็จ", noteDeadLink.data.ok === true);
  const health2 = await client.call("brain_health", {});
  check("dead_body_links จับลิงก์ตายใน body ได้",
    (health2.data.dead_body_links ?? []).some((d) => d.includes("target-that-does-not-exist")),
    JSON.stringify(health2.data.dead_body_links));
  check("health.json มี dead_body_links",
    Array.isArray(JSON.parse(readFileSync(path.join(root, ".kb/health.json"), "utf8")).dead_body_links));
  const home = await client.call("brain_home", {});
  check("Today.md ไม่รั่วชื่อโน้ต T2", !(home.data.today ?? "").includes("Diagnosis private matter"),
    "T2 title leaked into Today.md");

  // ---- 12. brain_nightly ----
  console.log("12) brain_nightly");
  const night = await client.call("brain_nightly", {});
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
  const p1 = await client.call("brain_list_packs", {});
  check("packs ทั้งหมด unreviewed เมื่อยังไม่มี lock",
    p1.data.packs?.every((p) => p.status === "unreviewed"), JSON.stringify(p1.data.packs));
  const selfHash = p1.data.packs.find((p) => p.file === "self.yaml")?.sha256;
  writeFileSync(path.join(root, ".kb/packs.lock.json"), JSON.stringify({ "self.yaml": selfHash }, null, 2) + "\n", "utf8");
  const p2 = await client.call("brain_list_packs", {});
  check("self.yaml verified หลังล็อก", p2.data.packs?.find((p) => p.file === "self.yaml")?.status === "verified");
  const peoplePath = path.join(root, ".kb/packs/people.yaml");
  writeFileSync(peoplePath, readFileSync(peoplePath, "utf8") + "\n# touched\n", "utf8");
  writeFileSync(path.join(root, ".kb/packs.lock.json"),
    JSON.stringify({ "self.yaml": selfHash, "people.yaml": p1.data.packs.find((p) => p.file === "people.yaml")?.sha256 }, null, 2) + "\n", "utf8");
  const p3 = await client.call("brain_list_packs", {});
  check("people.yaml modified หลังถูกแก้", p3.data.packs?.find((p) => p.file === "people.yaml")?.status === "modified");
  const health3 = await client.call("brain_health", {});
  check("health เตือน packs_unverified",
    (health3.data.packs_unverified ?? []).some((p) => p.includes("modified") || p.includes("unreviewed")),
    JSON.stringify(health3.data.packs_unverified));

  // ---- 14. v1.2.1 durability (atomic write / link dedup / orphan ไม่นับ fleeting) ----
  console.log("14) v1.2.1 durability");
  const upd = await client.call("brain_update_note", { id: note1.data.id, body: "แก้ typo แล้ว — แรงโน้มถ่วงแปรผันตาม GMm/r^2" });
  check("update_note แก้ body ได้", upd.data.ok === true);
  const read2 = await client.call("brain_read", { id_or_alias: note1.data.id });
  check("body เปลี่ยนจริง", (read2.data.body ?? "").includes("GMm/r^2"), (read2.data.body ?? "").slice(0, 60));
  const before = readFileSync(path.join(root, ".kb/links.jsonl"), "utf8").trim().split("\n").filter(Boolean).length;
  const link2 = await client.call("brain_link", { from_id: note1.data.id, to_id: noteT1.data.id, rel: "supports" });
  const after = readFileSync(path.join(root, ".kb/links.jsonl"), "utf8").trim().split("\n").filter(Boolean).length;
  check("link ซ้ำถูก dedup (deduped=true)", link2.data.deduped === true, JSON.stringify(link2.data));
  check("links.jsonl ไม่โตเมื่อซ้ำ", after === before, `before=${before} after=${after}`);
  const health4 = await client.call("brain_health", {});
  check("orphans ไม่นับ fleeting ที่ยังไม่ลิงก์", !(health4.data.orphans ?? []).includes(cap.data.id),
    JSON.stringify(health4.data.orphans));
  check("orphans_fleeting นับ fleeting แยก", (health4.data.orphans_fleeting ?? 0) >= 1);
  const tmpLeft = [...readdirSync(path.join(root, "10_Notes")), ...readdirSync(path.join(root, "00_Fleeting")), ...readdirSync(path.join(root, "20_Atlas"))].filter((f) => f.includes(".tmp-"));
  check("ไม่มีไฟล์ .tmp-* ค้าง (atomic write)", tmpLeft.length === 0, tmpLeft.join(","));
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
console.log("SMOKE TEST PASSED (ครบ 14 ข้อ)");
process.exit(0);
