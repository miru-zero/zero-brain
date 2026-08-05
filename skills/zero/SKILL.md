---
name: zero
description: Auto-activate when the user types /zero or asks about the Zero system — boot, health-check, sync, install, or troubleshoot — e.g. "/zero", "เปิด zero", "เช็คระบบ zero", "zero status", "ติดตั้ง zero", "zero ไม่ทำงาน", "ซิงก์สมอง", "อัปเดตสมอง", "zero-brain", "สกิลของ zero". Covers the ~/.zero zone — brain vault, zero-brain MCP (zero_* tools), and daimon skills. Also use when an AI receives this SKILL.md as an install package for a fresh machine.
short_description: Auto-activate when the user types /zero or asks about the Zero system — boot, health-check, sync, install, or…
---

# ⭕ ZERO — Boot / Health / Install ของระบบ Zero

## Overview

คำสั่งเดียวสำหรับ "ตื่น + เช็ค + ซ่อม" ระบบ Zero ของป๊า ทุกอย่างอยู่ใต้โซน `~/.zero/` (Windows: `C:\Users\<user>\.zero\`) — ห้ามกระจายไปที่อื่น

## แผนที่โซน (จำให้ขึ้นใจ)

| Path | คืออะไร | ห้าม |
|---|---|---|
| `~/.zero/brain/` | สมอง (Obsidian vault, 616+ โน้ต, orphan ต้อง = 0) | ห้ามแก้ไฟล์ตรงๆ นอก MCP ถ้าไม่ rehash manifest |
| `~/.zero/mcp/zero-brain/` | repo `miru-zero/zero-brain` + MCP server (tools `zero_*`) | ห้าม commit ถ้า smoke ไม่ผ่าน 121/121 |
| `~/.zero/share/` | ส่วนทำงาน daimon (sessions, skills, runtime) — ไม่ใช่สมอง | ห้ามนับเป็นความจำ |

## Boot Check (รันเมื่อถูกเรียก)

> **Skills index lifecycle**: index สร้างตอน session เริ่ม (และ rebuild ตอน compact) — skill ที่ลงกลาง session จะ **ไม่เข้า index ทันที** · ถ้าป๊าพิมพ์ /zero แล้วไม่ทริกเกอร์ ให้เช็คว่า session นี้เก่ากว่าตอนติดตั้งไหม → ทางแก้: เปิด session ใหม่ (หรือรอ compact)

1. **เช็ค MCP ก่อนเลย** — ถ้า session นี้ไม่มี tools `zero_*` แปลว่า client ยังไม่ได้ต่อ zero-brain → รัน `node ~/.zero/mcp/zero-brain/tools/setup-agents.mjs` แล้วบอกป๊า restart client · **ห้าม sync/แก้ brain ด้วย file tools แทนเด็ดขาด**
2. `~/.zero/brain/` มี `AGENTS.md` + `manifest.jsonl` → อ่าน `AGENTS.md` ก่อนเสมอ (สัญญามนุษย์-agent)
3. MCP `zero_health` ตอบ → notes ครบ / orphans = 0 / dead links = 0 → รายงานตัวเลขให้ป๊า
4. **Obsidian vault = `~/.zero` ทั้งโซน โดย non-brain ถูกซ่อนอัตโนมัติ** — install รัน `tools/setup-obsidian.mjs` ซ่อน mcp/share/… 2 ชั้น (userIgnoreFilters ใน graph/search + CSS snippet ใน explorer) ให้เหลือ `brain/` ก้อนเดียว · ถ้าเห็น `daimon-share`/`mcp` โผล่ใน vault explorer แปลว่าเครื่องนั้นยังไม่ได้รัน → รัน `node ~/.zero/mcp/zero-brain/tools/setup-obsidian.mjs` แล้ว reload Obsidian (Ctrl+R)
5. ผิดปกติข้อไหน → รายงาน + เสนอซ่อม ห้ามซ่อมเองถ้าเป็นงานลบ/ย้าย (กฎข้อ 1 ห้องป๊า)

## Install (เครื่องใหม่ / AI ตัวอื่นได้รับ SKILL.md นี้)

```powershell
git clone https://github.com/miru-zero/zero-brain.git $HOME/.zero/mcp/zero-brain
cd $HOME/.zero/mcp/zero-brain
powershell -ExecutionPolicy Bypass -File install.ps1   # Linux/macOS/cloud: bash install.sh (ขั้นตอนเดียวกัน)
```

`install.ps1`/`install.sh` ตัวเดียวทำครบ: npm install → build → init สมองจาก seed/ → smoke 121/121 (ห้ามข้าม) → **ผูก agent ทุก client ตั้งแต่ boot อัตโนมัติ** (`tools/setup-agents.mjs`: codex / kimi-claw / kimi-code / daimon / penguin — idempotent มี backup, ใส่ตัวตนมิรุ+BOOT เป็น system prompt · client ที่ไม่มี MCP runtime ได้ block ฉบับ zero CLI)
ขั้นสุดท้าย: restart client แต่ละตัว → `node tools/verify-install.mjs` ต้อง PASS ครบ 3 ชั้น (ไฟล์ / ตัวตน / spawn MCP จริง) = สำเร็จ
ทีมงาน: ส่งไฟล์ SKILL.md นี้ (หรือแพ็ก `zero.skill`) ให้ AI ตัวไหนก็ได้ มันสร้างโซน + ติดตั้งให้จบในตัว

## Cloud / Ephemeral Sandbox (kimi.com, VM ชั่วคราว)

sandbox คลาว **ไม่มีดิสก์ถาวรและไม่มีชั้น MCP client** — ห้ามสัญญาว่า "ติดตั้งถาวรบนคลาว" ให้ทำตัวเป็น stateless worker:
1. ติดตั้งด้วย `bash install.sh` ได้ครบทุกขั้น (npm path portable) — แต่โซนจะหายเมื่อ session จบ ถือเป็น dry-run เสมอ
2. **สมองถาวรอยู่ที่ brain git remote (private เท่านั้น)** — clone ลง `~/.zero/brain` ก่อนใช้งาน; ถ้ายังไม่มี remote ให้ init จาก seed แล้วเตือนเจ้าของทันทีว่า "สมองชุดนี้หายเมื่อ session จบ"
3. **ก่อนจบ session ต้อง commit + push brain กลับ remote** — ไม่ push = ความจำที่เพิ่งสร้างหายถาวร
4. tools `zero_*` จะไม่ขึ้นเป็น native tools บนคลาว — ใช้งานผ่าน spawn `node dist/index.js` (stdio) ตรงๆ เท่านั้น

## Client ที่ไม่มี MCP runtime (penguin, sandbox, CLI อื่น)

บาง client (เช่น PenguinHarness — `mcpServers` ใน config เป็น placeholder ที่ยังไม่ implement) เข้าถึงสมองผ่าน **zero CLI** ที่ลง PATH แล้ว (`~/.zero/bin`):

```bash
zero health                                    # เช็คสมอง
zero mcp zero_search '{"query":"..."}'         # ค้นความจำ (ค้นก่อนทำงานที่เคยทำเสมอ)
zero mcp zero_match '{"query":"..."}'          # เคยทำไหม/วิธีไหน/ได้ผลไหม
zero mcp zero_capture '{"text":"..."}'         # จดด่วน
zero mcp zero_episode '{"task":"...","method":"...","outcome":"pass|fail|partial","evidence":"..."}'
```

`zero mcp <tool> '<json-args>'` = passthrough ไปยัง tool `zero_*` ใดก็ได้ผ่าน stdio — schema เหมือน MCP เป๊ะ · setup-agents.mjs ฝัง AGENTS.md ฉบับ CLI + skill ให้ client พวกนี้อัตโนมัติ (ตอนนี้: penguin ทุก project/agent ใน `~/.penguin/data`)

## กฎเหล็กที่ต้องเที่ยงทุกครั้ง

- **STOP → THINK → RUN ONCE** — อ่าน `brain/20_Atlas/Token Budget Policy.md` ก่อนงานดีบั๊ก/รันยาว ห้าม poll loop
- ความจำทุกอย่างผ่าน `zero_*` tools เท่านั้น (capture/write/search/link) — กฎเต็มอยู่ใน `brain/AGENTS.md`
- โทนผู้ใช้ป๊า: มิรุ ผู้หญิง เรียกตัวเอง "เค้า" ไม่ใช้ "ครับ/ดิฉัน" ตอบกระชับ มีหลักฐานทุกเคลม

## Common Mistakes

| ผิด | ถูก |
|---|---|
| แก้โน้ต brain ด้วย file tools แล้วไม่ rehash | ใช้ MCP; ถ้าจำเป็นต้องแก้ตรง รัน `rehash-manifest.mjs` ทันที |
| commit repo โดยไม่รัน smoke | `node test/smoke.mjs` 121/121 ทุกครั้งก่อน commit |
| นับ `share/` เป็นสมอง | share = third-party runtime ซ่อนจาก Obsidian แล้ว |
| เห็น mcp/share โผล่ใน Obsidian แล้วไปซ่อนมือเอง | รัน `node tools/setup-obsidian.mjs` (install ทำให้อัตโนมัติทุกเครื่อง) |
| ติดตั้งแล้วไม่เช็ค verify | `node tools/verify-install.mjs` PASS 3 ชั้น = เสร็จจริง (กฎข้อ 2 ห้องป๊า) |
