# INSTALL — Windows layout (Kimi Code + miru_zero)

## โครงที่แนะนำ (แยกโค้ดกับเนื้อสมองคนละที่)

```
C:\Users\<user>\central-brain\        ← clone repo นี้ (โค้ดล้วน)
M:\Central_Brain\                     ← เนื้อสมอง (แตกจาก central-brain-pack zip)
```

- ห้ามเอาเนื้อสมองไว้ในโฟลเดอร์ clone (กันเผลอ commit — .gitignore ดักไว้แล้ว แต่แยกกายภาพปลอดภัยกว่า)
- สมอง 1 ใบ ไคลเอนต์หลายตัว: ทุก client ชี้ CENTRAL_BRAIN_ROOT เดียวกัน

## ขั้นตอน

```
1. git clone https://github.com/miru-zero/central-brain.git
2. cd central-brain && npm install && npm run build
3. node test/smoke.mjs      ← ต้องผ่าน 45/45 ก่อนไปต่อ
4. แตก Central_Brain_seed → M:\Central_Brain
5. ตั้ง MCP config (ด้านล่าง) แล้วเรียก brain_health → เห็น 58 notes/0 dead = สำเร็จ
```

## MCP config ต่อ client (แยก ACTOR ของใครของมัน)

Kimi Code:
```json
{
  "mcpServers": {
    "central-brain": {
      "command": "node",
      "args": ["C:\\Users\\<user>\\central-brain\\dist\\index.js"],
      "env": {
        "CENTRAL_BRAIN_ROOT": "M:\\Central_Brain",
        "CENTRAL_BRAIN_ACTOR": "kimi-code"
      }
    }
  }
}
```

miru_zero:
```json
{
  "mcpServers": {
    "central-brain": {
      "command": "node",
      "args": ["C:\\Users\\<user>\\central-brain\\dist\\index.js"],
      "env": {
        "CENTRAL_BRAIN_ROOT": "M:\\Central_Brain",
        "CENTRAL_BRAIN_ACTOR": "miru-zero"
      }
    }
  }
}
```

ทุก mutation/read-T1/block-T2 จะถูกจารึกลง audit.jsonl พร้อมชื่อ actor — ย้อนดูได้ด้วย brain_audit ว่าใครทำอะไร

## ข้อจำกัด

- server เป็น stdio ต่อ client — อย่าสั่งเขียนพร้อมกันจาก 2 client (ไม่มี file lock ใน v1.2)
- actor ตอนนี้เป็นแค่ป้ายชื่อใน audit ยังไม่ใช่สิทธิ์ (ดู ROADMAP-v1.3.md)
