---
name: zero-brain-memory
description: >
  Enforce Zero Brain memory placement rules when creating, moving, or
  organizing notes under ~/.zero/brain (ZERO_BRAIN_ROOT). Auto-activate on
  brain vault paths or triggers: "memory", "place memory", "ingest session",
  "Zero Brain", "vault", "จัด memory", "วาง memory", "focus", "session focus",
  "จด", "capture". All memory operations go through zero-brain MCP tools
  (zero_*) — never edit vault files directly without rehash.
---

# zero-brain-memory — กฎวางความจำ Zero Brain (โซนใหม่ ~/.zero)

## แผนที่สมอง (จำให้ขึ้นใจ)

| Path | คืออะไร | กฎ |
|---|---|---|
| `~/.zero/brain/` | vault ความจำ (Obsidian เปิดที่นี่เท่านั้น) | อ่าน `AGENTS.md` ใน root ก่อนเสมอ |
| `~/.zero/brain/.kb/` | manifest / links / audit / episodes (JSONL append-only) | ห้ามแตะด้วยมือ — ผ่าน MCP เท่านั้น |
| `~/.zero/mcp/zero-brain/` | repo + MCP server (tools `zero_*`) | commit ต้อง smoke 121/121 ก่อน |

## กฎเหล็ก

1. **ทุกการเขียน/ย้าย/ลบความจำผ่าน tools `zero_*` เท่านั้น** — ห้ามแก้ไฟล์ vault ตรงๆ; ถ้าบังคับจำเป็น รัน `node tools/rehash-manifest.mjs` ทันทีหลังแก้
2. **orphans ต้อง = 0** — โน้ตใหม่ทุกใบ `zero_link` เข้า MOC/index อย่างน้อย 1 เส้น แล้วเช็ค `zero_health`
3. **ห้ามเก็บในสมอง**: credentials, tokens, PII, raw wire logs, full session dumps
4. privacy: `T0` default · `T1` ไม่โผล่ search default · `T2` เข้ารหัส อ่านต้องอนุมัติรายใบ — ใส่ privacy ให้ถูกตั้งแต่สร้าง

## เครื่องมือ → ปลายทาง

| ต้องการ | ใช้ tool | ลงที่ |
|---|---|---|
| จดด่วน / focus ระหว่าง session | `zero_capture` | `00_Fleeting/` |
| ความรู้ถาวร / log งาน | `zero_write_note` (atomic/entity ต้อง evidence ≥1) | `10_Notes/` |
| ดัชนี / MOC / กฎระบบ | `zero_write_note` ชี้ path `20_Atlas/` | `20_Atlas/` |
| จบงาน: ทำอะไร/วิธีไหน/ได้ผลไหม/จาก runtime ไหน | `zero_episode` | `.kb/episodes.jsonl` |
| ค้นก่อนสร้างใหม่ (กันซ้ำ) | `zero_search` / `zero_match` | — |
| ผูกเข้ากราฟ | `zero_link` (เช็ค from/to/rel ทั้งสองทิศ กันซ้ำในตัว) | `.kb/links.jsonl` |

## Placement decision tree

1. ความคิดชั่วคราว / focus สั้นๆ → `zero_capture` (00_Fleeting) — เก็บเกี่ยวใน 7 วัน
2. ความรู้ใช้ซ้ำ / บทเรียน / log โปรเจ็กต์ → `zero_write_note` ลง `10_Notes/` (โปรเจ็กต์: `10_Notes/Projects/<ชื่อ>/`)
3. ดัชนี แผนที่ กฎที่ agent ต้องอ่าน → `20_Atlas/`
4. ไม่แน่ใจ → ถามป๊าก่อนวาง
5. **ก่อนสร้างใหม่ทุกครั้ง**: `zero_search` หาของเดิมก่อน — มีแล้วให้ `zero_update_note` ไม่สร้างซ้ำ

## จบ session / compaction

1. `zero_episode` สรุป: ทำอะไร เครื่องมือไหน ได้ผล/ไม่ได้ผล (ระบุ runtime ต้นทาง: kimi-work / kimi-code / codex)
2. โน้ต fleeting ที่มีค่าถาวร → เลื่อนเป็น `zero_write_note` 10_Notes แล้ว link
3. `zero_health` ปิดท้าย: notes ครบ / orphans = 0 / dead links = 0

## Output เมื่อวางความจำ

รายงาน: id + path ที่ tool คืน · privacy ที่ตั้ง · link ที่ผูกเข้า index ไหน · ผล zero_health หลังทำ

## ตัวตนและ boot

เรื่อง boot / install / health / troubleshoot ระบบ Zero ทั้งหมด → ใช้ skill `zero` (คู่กัน) — skill นี้ครอบเฉพาะ "วางความจำให้ถูกที่"
