# Zero Brain MCP Server

MCP server (stdio transport) สำหรับเชื่อม agent ใดๆ เข้ากับ **Zero Brain** — สมองกลาง domain-agnostic ตามดีไซน์ v2.1 เก็บโน้ตเป็นไฟล์ Markdown + frontmatter บน local filesystem ล้วน **ไม่มี network call**

> **v2.1.0 (2026-07-29)** — install ง่ายขึ้นมาก:
> 1. **`npm run init` สร้างโครงสมองให้อัตโนมัติ** — ไม่ต้องแตก seed zip เองอีก (`node dist/index.js --init` ใช้ handler เดียวกับ `zero_init`)
> 2. **บ้านหลัก default คือ `~/.zero/brain`** — ไม่ตั้ง env ก็ใช้ได้เลย (ตั้ง `ZERO_BRAIN_ROOT` เฉพาะตอนอยากย้ายที่)
> 3. seed zip (`Central_Brain_seed`) เหลือไว้สำหรับย้ายสมองเก่าเท่านั้น
> smoke test 64/64 (16 sections)
>
> **v2.0.1 (2026-07-29)** — เปลี่ยนชื่อโปรเจกต์ **central-brain → zero-brain** (คนละตัวกับ skill `zero-brain-memory`):
> 1. repo ย้ายเป็น `miru-zero/zero-brain` (URL เก่า redirect อัตโนมัติ)
> 2. package/bin: `zero-brain-mcp-server` / `zero-brain`
> 3. env หลักเปลี่ยนเป็น `ZERO_BRAIN_ROOT` / `ZERO_BRAIN_ACTOR` — **ค่าเก่า `CENTRAL_BRAIN_*` ยังใช้ได้** (fallback ไม่ break config เดิม)
>
> **v2.0.0 (2026-07-29)** — breaking change + token-saving:
> 1. **Rename tools ทั้ง 13 ตัว `brain_*` → `zero_*`** — ชื่อใหม่: `zero_init` `zero_capture` `zero_write_note` `zero_update_note` `zero_read` `zero_search` `zero_link` `zero_resolve` `zero_list_packs` `zero_health` `zero_home` `zero_nightly` `zero_audit` (MCP client config ไม่ต้องแก้ แต่ผู้ใช้/agent ต้องเรียกชื่อใหม่; audit log action strings ยังคง `brain_*` เดิมเพื่อ continuity ของ log เก่า)
> 2. **Response กระชับลง (ลด token)** — ทุก tool คืน compact JSON (ไม่ pretty-print); `zero_search` มี `limit` (default 10) + `offset` คืน `total/count/limit/offset`; `zero_health` เขียน `health.json` เต็มเหมือนเดิมแต่ response คืนเฉพาะสรุป + counts + top-20 ของแต่ละหมวด; `zero_home` default **ไม่**คืนเนื้อ Home.md (คืน path + ขนาด ใส่ `include_home: true` ถ้าต้องการ) และ Today.md จำกัด active 30 ใบ; `zero_nightly` จำกัด fleeting queue 50 ใบ
> 3. **แก้บั๊ก latent** — `parseNoteFile` regex เดิม parse frontmatter หลายบรรทัดไม่ได้เลย (`.` ไม่ match newline); เติม exports ที่ขาดใน `schema.ts` (`today`/`genId`/`sanitizeSlug`/`serializeNote` + type aliases)
> smoke test 60/60 (15 sections)
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
> **v1.1 (2026-07-29)** — แก้ตามผลวิเคราะห์ใหม่:
> 1. **T2 approval gate จริง** — `zero_read` บล็อกโน้ต T2 จนกว่าป๊าจะสร้าง `.kb/approvals/<note-id>.json` ด้วยมือ (agent อนุมัติตัวเองไม่ได้ ไม่มี tool สำหรับสร้าง) รองรับ `expires` (ISO date) ทุกการบล็อก/อ่านถูก audit; โน้ต T1 อ่านได้แต่ถูก audit ทุกครั้ง; T2 ไม่โผล่ใน `zero_search` แม้ `include_private=true` จนกว่าจะอนุมัติ; T2 ไม่ขึ้น Today.md
> 2. **health สแกน body wikilinks** — เดิม `zero_health` ตรวจเฉพาะ frontmatter links ทำให้ลิงก์ `[[...]]` ตายในเนื้อโน้ตโดยเงียบ ตอนนี้รายงาน `dead_body_links` (resolve ผ่าน id/alias/title)
> 3. ตัวอย่างไฟล์อนุมัติ: `{"approved_by":"ป๊า","at":"2026-07-29","expires":null}`
>
> **หมายเหตุ pack:** `node_modules/` ถูก bundle มาใน zip เจตนาเพื่อ **offline install** (ข้าม `npm install` ได้เลย แค่ `npm run build` หรือใช้ `dist/` ที่ build มาแล้ว)
>
> **Dry-run ก่อน install (แนะนำ):** แตก zip → `cd central-brain-mcp` → `node test/smoke.mjs` (ผ่าน 64/64 = พร้อม) → ค่อยตั้งค่า MCP client จริง

