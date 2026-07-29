# Central Brain MCP Server

MCP server (stdio transport) สำหรับเชื่อม agent ใดๆ เข้ากับ **Central Brain** — สมองกลาง domain-agnostic ตามดีไซน์ v2.1 เก็บโน้ตเป็นไฟล์ Markdown + frontmatter บน local filesystem ล้วน **ไม่มี network call**

> **v1.1 (2026-07-29)** — แก้ตามผลวิเคราะห์ใหม่:
> 1. **T2 approval gate จริง** — `brain_read` บล็อกโน้ต T2 จนกว่าป๊าจะสร้าง `.kb/approvals/<note-id>.json` ด้วยมือ (agent อนุมัติตัวเองไม่ได้ ไม่มี tool สำหรับสร้าง) รองรับ `expires` (ISO date) ทุกการบล็อก/อ่านถูก audit; โน้ต T1 อ่านได้แต่ถูก audit ทุกครั้ง; T2 ไม่โผล่ใน `brain_search` แม้ `include_private=true` จนกว่าจะอนุมัติ; T2 ไม่ขึ้น Today.md
> 2. **health สแกน body wikilinks** — เดิม `brain_health` ตรวจเฉพาะ frontmatter links ทำให้ลิงก์ `[[...]]` ตายในเนื้อโน้ตโดยเงียบ ตอนนี้รายงาน `dead_body_links` (resolve ผ่าน id/alias/title)
> 3. ตัวอย่างไฟล์อนุมัติ: `{"approved_by":"ป๊า","at":"2026-07-29","expires":null}`
>
> **v1.2 (2026-07-29)** — เพิ่ม:
> 1. **`brain_nightly`** — วงจรกลางคืนใน tool เดียว: คืน fleeting queue ที่ยังไม่จัด + regenerate Today.md + health ครบ + snapshot ลง `99_System/snapshots/`
> 2. **Pack provenance** — `brain_list_packs` โชว์ status `verified/modified/unreviewed` เทียบ `.kb/packs.lock.json` (sha256 ที่ล็อกด้วยมือเท่านั้น) + `brain_health` เตือนใน `packs_unverified`
>
> **Dry-run ก่อน install:** `npm install && npm run build && node test/smoke.mjs` (ผ่าน 45/45 = พร้อม)

## ความต้องการ

- Node.js >= 18
- npm

## การติดตั้ง

```bash
npm install
npm run build
```

build จะ compile TypeScript ไปที่ `dist/` — entry point คือ `dist/index.js`

## การตั้งค่า MCP client

กำหนดตำแหน่ง brain root ผ่าน env `CENTRAL_BRAIN_ROOT` (ถ้าไม่ตั้ง จะใช้ `./brain`)

```json
{
  "mcpServers": {
    "central-brain": {
      "command": "node",
      "args": ["/absolute/path/to/central-brain/dist/index.js"],
      "env": {
        "CENTRAL_BRAIN_ROOT": "/absolute/path/to/my-brain"
      }
    }
  }
}
```

## การทดสอบ

```bash
npm run build
node test/smoke.mjs
```

smoke test 45 ข้อ (13 sections): init / capture / evidence rule / write+manifest / search+privacy / link / resolve / health / T2 approval gate / T1 audit / body-link scanner / nightly / pack provenance

## Tools ทั้ง 13 ตัว

| Tool | หน้าที่ |
|---|---|
| `brain_init` | สร้างโครงสร้าง brain root (idempotent) |
| `brain_capture` | จดด่วนลง `00_Fleeting/` |
| `brain_write_note` | เขียนโน้ตถาวร — **atomic/entity ต้องมี evidence ≥ 1** |
| `brain_update_note` | แก้เฉพาะฟิลด์ที่ส่ง (ห้ามแก้ id/created) |
| `brain_read` | อ่านโน้ต — T1 audit / T2 ต้องมี approval |
| `brain_search` | ค้น — default ไม่คืน T1/T2, T2 ไม่คืนจนกว่าอนุมัติ |
| `brain_link` | ลิงก์สองทิศ + append `links.jsonl` |
| `brain_resolve` | คืน id จาก alias/title |
| `brain_list_packs` | list packs + provenance status |
| `brain_health` | orphans/dead_links/dead_body_links/packs_unverified |
| `brain_home` | Home.md + Today.md (atomic write, T2 ไม่ขึ้น) |
| `brain_nightly` | fleeting queue + Today + health + snapshot |
| `brain_audit` | audit log ล่าสุด N รายการ |

## กฎเหล็ก (enforce ในโค้ด)

- **ไม่มี delete ใดๆ** — "ซ่อน" ได้ด้วย `state: archive` เท่านั้น
- `manifest.jsonl` / `links.jsonl` / `audit.jsonl` เป็น **append-only**
- โน้ต `atomic`/`entity` ต้องมี evidence ≥ 1
- T2 ต้องมี `.kb/approvals/<id>.json` (สร้างด้วยมือเท่านั้น) ก่อนอ่าน
- ทุก mutation ถูกบันทึกลง `audit.jsonl`
- ทุกอย่าง local filesystem — ห้าม network call

## โครงสร้าง brain root

```
<root>/
├── .kb/
│   ├── manifest.jsonl   # metadata โน้ต (append-only)
│   ├── links.jsonl      # ลิงก์ (append-only)
│   ├── aliases.json     # alias → id
│   ├── health.json      # ผล brain_health ล่าสุด
│   ├── audit.jsonl      # log mutation (append-only)
│   ├── packs/           # domain packs (*.yaml)
│   ├── packs.lock.json  # sha256 ที่ล็อกด้วยมือ
│   └── approvals/       # ไฟล์อนุมัติ T2 (สร้างด้วยมือ)
├── 00_Fleeting/
├── 10_Notes/
├── 20_Atlas/
├── 30_Sources/
├── 40_Templates/base/
└── 99_System/snapshots/
```
