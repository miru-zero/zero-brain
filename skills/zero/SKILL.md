---
name: zero
description: >
  Use when the user types /zero or asks to boot, check, health-check, or install
  the Zero system — e.g. "/zero", "เปิด zero", "เช็คระบบ zero", "zero status",
  "ติดตั้ง zero", "zero ไม่ทำงาน". Covers the ~/.zero zone: brain vault,
  zero-brain MCP (zero_* tools), and daimon skills. Also use when an AI receives
  this SKILL.md as an install package for a fresh machine.
type: standard
---

# ⭕ ZERO — Boot / Health / Install ของระบบ Zero

## Overview

คำสั่งเดียวสำหรับ "ตื่น + เช็ค + ซ่อม" ระบบ Zero ของป๊า ทุกอย่างอยู่ใต้โซน `~/.zero/` (Windows: `C:\Users\<user>\.zero\`) — ห้ามกระจายไปที่อื่น

## แผนที่โซน (จำให้ขึ้นใจ)

| Path | คืออะไร | ห้าม |
|---|---|---|
| `~/.zero/brain/` | สมอง (Obsidian vault, 616+ โน้ต, orphan ต้อง = 0) | ห้ามแก้ไฟล์ตรงๆ นอก MCP ถ้าไม่ rehash manifest |
| `~/.zero/mcp/zero-brain/` | repo `miru-zero/zero-brain` + MCP server (tools `zero_*`) | ห้าม commit ถ้า smoke ไม่ผ่าน 68/68 |
| `~/.zero/share/` | ส่วนทำงาน daimon (sessions, skills, runtime) — ไม่ใช่สมอง | ห้ามนับเป็นความจำ |

## Boot Check (รันเมื่อถูกเรียก)

1. `~/.zero/brain/` มี `AGENTS.md` + `manifest.jsonl` → อ่าน `AGENTS.md` ก่อนเสมอ (สัญญามนุษย์-agent)
2. MCP `zero_health` ตอบ → notes ครบ / orphans = 0 / dead links = 0 → รายงานตัวเลขให้ป๊า
3. junction สกิล: `~/.zero/share/daimon-share/daimon/skills/` ต้องเห็นสกิล ~259 ตัว รวม `zero*` 5 ตัว (zero, zero-check, zero-brain-ai-bridge, zero-brain-evidence-report, zero-brain-memory, zero-brain-patch-guard)
4. ผิดปกติข้อไหน → รายงาน + เสนอซ่อม ห้ามซ่อมเองถ้าเป็นงานลบ/ย้าย (กฎข้อ 1 ห้องป๊า)

## Install (เครื่องใหม่ / AI ตัวอื่นได้รับ SKILL.md นี้)

```powershell
git clone https://github.com/miru-zero/zero-brain.git $HOME/.zero/mcp/zero-brain
cd $HOME/.zero/mcp/zero-brain; npm install; npm run build
node test/smoke.mjs          # ต้องผ่าน 68/68 ก่อนไปต่อ ห้ามข้าม
./install.ps1                # สร้างโซน ~/.zero/brain จาก seed/ อัตโนมัติ
```

แล้วตั้ง MCP config ให้ client ชี้มาที่ server นี้ → เรียก `zero_health` เห็น notes ครบ / 0 dead = สำเร็จ
ทีมงาน: ส่งไฟล์ SKILL.md นี้ให้ AI ตัวไหนก็ได้ มันสร้างโซน + ติดตั้งให้จบในตัว

## กฎเหล็กที่ต้องเที่ยงทุกครั้ง

- **STOP → THINK → RUN ONCE** — อ่าน `brain/20_Atlas/Token Budget Policy.md` ก่อนงานดีบั๊ก/รันยาว ห้าม poll loop
- ความจำทุกอย่างผ่าน `zero_*` tools เท่านั้น (capture/write/search/link) — กฎเต็มอยู่ใน `brain/AGENTS.md`
- โทนผู้ใช้ป๊า: มิรุ ผู้หญิง เรียกตัวเอง "เค้า" ไม่ใช้ "ครับ/ดิฉัน" ตอบกระชับ มีหลักฐานทุกเคลม

## Common Mistakes

| ผิด | ถูก |
|---|---|
| แก้โน้ต brain ด้วย file tools แล้วไม่ rehash | ใช้ MCP; ถ้าจำเป็นต้องแก้ตรง รัน `rehash-manifest.mjs` ทันที |
| commit repo โดยไม่รัน smoke | `node test/smoke.mjs` 68/68 ทุกครั้งก่อน commit |
| นับ `share/` เป็นสมอง | share = third-party runtime ซ่อนจาก Obsidian แล้ว |
| ติดตั้งแล้วไม่เช็ค `zero_health` | ไม่มีหลักฐาน = ยังไม่เสร็จ (กฎข้อ 2 ห้องป๊า) |
