# Central Brain MCP Server

MCP server (stdio transport) สำหรับเชื่อม agent ใดๆ เข้ากับ **Central Brain** — สมองกลาง domain-agnostic ตามดีไซน์ v2.1 เก็บโน้ตเป็นไฟล์ Markdown + frontmatter บน local filesystem ล้วน **ไม่มี network call**

> **v1.1 (2026-07-29)** — แก้ตามผลวิเคราะห์ใหม่:
> 1. **T2 approval gate จริง** — `brain_read` บล็อกโน้ต T2 จนกว่าป๊าจะสร้าง `.kb/approvals/<note-id>.json` ด้วยมือ (agent อนุมัติตัวเองไม่ได้ ไม่มี tool สำหรับสร้าง) รองรับ `expires` (ISO date) ทุกการบล็อก/อ่านถูก audit; โน้ต T1 อ่านได้แต่ถูก audit ทุกครั้ง; T2 ไม่โผล่ใน `brain_search` แม้ `include_private=true` จนกว่าจะอนุมัติ; T2 ไม่ขึ้น Today.md
> 2. **health สแกน body wikilinks** — เดิม `brain_health` ตรวจเฉพาะ frontmatter links ทำให้ลิงก์ `[[...]]` ตายในเนื้อโน้ตโดยเงียบ ตอนนี้รายงาน `dead_body_links` (resolve ผ่าน id/alias/title)
> 3. ตัวอย่างไฟล์อนุมัติ: `{"approved_by":"ป๊า","at":"2026-07-29","expires":null}`
>
> **หมายเหตุ pack:** `node_modules/` ถูก bundle มาใน zip เจตนาเพื่อ **offline install** (ข้าม `npm install` ได้เลย แค่ `npm run build` หรือใช้ `dist/` ที่ build มาแล้ว)
>
> **v1.2.1 (2026-07-29)** — durability patch จากรีวิวของป๊า:
> 1. **Atomic write ทุกไฟล์โน้ต** — saveNote/update_note/link/Today.md เขียนผ่าน tmp+rename (crash กลางเขียนไม่ทำโน้ตพัง)
> 2. **Link dedup** — `brain_link` เช็ค links.jsonl ก่อน append (from/to/rel ทั้งสองทิศ) ลิงก์ซ้ำไม่บวม คืน `deduped: true`
> 3. **Orphans ไม่นับ fleeting** — inbox ค้างไม่ใช่ปัญหาโครงสร้าง แยกนับใน `orphans_fleeting`
> 4. ยืนยัน: `brain_update_note` รับ `body` อยู่แล้ว (schema + handler) — เพิ่มเทสกัน regression
> smoke test 52/52 (14 sections)
>
> **v1.2 (2026-07-29)** — เพิ่ม:
> 1. **`brain_nightly`** — วงจรกลางคืนใน tool เดียว: คืน fleeting queue ที่ยังไม่จัด + regenerate Today.md + health ครบ + snapshot ลง `99_System/snapshots/` (agent เรียกตอนเช้า/ก่อนนอน แล้ว classify ต่อด้วย `brain_write_note` + `brain_update_note`)
> 2. **Pack provenance** — `brain_list_packs` โชว์ status `verified/modified/unreviewed` เทียบ `.kb/packs.lock.json` (sha256 ที่ป๊าล็อกด้วยมือเท่านั้น) + `brain_health` เตือนใน `packs_unverified`
>
> **Dry-run ก่อน install (แนะนำ):** แตก zip → `cd central-brain-mcp` → `node test/smoke.mjs` (ผ่าน 52/52 = พร้อม) → ค่อยตั้งค่า MCP client จริง

## ความต้องการ

- Node.js >= 18
- npm

## การติดตั้ง

```bash
npm install
npm run build
```

build จะ compile TypeScript ไปที่ `dist/` — entry point คือ `dist/index.js` (มี shebang `#!/usr/bin/env node`)

## การตั้งค่า MCP client

กำหนดตำแหน่ง brain root ผ่าน env `CENTRAL_BRAIN_ROOT` (ถ้าไม่ตั้ง จะใช้ `./brain` สัมพัทธ์กับ working directory)

ตัวอย่าง config สำหรับ MCP client (เช่น Claude Desktop / client ที่รองรับ stdio):

