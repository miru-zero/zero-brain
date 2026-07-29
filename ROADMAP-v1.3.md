# ROADMAP v1.3 — การตัดสินใจออกแบบ (บันทึก 2026-07-29)

## หลักการถาวรที่ตั้งใหม่

### 1. Trigger-based access
ไม่มีทริกเกอร์ = ไม่อ่าน — server ไม่มี background loop/startup scan; ทุกการอ่านเกิดใน tool call ที่ถูกเรียกเท่านั้น (brain_read/search/home/nightly) — ปฏิเสธ ambient hooks แบบ agentmemory โดยตั้งใจ

### 2. Env minimization (พิสูจน์ด้วย grep)
ทั้งโค้ดอ่าน env แค่ 2 ตัว: `CENTRAL_BRAIN_ROOT`, `CENTRAL_BRAIN_ACTOR` — ไม่แตะ env อื่น ไม่อ่าน env ของ client อื่น

### 3. Actor แยกของใครของมัน
แต่ละ client มี ACTOR id ของตัวเอง จารึกทุกการกระทำ — ตอนนี้เป็นป้ายชื่อ (audit) ยังไม่ใช่สิทธิ์

## งานที่เข้าคิว v1.3

1. **brain_recall** (ดีไซน์ครบแล้ว — แยกไฟล์ใน brain_drafts) คัดลอก logic จาก rohitg00/agentmemory: 4-tier map ลงโครงเดิม, dedup window, ranking decay (ไม่ลบ), token budget ≤10 บรรทัด — ไม่เอา LLM compression ผ่าน API, ไม่เอา ambient hooks, ไม่เอา external engine
2. **Actor policy** — ตารางสิทธิ์ต่อ actor ต่อ tier ใน .kb/ (เช่น miru-cloud ห้ามอ่าน T1) ขยายจาก ACTOR ที่มีอยู่
3. **File lock** — กันเขียนชนกันเมื่อหลาย client ใช้พร้อมกัน (ทำเมื่อจำเป็นจริง)
4. **brain_audit รับ query param** — ค้น keyword ใน log
5. แยก system.md 39KB → MOC + 8 atomic notes (split map พร้อมแล้ว รอป๊าเซ็น + เลือก identity version)

## เทสที่ต้องมีต่อจากนี้
- recall เจอ action เก่าใน audit / เจอโน้ตเกี่ยวข้อง / dedup / ≤10 บรรทัด / T2 ไม่หลุด
- actor policy: actor ที่ไม่มีสิทธิ์อ่าน T1 ต้องโดนบล็อก + audit
