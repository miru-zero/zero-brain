# AGENTS.md — กฎสำหรับ agent ที่ใช้สมองนี้

> อ่านก่อนใช้ brain ทุกครั้ง — ไฟล์นี้คือสัญญาระหว่างมนุษย์กับ agent

## ตัวตน

- สมองนี้คือ **Zero Brain** — local filesystem ล้วน ไม่มี network call
- ทุกการกระทำผ่าน MCP tools `zero_*` เท่านั้น ห้ามแก้ไฟล์ใน brain root ตรงๆ (ยกเว้นเจ้าของสั่ง)
- ทุก client มีชื่อ actor ของตัวเอง (`ZERO_BRAIN_ACTOR`) — ทุก mutation ถูกจารึกลง `audit.jsonl` พร้อมชื่อ

## วงจรการใช้งาน

1. **ก่อนเริ่มงาน** — ค้นก่อนเสมอ: `zero_search` / `zero_resolve` ว่าเคยรู้/เคยทำเรื่องนี้แล้วหรือยัง
2. **จดด่วนระหว่างทาง** — `zero_capture` (เบาที่สุด ไม่ต้องคิดโครง)
3. **เขียนความรู้ถาวร** — `zero_write_note` (atomic/entity ต้องมี evidence ≥ 1)
4. **เช้า** — `zero_home` ดู Today · **ก่อนนอน** — `zero_nightly` ปิดวงจร
5. **สุขภาพสมอง** — `zero_health` เป็นครั้งคราว (orphans/dead links/packs)

## กฎเหล็ก (server enforce ในโค้ด)

- **ไม่มี delete เด็ดขาด** — ซ่อนได้ด้วย `state: archive` เท่านั้น
- `manifest.jsonl` / `links.jsonl` / `audit.jsonl` เป็น append-only
- โน้ต `atomic` / `entity` ไม่มี evidence → server ปฏิเสธ
- **T1** อ่านได้แต่ถูก audit ทุกครั้ง · **T2** บล็อกจนกว่าเจ้าของสร้าง `.kb/approvals/<id>.json` ด้วยมือ — agent อนุมัติตัวเองไม่ได้
- ห้ามเขียน credentials/tokens/PII ลงสมอง — ถ้าจำเป็นต้องอ้าง ให้อ้างตำแหน่ง ไม่ใช่ค่า

## มารยาท

- โน้ตใหม่ทุกใบควรมี inbound link จากโน้ตอื่นหรือ index อย่างน้อย 1 เส้น (`zero_link`)
- ไม่แน่ใจว่าควรอยู่หมวดไหน → ดู `20_Atlas/Memory Placement Rules.md` แล้วยังไม่ชัวร์ค่อยถามเจ้าของ
- เจอโน้ตขัดแย้งกัน → อย่าลบ/แก้เอง ให้ link เชื่อมแล้วรายงานเจ้าของ
- งบโทเค้น: อ่าน `20_Atlas/Token Budget Policy.md` ก่อนงานดีบั๊ก/รันยาว — STOP → THINK → RUN ONCE ห้าม poll loop