```json
{
  "mcpServers": {
    "central-brain": {
      "command": "node",
      "args": ["/absolute/path/to/central-brain-mcp-server/dist/index.js"],
      "env": {
        "CENTRAL_BRAIN_ROOT": "/absolute/path/to/my-brain"
      }
    }
  }
}
```

> เปลี่ยน `/absolute/path/to/...` เป็น path จริงของเครื่องคุณ

## การทดสอบ

```bash
npm run build
node test/smoke.mjs
```

smoke test ครอบคลุม 8 ข้อ: init / capture / evidence rule / write+manifest / search+privacy filter / link / resolve / health — ต้องผ่านทั้งหมด (exit 0)

## Tools ทั้ง 12 ตัว

| Tool | หน้าที่ |
|---|---|
| `brain_init` | สร้างโครงสร้างโฟลเดอร์ + ไฟล์ kernel เปล่า + skeleton packs (self, people, security) + Home.md/Today.md |
| `brain_capture` | จดด่วนลง `00_Fleeting/` (เบาที่สุด ไม่ validate) |
| `brain_write_note` | เขียนโน้ตถาวรลง `10_Notes/` — **atomic/entity ต้องมี evidence ≥ 1** |
| `brain_update_note` | แก้เฉพาะฟิลด์ที่ส่ง (ห้ามแก้ id/created) |
| `brain_read` | อ่านโน้ต frontmatter + body (resolve alias ก่อน) |
| `brain_search` | ค้นจาก title/aliases/tags/body — **default ไม่คืน T1/T2** (`include_private=true` จะถูก audit) |
| `brain_link` | สร้างลิงก์สองทิศ + append `links.jsonl` |
| `brain_resolve` | คืน id จาก alias/title (exact ก่อน แล้ว fuzzy contains) |
| `brain_list_packs` | list domain packs ใน `.kb/packs/` |
| `brain_health` | คำนวณ orphans/dead_links เขียน `health.json` |
| `brain_home` | คืน Home.md + Today.md (รีเฟรช Today จาก active notes + fleeting 24h) |
| `brain_audit` | คืน audit log ล่าสุด N รายการ |

## กฎเหล็ก (enforce ในโค้ด)

- **ไม่มี delete ใดๆ** — "ซ่อน" ได้ด้วย `state: archive` เท่านั้น
- ไฟล์ kernel `manifest.jsonl` / `links.jsonl` / `audit.jsonl` เป็น **append-only** ห้ามเขียนทับ
- โน้ต `type: atomic` หรือ `entity` ต้องมี evidence อย่างน้อย 1 ข้อ ไม่เช่นนั้น error พร้อมแนะนำให้ใช้ `type: fleeting`
- `brain_search` ไม่คืนโน้ต privacy T1/T2 โดย default — ถ้า `include_private: true` จะถูก audit ทุกครั้ง
- ทุก mutation ถูกบันทึกลง `audit.jsonl`
- ทุกอย่างเป็น local filesystem — ห้าม network call

## โครงสร้าง brain root

```
<root>/
├── .kb/
│   ├── manifest.jsonl   # metadata โน้ต (append-only, ตัวล่าสุดชนะ)
│   ├── links.jsonl      # ลิงก์ระหว่างโน้ต (append-only)
│   ├── aliases.json     # map alias → id
│   ├── health.json      # ผล brain_health ล่าสุด
│   ├── audit.jsonl      # log ทุก mutation (append-only)
│   └── packs/           # domain packs (*.yaml)
├── 00_Fleeting/         # จดด่วน <id>.md
├── 10_Notes/            # โน้ตถาวร <id> - <slug>.md
├── 20_Atlas/            # Home.md, Today.md
├── 30_Sources/
├── 40_Templates/base/
└── 99_System/snapshots/
```

## โครงสร้างโค้ด

```
src/
├── index.ts    # MCP server (stdio) + tools 12 ตัว
├── kernel.ts   # append-only JSONL, manifest/links/aliases/health/audit
└── schema.ts   # frontmatter parse/serialize (YAML แบบจำกัด), slug sanitize, validation
test/
└── smoke.mjs   # smoke test 8 ข้อ รันบน dist
```
