# INSTALL — Windows layout (Kimi Code + miru_zero)

> ตั้งแต่ v2.1.0 **ไม่ต้องแตก seed zip เอง** — `npm run init` สร้างโครงสมองให้อัตโนมัติที่ `~/.zero/brain` (ตั้ง `ZERO_BRAIN_ROOT` ถ้าอยากใช้ที่อื่น) — env เก่า `CENTRAL_BRAIN_ROOT`/`CENTRAL_BRAIN_ACTOR` ยังใช้ได้ (fallback)

## ขั้นตอน (ง่ายสุด)

### ทางลัด — คำสั่งเดียว (แนะนำ, ใช้ 0 token)

```powershell
powershell -ExecutionPolicy Bypass -File install.ps1
```

ทำครบ: clone/update → npm install → build → init สมอง → smoke → **ผูก Zero เข้าทุก agent client ตั้งแต่ boot อัตโนมัติ** (`tools/setup-agents.ps1`: codex / kimi-claw / kimi-code / daimon — idempotent, backup ทุกไฟล์) — **ไม่ต้องมี AI ในลูป** (งาน install/ops ต้อง zero-token ตาม Token Budget Policy)

### ทำมือทีละขั้น

```
1. git clone https://github.com/miru-zero/zero-brain.git ~/.zero/mcp/zero-brain
2. cd ~/.zero/mcp/zero-brain && npm install && npm run build
3. npm run init            ← สร้างโครงสมองที่ ~/.zero/brain อัตโนมัติ
4. node test/smoke.mjs     ← ต้องผ่าน 68/68 (17 sections) ก่อนไปต่อ
5. ตั้ง MCP config (ด้านล่าง) แล้วเรียก zero_health = สำเร็จ
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

แบบ default (สมองอยู่ ~/.zero/brain ทั้งคู่):

```json
{
  "mcpServers": {
    "zero-brain": {
      "command": "node",
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
      "command": "node",
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

`tools/setup-agents.ps1` ทำให้ client ที่มีอยู่บนเครื่องเห็น Zero ตั้งแต่ตื่น (รันซ้ำได้ ปลอดภัย — marker `ZERO:BEGIN/END` + backup `.bak-zero-setup-<เวลา>` ทุกไฟล์ที่แตะ):

| client | สิ่งที่เติม | ไฟล์ |
|---|---|---|
| Codex | `[mcp_servers.zero-brain]` (ACTOR=codex) + ZERO block | `~/.codex/config.toml`, `~/.codex/AGENTS.md` |
| Kimi Claw (OpenClaw) | `mcp.servers.zero-brain` (ACTOR=kimi-claw) + ZERO block | `~/.kimi/kimi-claw/openclaw.json`, `~/.kimi_openclaw/workspace/AGENTS.md` |
| Kimi Code | `mcpServers.zero-brain` (ACTOR=kimi-code) + ZERO block + สกิลที่ขาด | `~/.kimi-code/mcp.json`, `~/.kimi-code/AGENTS.md`, `~/.kimi-code/skills/` |
| Kimi Work (daimon) | สกิล `/zero` + `zero-brain-*` ที่ขาด | `~/.zero/share/daimon-share/daimon/skills/` |

หลังรัน: restart client แต่ละตัว (codex / gateway kimi-claw / kimi-code / Kimi Work) แล้วเรียก `zero_health` ยืนยัน

Obsidian: เปิด vault ที่ `~/.zero/brain` **เท่านั้น** — ห้ามเปิด `~/.zero` ทั้งโซน (ไฟล์ runtime ของ daimon-share จะหลุดเข้ากราฟเป็นโหนดลอยนับพัน ดู Common Mistakes ใน skills/zero)

## ข้อจำกัด

- server เป็น stdio ต่อ client — อย่าสั่งเขียนพร้อมกันจาก 2 client (ไม่มี file lock)
- actor ตอนนี้เป็นแค่ป้ายชื่อใน audit ยังไม่ใช่สิทธิ์ (ดู ROADMAP-v1.3.md)
