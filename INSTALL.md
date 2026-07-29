# INSTALL — Windows layout (Kimi Code + miru_zero)

> ตั้งแต่ v2.1.0 **ไม่ต้องแตก seed zip เอง** — `npm run init` สร้างโครงสมองให้อัตโนมัติที่ `~/.zero/brain` (ตั้ง `ZERO_BRAIN_ROOT` ถ้าอยากใช้ที่อื่น) — env เก่า `CENTRAL_BRAIN_ROOT`/`CENTRAL_BRAIN_ACTOR` ยังใช้ได้ (fallback)

## ขั้นตอน (ง่ายสุด)

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

## ข้อจำกัด

- server เป็น stdio ต่อ client — อย่าสั่งเขียนพร้อมกันจาก 2 client (ไม่มี file lock)
- actor ตอนนี้เป็นแค่ป้ายชื่อใน audit ยังไม่ใช่สิทธิ์ (ดู ROADMAP-v1.3.md)
