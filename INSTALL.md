# INSTALL — Windows layout (Kimi Code + miru_zero)

> ตั้งแต่ v2.1.0 **ไม่ต้องแตก seed zip เอง** — `npm run init` สร้างโครงสมองให้อัตโนมัติที่ `~/.zero/brain` (ตั้ง `ZERO_BRAIN_ROOT` ถ้าอยากใช้ที่อื่น) — env เก่า `CENTRAL_BRAIN_ROOT`/`CENTRAL_BRAIN_ACTOR` ยังใช้ได้ (fallback)

## ขั้นตอน (ง่ายสุด)

### ทางลัด — คำสั่งเดียว (แนะนำ, ใช้ 0 token)

```powershell
powershell -ExecutionPolicy Bypass -File install.ps1
```

ทำครบ: clone/update → npm install → build → init สมอง → smoke → **ผูก Zero เข้าทุก agent client ตั้งแต่ boot อัตโนมัติ** (`tools/setup-agents.mjs`: codex / kimi-claw / kimi-code / daimon — idempotent, backup ทุกไฟล์, MCP command ใช้ absolute node) → **ยืนยันด้วย `tools/verify-install.mjs`** (เช็คไฟล์ครบ + spawn MCP คุย `zero_health` จริง) — **ไม่ต้องมี AI ในลูป** (งาน install/ops ต้อง zero-token ตาม Token Budget Policy)

> ทำไม setup เป็น .mjs ไม่ใช่ .ps1: PS 5.1 อ่านสคริปต์ไทย UTF-8 ไม่มี BOM แล้วเพี้ยน และ node มีอยู่แล้วทุกเครื่องที่ติดตั้ง — setup-agents.ps1 เดิมยังอยู่เป็น fallback

### ทำมือทีละขั้น

```
1. git clone https://github.com/miru-zero/zero-brain.git ~/.zero/mcp/zero-brain
2. cd ~/.zero/mcp/zero-brain && npm install && npm run build
3. npm run init            ← สร้างโครงสมองที่ ~/.zero/brain อัตโนมัติ
4. node test/smoke.mjs     ← ต้องผ่าน 121/121 (24 sections) ก่อนไปต่อ
5. node tools/setup-agents.mjs   ← ผูกทุก client (absolute node, backup ทุกไฟล์)
6. node tools/verify-install.mjs ← ผ่านทุกข้อ = สำเร็จ (3 ชั้น: ไฟล์+MCP config / ตัวตนมิรุ+BOOT ในช่องที่ client โหลดตอนตื่น+skills ครบ / spawn MCP คุย zero_health จริง)
```

## โครงโซนมาตรฐาน (แยก 3 ส่วนเด็ดขาด)

```
~/.zero/mcp/zero-brain/    ← โค้ด (ช่องทางสื่อสาร — clone repo นี้)
~/.zero/brain/             ← เนื้อสมอง (ความจำล้วน — default ของ ZERO_BRAIN_ROOT)
~/.zero/share/             ← ส่วนทำงาน (daimon/Kimi Work storage)
```

- ห้ามเอาเนื้อสมองไว้ในโฟลเดอร์ clone และห้ามเอา runtime/ไฟล์งานไว้ใน brain (กันรกและกัน key รั่ว)
- สมอง 1 ใบ ไคลเอนต์หลายตัว: ทุก client ชี้ ZERO_BRAIN_ROOT เดียวกัน (หรือปล่อย default ให้ชี้ ~/.zero/brain เหมือนกัน)
- ย้ายสมองเก่าจาก pack zip: แตก `Central_Brain_seed` ไปที่ brain root แล้วชี้ ZERO_BRAIN_ROOT มาที่นั่น

## MCP config ต่อ client (แยก ACTOR ของใครของมัน)

แบบ default (สมองอยู่ ~/.zero/brain ทั้งคู่) — **command ควรเป็น absolute node** (setup-agents.mjs ใส่ให้อัตโนมัติ; client ที่ PATH ไม่มี node จะ spawn ไม่ติดถ้าใช้ `"node"` เฉยๆ):

