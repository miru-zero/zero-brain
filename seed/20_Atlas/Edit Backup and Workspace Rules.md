# Edit Backup & Workspace Rules

กฎการแก้ไฟล์และวางไฟล์งานของทุก agent ในระบบ Zero — บังคับตั้งแต่ v2.3.0

## 1) ก่อนแก้/ลบไฟล์ ต้องสำเนาเข้า backup_edit เสมอ

เหมือน VSCode Timeline แต่เก็บในสมอง — ห้ามมีประโยค "ย้อนไม่ได้ เพราะไม่ได้ใช้ git":

```bash
node ~/.zero/mcp/zero-brain/tools/backup-edit.mjs <file...>     # สำเนาก่อนแก้ (ทำทุกครั้ง ไม่ทับกัน)
node ~/.zero/mcp/zero-brain/tools/backup-edit.mjs --list <file> # ดู timeline
node ~/.zero/mcp/zero-brain/tools/backup-edit.mjs --restore <file> [--at <ts>]  # ย้อน (สำเนาปัจจุบันก่อนเสมอ)
```

- เก็บที่ `99_System/backup_edit/<วันที่>/<เวลา>__<path>.bak` — นามสกุล `.bak` เสมอ (จะได้ไม่ปน Obsidian graph)
- ยกเว้น: ไฟล์ที่อยู่ใน brain อยู่แล้ว (brain มี git snapshot รายวัน + audit) และไฟล์ชั่วคราวใน `.zero/tmp/`
- ถ้า repo นั้นมี git อยู่แล้ว **ก็ยังต้องสำเนา** — git คือของทีม, backup_edit คือตาข่ายนิรภัยของ agent

## 2) ไฟล์รัน/log/ของชั่วคราว ห้ามวางรกในโปรเจ็ค

ทุกโปรเจ็คที่ agent ทำงานด้วย ให้มีพื้นที่ส่วนตัว:

```bash
node ~/.zero/mcp/zero-brain/tools/backup-edit.mjs --init-workspace <project-dir>
# สร้าง <project>/.zero/{logs,tmp,out} + .gitignore (git ไม่ track ทั้งโฟลเดอร์)
```

- log รัน, ไฟล์ดึงดิบ, output ชั่วคราว, สคริปต์ใช้ครั้งเดียว → ใส่ `.zero/` เท่านั้น
- ห้ามทิ้งไฟล์พวกนี้กระจายที่ root ของโปรเจ็ค (ตัวอย่างเละ: `M:\Lab\SCB_anywhere`)
- งานสำคัญที่ต้องเก็บถาวร → ย้ายเข้า brain ผ่าน `zero_write_note` ไม่ใช่ทิ้งไว้ในโปรเจ็ค
- `--init-workspace` สร้าง `.zero/ZERO.md` (md ยึดที่โปรเจ็ค) ด้วย — agent ที่มาทำงานทีหลังอ่านไฟล์นี้ก่อน กฎชุดเดียวกันทุกรอบ ไม่ใช่สั่งรอบเดียวจบ; ใส่ id ของ Project Scope ลงใน ZERO.md ให้เชื่อมเข้าสมองได้เลย

## 2.1) โน้ตใหม่ห้ามลอย (Obsidian graph)

กราฟ Obsidian วาดเส้นจาก `[[wikilinks]]` ใน **body** เท่านั้น — links ใน frontmatter (`to:`/`rel:`) กราฟไม่วาด โน้ตจะดูลอยทั้งที่ zero-brain เชื่อมอยู่ (เคสจริง: โน้ต compacted session ลอยเดี่ยว)

- `zero_write_note` / `zero_update_note` / `zero_link` regenerate block `<!-- zero-links:begin --> … <!-- zero-links:end -->` ท้าย body ให้อัตโนมัติ (idempotent) — wikilink ใช้ **ชื่อไฟล์ (stem)** ไม่ใช่ id เพราะ Obsidian resolve ด้วยชื่อไฟล์เท่านั้น
- ห้ามแก้ block นี้เอง (managed — จะถูกคำนวณใหม่ทุกครั้งที่บันทึก)
- โน้ตที่ไม่มี links เลยจะถูกเตือน "ลอย" ตอน write — ใส่ links เข้า MOC/Project Scope อย่างน้อย 1 เส้นทุกใบ
- T2 (เข้ารหัส) ข้าม block นี้ — frontmatter links ยังเป็นหลักฐานการเชื่อมอยู่

## 3) วินัย sub-agent (ตาม logic Miru Zero)

- pod research = **read-only เด็ดขาด** (ห้ามแก้โค้ด ห้ามรันคำสั่งเขียน) — ตัวอย่าง: M16-Trace ไล่ logic, M04-Scout จัดกลุ่ม traffic
- pod writer เท่านั้นที่แตะไฟล์ และต้อง backup ก่อนแก้ตามข้อ 1
- ก่อนรันใหญ่: วางแผน+อ่านครบก่อน แล้วรันทีเดียว (STOP → THINK → RUN ONCE ตาม Token Budget Policy)

## 4) สมองไม่ใช่ถังขยะงาน

- brain = ความจำ + กฎ + backup_edit เท่านั้น
- ห้ามเอาไฟล์งานดิบ/log โปรเจ็คเข้า brain นอกเหนือจาก `99_System/backup_edit/`
