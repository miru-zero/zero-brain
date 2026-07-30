---
title: Token Budget Policy
type: moc
created: 2026-07-30
updated: 2026-07-30
---

# Token Budget Policy — เผาโทเค้นอย่างมีสติ

> กลุ่มระบบ · ศูนย์กลาง: [[Zero]] · บังคับกับทุก agent ในบ้าน (CLI miru, desktop miru, อนาคต)
> ที่มา: ป๊าสั่ง 2026-07-30 หลัง CLI เผา 20% weekly quota กับงาน "แค่ติดตั้ง" 40 นาที

## เข้าใจบิลก่อน (ทำไมโทเค้นหมดเร็ว)

- **ทุกเทิร์น agent ส่งทั้งก้อนใหม่** — system prompt + tool schemas + ประวัติแชททั้งหมด + tool outputs เข้าโมเดลซ้ำทุกเทิร์น → session ยาว = จ่ายทวีคูณ (quadratic) [Bai et al. 2026: history resend + schema resend + handoff คือต้นทุนหลัก ไม่ใช่การคิด]
- **polling loop = เผาเปล่า** — `sleep 290; grep` แต่ละรอบคือ 1 เทิร์นเต็ม = จ่ายทั้ง history โดยไม่ได้งานเพิ่ม (เจอจริงใน CLI session ของป๊า)
- **full-context memory แพง 20 เท่า** — ยัด history ดิบ 26,031 tok/query vs structured memory 1,294 tok (4.97%) [Memori, arXiv 2603.19935]

## กฎเหล็กดีบั๊ก: STOP → THINK → RUN ONCE

เวลาเจอ error **ห้ามเดารันใหม่** — วงจรแก้ทีละนิด→รัน→พัง→รัน คือเตาเผาโทเค้น (ทุกรัน = เทิร์น + history ทั้งก้อน):

1. **STOP** — หยุดรัน ห้ามแตะคำสั่ง
2. **THINK** — วิเคราะห์ root cause จากหลักฐานที่อ่านมาแล้ว (log/code เก่า) ตั้งสมมติฐาน 1-3 ข้อ พร้อมวิธีพิสูจน์ว่าข้อไหนจริง — ถ้าหลักฐานในมือพอตัดสิน ห้ามรันเพิ่ม
3. **RUN ONCE** — ออกแบบ experiment **ตัดสิน** สมมติฐานทุกข้อในรอบเดียว: instrument ครบทุกจุดที่สงสัยใน pass เดียว (batch logging) ไม่ใช่เพิ่ม probe ทีละตัวต่อหนึ่งรัน
4. **FIX ONCE** — แก้ตาม root cause ที่ยืนยันแล้ว ไม่ใช่แก้ตามอาการ แล้ว verify รอบเดียว

> งาน emulator/dynamic analysis รันเป็นของมัน แต่รันทุกครั้งต้อง "decisive" — ถ้ารันแล้วได้ข้อมูลแค่จุดเดียว แปลว่าออกแบบการ instrument ผิด ไม่ใช่ต้องรันเพิ่ม
> (มี `systematic-debugging` skill อยู่ในคลังอยู่แล้ว — ต้องเรียกใช้ ไม่ใช่มีไว้ประดับ)

## กฎ 10 ข้อของบ้าน

1. **ห้าม poll ใน agent loop** — งานต้องรอ ให้เขียนสคริปต์รอเอง รันครั้งเดียว เอาเฉพาะผลสุดท้าย
2. **Script-first** — งาน batch (ย้าย/แก้/เชื่อมหลายไฟล์) เขียนสคริปต์รันจบ ไม่คุยทีละไฟล์
3. **Session สั้น ส่งต่อด้วย boot note** — จบ phase เขียน handoff 4 ช่อง (intent / changes / decisions / next steps) แล้วเปิด session ใหม่ [anchored summarization pattern]
4. **Tool output เบาๆ** — grep/head/tail แทน dump ทั้งไฟล์ อ่านเฉพาะช่วงบรรทัดที่ต้องใช้
5. **หยิบความจำผ่าน zero_search** — เอาเฉพาะที่ต้องใช้ ห้ามวางโน้ตทั้งใบเข้าแชท; เขียนสรุปลงสมอง ไม่แปะ log ดิบ
6. **Subagent สำหรับงานสำรวจใหญ่** — context แยก ผลลัพธ์อย่างเดียวกลับมา (ประหยัด ~40% ใน benchmark)
7. **Plan once, execute many** — วางแผนแพงครั้งเดียว execute ถูกๆ หลายครั้ง [reasoning-execution split]
8. **เลือกโมเดลตามงาน** — งาน mechanical ไม่ใช้โมเดลแรงสุด [RouteLLM: ลดได้ถึง 85%]
9. **Ledger ให้ป๊าเห็น** — งานยาวต้องมีไฟล์/รายการความคืบหน้าเปิดดูได้ตลอด ตอบคำถาม "งานเดินไหม ถึงไหนแล้ว"
10. **วัดผลรายสัปดาห์** — เก็บสถิติ token/งานจาก wire log (ถ้า client มี) ทบทวนเป็นประจำ

## compact/memory ที่งานวิจัยพิสูจน์แล้ว

| เทคนิค | ผลวัด | บ้านเราใช้ยังไง |
|---|---|---|
| Observation masking > LLM summarization | ถูกกว่า 52%, solve rate ดีกว่า [JetBrains 2025] | ตัด tool output เก่าออกก่อนสรุป |
| Compact เฉพาะจบ phase | compact ถี่กลางงาน: turn 4→14, ประหยัดสุทธิแค่ 14% | ห้าม compact กลางงาน |
| Subagent isolation | 9K vs 15K tokens (~40%) | ข้อ 6 |
| Skills progressive disclosure | ~100 tok ตอน boot, เต็ม ~2K ตอนถูกเรียก | ใช้อยู่แล้ว (daimon skills) |
| Self-editing memory (Letta) มีต้นทุนคิดต่อการจำ | ทุก memory op = inference tokens | zero_search/จดสรุปเป็นครั้งคราว ไม่คิดจำทุกเทิร์น |

## Roadmap ปรับ zero-brain จากงานวิจัย

- retrieval ตอนนี้ keyword-only → เพิ่ม multi-strategy (semantic + graph + temporal) แบบ Hindsight
- `zero_read` คืนทั้งใบ → เพิ่มโหมด excerpt หยิบเฉพาะหน้าต่างที่เกี่ยว (per-step retrieval ถูกกว่าทั้ง trajectory)
- Hotcache ต้องเล็กเสมอ — core memory ห้ามบวม (ดู [[Hotcache]] · [[Memory Placement Rules]])
- install/ops ทั้งหมดต้อง zero-token: สคริปต์ล้วน ไม่มี AI ในลูป (ดู `install.ps1` ใน repo)