## ความต้องการ

- Node.js >= 18
- npm

## การติดตั้ง

```bash
npm install
npm run build
npm run init    # สร้างโครงสมองที่ ~/.zero/brain อัตโนมัติ (ตั้ง ZERO_BRAIN_ROOT ก่อนถ้าอยากใช้ที่อื่น)
```

build จะ compile TypeScript ไปที่ `dist/` — entry point คือ `dist/index.js` (มี shebang `#!/usr/bin/env node`)

## การตั้งค่า MCP client

**ไม่ต้องตั้ง env ก็ได้** — default สมองจะอยู่ที่ `~/.zero/brain` (ตั้งแต่ v2.1.0) ตั้ง `ZERO_BRAIN_ROOT` เฉพาะตอนอยากย้ายที่เก็บ — ตั้งแต่ v2.0.1 รองรับ `CENTRAL_BRAIN_ROOT` เป็น fallback เพื่อไม่ break config เก่า

ตัวอย่าง config สำหรับ MCP client (เช่น Claude Desktop / client ที่รองรับ stdio):

```json
{
  "mcpServers": {
    "zero-brain": {
      "command": "node",
      "args": ["/absolute/path/to/zero-brain/dist/index.js"]
    }
  }
}
```

ถ้าอยากย้ายที่เก็บสมอง เพิ่ม `"env": { "ZERO_BRAIN_ROOT": "/absolute/path/to/my-brain" }` — เปลี่ยน `/absolute/path/to/...` เป็น path จริงของเครื่องคุณ

## Zone convention — ทุกอย่างของเราอยู่ใต้ `~/.zero/`

บ้านโซนเดียวกันทั้งระบบ: ของที่ชื่อ `zero-X` จะอยู่ที่ `~/.zero/X` (ตัด `zero-` แล้วเปลี่ยน `-` เป็น `/`) เช่น

```
~/.zero/
├── brain/        # เนื้อสมองของ zero-brain (repo นี้) — default ตั้งแต่ v2.1.0
└── <อนาคต>/      # โปรเจกต์ zero-* ตัวอื่นจะมาอยู่ใต้โซนเดียวกันนี้
```

- โค้ด (repo) อยู่ที่ไหนก็ได้ แต่ **ข้อมูลรันไทม์ทั้งหมดอยู่ใต้ `~/.zero/`** ที่เดียว ไม่รก
- ย้ายได้เสมอด้วย `ZERO_BRAIN_ROOT` แต่ default คือโซนนี้
- env ที่ระบบอ่านมีแค่ `ZERO_BRAIN_ROOT` / `ZERO_BRAIN_ACTOR` (และ fallback `CENTRAL_BRAIN_*`)

## การทดสอบ

```bash
npm run build
node test/smoke.mjs
```

smoke test ครอบคลุม 16 sections (64 checks): init / capture / evidence rule / write+manifest / search+privacy filter / link+dedup / resolve / health / update_note body / T2 approval gate / body wikilinks / pack provenance / nightly / atomic write / v2.0.0 token-saving / v2.1.0 install UX — ต้องผ่านทั้งหมด (exit 0)