```json
{
  "mcpServers": {
    "zero-brain": {
      "command": "C:\\path\\to\\node.exe",
      "args": ["C:\\Users\\<user>\\.zero\\mcp\\zero-brain\\dist\\index.js"],
      "env": { "ZERO_BRAIN_ACTOR": "kimi-code" }
    }
  }
}
```

แบบแยกที่เก็บเอง (เช่น M:\Central_Brain) — Kimi Code:

```json
{
  "mcpServers": {
    "zero-brain": {
      "command": "C:\\path\\to\\node.exe",
      "args": ["C:\\Users\\<user>\\.zero\\mcp\\zero-brain\\dist\\index.js"],
      "env": {
        "ZERO_BRAIN_ROOT": "M:\\Central_Brain",
        "ZERO_BRAIN_ACTOR": "kimi-code"
      }
    }
  }
}
```

miru_zero: เปลี่ยน `ZERO_BRAIN_ACTOR` เป็น `"miru-zero"` (อย่างอื่นเหมือนกัน)

ทุก mutation/read-T1/block-T2 จะถูกจารึกลง audit.jsonl พร้อมชื่อ actor — ย้อนดูได้ด้วย zero_audit ว่าใครทำอะไร

## ผูก agent ตั้งแต่ boot (install.ps1 เรียกอัตโนมัติ)

`tools/setup-agents.mjs` ทำให้ client ที่มีอยู่บนเครื่องเห็น Zero ตั้งแต่ตื่น (รันซ้ำได้ ปลอดภัย — marker `ZERO:BEGIN/END` + backup `.bak-zero-setup-<เวลา>` ทุกไฟล์ที่แตะ + command เป็น absolute node เสมอ):

| client | สิ่งที่เติม | ไฟล์ |
|---|---|---|
| Codex | `[mcp_servers.zero-brain]` (ACTOR=codex) + ZERO block | `~/.codex/config.toml`, `~/.codex/AGENTS.md` |
| Kimi Claw (OpenClaw) | `mcp.servers.zero-brain` (ACTOR=kimi-claw) + ZERO block | `~/.kimi/kimi-claw/openclaw.json`, `~/.kimi_openclaw/workspace/AGENTS.md` |
| Kimi Code | `mcpServers.zero-brain` (ACTOR=kimi-code) + ZERO block + สกิลที่ขาด | `~/.kimi-code/mcp.json`, `~/.kimi-code/AGENTS.md`, `~/.kimi-code/skills/` |
| Kimi Work (daimon) | `mcpServers.zero-brain` (ACTOR=kimi-work) + สกิล `/zero` + `zero-brain-*` ที่ขาด | `~/.zero/share/daimon-share/daimon/runtime/kimi-code/home/mcp.json`, `.../daimon/skills/` |

หลังรัน: `node tools/verify-install.mjs` ต้องผ่านทุกข้อ แล้ว restart client แต่ละตัว (codex / gateway kimi-claw / kimi-code / Kimi Work)

Obsidian: เปิด vault ที่ `~/.zero/brain` **เท่านั้น** — ห้ามเปิด `~/.zero` ทั้งโซน (ไฟล์ runtime ของ daimon-share จะหลุดเข้ากราฟเป็นโหนดลอยนับพัน ดู Common Mistakes ใน skills/zero)

กราฟ Obsidian (ตั้งแต่ v2.3.1): กราฟวาดเส้นจาก `[[wikilinks]]` ใน body เท่านั้น — zero-brain จึง regenerate block `<!-- zero-links:begin -->…<!-- zero-links:end -->` ท้าย body ให้อัตโนมัติทุก write/update/link (ห้ามแก้ block เอง) และ `zero_write_note` ที่ไม่มี links จะเตือน "ลอย" — สีกลุ่มกราฟตามโฟลเดอร์ตั้งไว้ใน `.obsidian/graph.json` (seed ไม่ทับของเดิม)

