# Skills — ส่งให้ AI ติดตั้งได้เลย

โฟลเดอร์นี้เก็บ skill ของระบบ Zero_Brain ในรูปแบบ `SKILL.md` มาตรฐาน (frontmatter `name` + `description`) ใช้ได้กับ Kimi Work, Claude Code, และ agent ที่รองรับ skills

## วิธีติดตั้ง

### แบบที่ 1 — โยนให้ AI ทำให้ (แนะนำ)

ส่งไฟล์ `SKILL.md` ให้ AI ของคุณแล้วพิมพ์ประมาณนี้:

> ติดตั้ง skill นี้ให้หน่อย — สร้างเป็น skill ในเครื่องฉัน ชื่อตาม frontmatter

AI จะสร้างโฟลเดอร์ skill ในตำแหน่งที่ runtime ของมันใช้ให้อัตโนมัติ

### แบบที่ 2 — วางเองด้วยมือ

| Runtime | วางโฟลเดอร์ skill ไว้ที่ |
|---|---|
| Kimi Work (daimon) | `%APPDATA%\kimi-desktop\daimon-share\daimon\skills\<skill-name>\SKILL.md` |
| Claude Code | `~/.claude/skills/<skill-name>/SKILL.md` |
| อื่นๆ | ดู docs ของ runtime นั้น — โครงสร้างเดียวกัน: `<skill-name>/SKILL.md` |

## Skills ที่มี

| Skill | หน้าที่ |
|---|---|
| [`zero-brain-memory`](./zero-brain-memory/SKILL.md) | บังคับกฎการวางโน้ตของ Zero_Brain vault — auto-activate เมื่อเจอ path `Zero_Brain` หรือคำว่า "memory", "vault", "focus" ฯลฯ |

## ข้อกำหนด

- `zero-brain-memory` อ้างอิง env `%ZERO_BRAIN_PATH%` — ตั้งให้ชี้ไปที่ vault จริงก่อนใช้ (เช่น `M:\Zero_Brain`)
- skill ไม่ได้แจก vault มาด้วย — vault เป็นของแต่ละเครื่อง (ดู repo [zero-brain](https://github.com/miru-zero/zero-brain) สำหรับ MCP server ที่ใช้งานร่วมกัน — คนละตัวกับ skill `zero-brain-memory` ในโฟลเดอร์นี้)