## Tools ทั้ง 13 ตัว

| Tool | หน้าที่ |
|---|---|
| `zero_init` | สร้างโครงสร้างโฟลเดอร์ + ไฟล์ kernel เปล่า + skeleton packs (self, people, security) + Home.md/Today.md |
| `zero_capture` | จดด่วนลง `00_Fleeting/` (เบาที่สุด ไม่ validate) |
| `zero_write_note` | เขียนโน้ตถาวรลง `10_Notes/` — **atomic/entity ต้องมี evidence ≥ 1** |
| `zero_update_note` | แก้เฉพาะฟิลด์ที่ส่ง (ห้ามแก้ id/created) |
| `zero_read` | อ่านโน้ต frontmatter + body (resolve alias ก่อน) — **T2 ต้องได้รับอนุมัติก่อน** |
| `zero_search` | ค้นจาก title/aliases/tags/body — **default ไม่คืน T1/T2** (`include_private=true` จะถูก audit) — มี `limit` (default 10) + `offset` |
| `zero_link` | สร้างลิงก์สองทิศ + append `links.jsonl` (dedup อัตโนมัติ) |
| `zero_resolve` | คืน id จาก alias/title (exact ก่อน แล้ว fuzzy contains) |
| `zero_list_packs` | list domain packs ใน `.kb/packs/` + status provenance |
| `zero_health` | คำนวณ orphans/dead_links/dead_body_links/packs_unverified เขียน `health.json` เต็ม — response คืนสรุป + top-20 ต่อหมวด |
| `zero_home` | รีเฟรช Today.md จาก active notes (สูงสุด 30 ใบ) + fleeting 24h — default ไม่คืนเนื้อ Home.md (`include_home: true` ถ้าต้องการ) |
| `zero_nightly` | วงจรกลางคืน: fleeting queue (สูงสุด 50 ใบ) + regenerate Today + health + snapshot ลง `99_System/snapshots/` |
| `zero_audit` | คืน audit log ล่าสุด N รายการ |

## กฎเหล็ก (enforce ในโค้ด)

- **ไม่มี delete ใดๆ** — "ซ่อน" ได้ด้วย `state: archive` เท่านั้น
- ไฟล์ kernel `manifest.jsonl` / `links.jsonl` / `audit.jsonl` เป็น **append-only** ห้ามเขียนทับ
- โน้ต `type: atomic` หรือ `entity` ต้องมี evidence อย่างน้อย 1 ข้อ ไม่เช่นนั้น error พร้อมแนะนำให้ใช้ `type: fleeting`
- `zero_search` ไม่คืนโน้ต privacy T1/T2 โดย default — ถ้า `include_private: true` จะถูก audit ทุกครั้ง
- ทุก mutation ถูกบันทึกลง `audit.jsonl`
- ทุกอย่างเป็น local filesystem — ห้าม network call

## โครงสร้าง brain root

```
<root>/
├── .kb/
│   ├── manifest.jsonl   # metadata โน้ต (append-only, ตัวล่าสุดชนะ)
│   ├── links.jsonl      # ลิงก์ระหว่างโน้ต (append-only)
│   ├── aliases.json     # map alias → id
│   ├── health.json      # ผล zero_health ล่าสุด (เต็มทุกหมวด — response ของ tool เป็นสรุป)
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
├── index.ts    # MCP server (stdio) + tools 13 ตัว (zero_*)
├── kernel.ts   # append-only JSONL, manifest/links/aliases/health/audit
└── schema.ts   # frontmatter parse/serialize (YAML แบบจำกัด), slug sanitize, validation
test/
└── smoke.mjs   # smoke test 16 sections (64 checks) รันบน dist
```

## Skills

โฟลเดอร์ [`skills/`](./skills/) เก็บ skill ของระบบ Zero_Brain ในรูปแบบ `SKILL.md` มาตรฐาน — ส่งไฟล์ให้ AI (Kimi Work / Claude Code) สั่ง "ติดตั้ง skill นี้" ได้เลย หรือวางด้วยมือตาม[คู่มือใน `skills/README.md`](./skills/README.md)
