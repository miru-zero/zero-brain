#!/usr/bin/env node
/**
 * normalize-skill-frontmatter.mjs — คลี่ description ของทุก skill ให้เป็นบรรทัดเดียว
 *
 * ทำไม: PenguinHarness parse frontmatter แบบ naive (แยกตามบรรทัด ตัดที่ colon แรก)
 *   description: >-  (YAML folded) เลยอ่านได้แค่ ">-" → UI ไม่แสดงคำอธิบาย
 * ข้อจำกัด: บรรทัดเดียวแบบ plain scalar ห้ามมี ": " (YAML block context) → แทนด้วย " — "
 * เติม short_description (≤120 ตัวอักษร) ให้ client ที่ใช้ field นี้ (penguin UI)
 * idempotent — รันซ้ำได้ ไฟล์ที่โอเคแล้วจะไม่ถูกแตะ
 *
 * รัน: node tools/normalize-skill-frontmatter.mjs
 */
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const RepoDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SkillsRoot = path.join(RepoDir, "skills");

/** คลี่ YAML folded block (>, >-) ที่อยู่ถัดจาก key ให้เป็นข้อความบรรทัดเดียว */
function unfoldValue(lines, startIdx) {
  // lines[startIdx] = 'description: >-' หรือ 'description: >' — เก็บบรรทัด indent ที่ตามมา
  const out = [];
  for (let i = startIdx + 1; i < lines.length; i++) {
    const l = lines[i];
    if (/^\s+\S/.test(l)) out.push(l.trim());
    else break;
  }
  return out.join(" ").replace(/\s+/g, " ").trim();
}

/** plain scalar บรรทัดเดียวใน YAML block context ห้ามมี ": " และห้ามขึ้นต้นด้วย indicator */
function sanitizePlain(s) {
  let t = s.replace(/:\s+/g, " — ").replace(/\s+#/g, " (hash)"); // ': ' และ ' #' (comment) ทำ parser จริงพัง
  t = t.replace(/\s+/g, " ").trim();
  if (/^[-?{}\[\],&*!|>'"%@`]/.test(t)) t = "-" === t[0] ? `–${t.slice(1)}` : t;
  return t;
}

let changed = 0, ok = 0, failed = 0;
for (const entry of readdirSync(SkillsRoot, { withFileTypes: true })) {
  if (!entry.isDirectory()) continue;
  const file = path.join(SkillsRoot, entry.name, "SKILL.md");
  if (!existsSync(file)) continue;
  const raw = readFileSync(file, "utf8");
  const m = /^---\r?\n([\s\S]*?)\r?\n---/.exec(raw.replace(/^﻿/, ""));
  if (!m) { console.log(`SKIP ${entry.name} (ไม่มี frontmatter)`); failed++; continue; }

  const fmLines = m[1].split(/\r?\n/);
  const descIdx = fmLines.findIndex((l) => /^description\s*:/.test(l));
  if (descIdx < 0) { console.log(`SKIP ${entry.name} (ไม่มี description)`); failed++; continue; }

  const descLine = fmLines[descIdx];
  const afterColon = descLine.slice(descLine.indexOf(":") + 1).trim();

  let desc;
  if (afterColon === ">-" || afterColon === ">" || afterColon === "|" || afterColon === "|-") {
    desc = unfoldValue(fmLines, descIdx);
  } else {
    desc = afterColon.replace(/^"|"$/g, "");
  }
  if (!desc) { console.log(`SKIP ${entry.name} (description ว่าง)`); failed++; continue; }

  // ตัด block เดิมของ description ออก (บรรทัด key + บรรทัด indent ที่ตามมา)
  let end = descIdx + 1;
  while (end < fmLines.length && /^\s+\S/.test(fmLines[end])) end++;

  const oneLine = sanitizePlain(desc);
  const short = sanitizePlain(desc.length > 120 ? desc.slice(0, 117).replace(/\s+\S*$/, "") + "…" : desc);

  // มี short_description เดิมไหม — มีก็แทนที่ ไม่มีก็เติมถัดจาก description
  const newFm = [];
  let shortDone = false;
  for (let i = 0; i < fmLines.length; i++) {
    if (i === descIdx) {
      newFm.push(`description: ${oneLine}`);
      newFm.push(`short_description: ${short}`);
      shortDone = true;
      i = end - 1; // ข้าม block indent เดิม
      continue;
    }
    if (/^short_description\s*:/.test(fmLines[i])) continue; // ลบของเดิม (เขียนใหม่ข้างบน)
    newFm.push(fmLines[i]);
  }
  if (!shortDone) newFm.push(`short_description: ${short}`);

  const next = `---\n${newFm.join("\n")}\n---${raw.slice(m[0].length)}`;
  if (next === raw) { ok++; continue; }
  writeFileSync(file, next, "utf8");
  changed++;
  console.log(`FIX  ${entry.name}`);
}
console.log(`\nสรุป: แก้ ${changed} · โอเคอยู่แล้ว ${ok} · ข้าม/พลาด ${failed}`);