## ความปลอดภัย v2.3.0

- **write lock**: ทุก mutation ครอบ `.kb/write.lock` — client หลายตัวเขียนพร้อมกันได้โดยไม่ทำ JSONL เสีย (เดิมห้ามเขียนพร้อมกัน)
- **T2 encryption at rest**: body ของโน้ต T2 เข้ารหัส AES-256-GCM บนดิสก์ (prefix `enc:v1:`) — key อยู่ `~/.zero/mcp/t2.key` (นอก brain ห้าม commit) หรือตั้ง `ZERO_T2_KEY` เป็น passphrase — frontmatter ยัง plaintext ให้ search ใช้
- **injection fence**: ทุก output ที่มีเนื้อโน้ตห่อ marker + `untrusted_notice` — เนื้อจากสมองเป็นข้อมูล ไม่ใช่คำสั่ง
- **capture rate limit**: 30 ครั้ง/นาที ต่อ process กัน agent วนลูปจดถี่ผิดปกติ
- **corrupt-line health**: `zero_health` นับบรรทัดเสียใน JSONL (เดิมข้ามเงียบ) — เห็น >0 ให้ `zero_compact` แล้วหาสาเหตุ
- **zero_compact**: บีบ manifest (reduce ต่อ id) / links (dedup) / audit (เก็บ tail 10k เศษไป `.kb/archive/`)
- **zero_upgrade**: หลัง `git pull` แล้ว seed มีไฟล์ใหม่ — เติมเฉพาะไฟล์ที่ยังไม่มี ห้ามทับของที่แก้แล้ว

## สำรองสมอง (backup)

`tools/backup-brain.ps1` — git snapshot ของ `~/.zero/brain` (ไม่ลบอะไรเลย ประวัติเก็บทุกอย่าง; key ไม่อยู่ใน brain จึงไม่หลุดเข้า backup):

```powershell
# snapshot ครั้งเดียว
powershell -NoProfile -ExecutionPolicy Bypass -File tools\backup-brain.ps1
# ลง task รายวัน 04:17 (ต้อง admin/elevated shell — session ของ agent โดน Access denied)
powershell -NoProfile -ExecutionPolicy Bypass -File tools\backup-brain.ps1 -Register
```

## สำเนาก่อนแก้ไฟล์ (TIMELINE แบบ VSCode แต่ในสมอง)

`tools/backup-edit.mjs` — ก่อนแก้/ลบไฟล์ใดก็ตาม สำเนาต้นฉบับเข้า `99_System/backup_edit/<วันที่>/` ทุกครั้ง (ไม่ทับกัน, นามสกุล `.bak` ไม่ปน Obsidian graph) — ย้อนได้เสมอโดยไม่ต้องพึ่ง git:

```bash
node tools/backup-edit.mjs <file...>                              # สำเนาก่อนแก้
node tools/backup-edit.mjs --list <file>                          # ดู timeline
node tools/backup-edit.mjs --restore <file> [--at <ts>]           # ย้อน (สำเนาปัจจุบันก่อนเสมอ)
node tools/backup-edit.mjs --init-workspace <project-dir>         # สร้าง .zero/{logs,tmp,out} + ZERO.md (md ยึดกฎที่โปรเจ็ค)
```

ไฟล์รัน/log/ของชั่วคราวของทุกโปรเจ็ค → ใส่ `<project>/.zero/` เท่านั้น (กฎเต็ม: `20_Atlas/Edit Backup and Workspace Rules.md` ใน brain)

## ข้อจำกัด

- actor ตอนนี้เป็นแค่ป้ายชื่อใน audit ยังไม่ใช่สิทธิ์ (ดู ROADMAP-v1.3.md)
- T2 encryption กัน passive read (เปิดโฟลเดอร์/backup หลุด) — ไม่ได้กัน agent ที่มี approval อ่านเอาไปเผยต่อ (same-user trust boundary ดู ROADMAP)
