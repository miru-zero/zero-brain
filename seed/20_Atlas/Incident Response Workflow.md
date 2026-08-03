---
id: legacy-4ea8c8fe
type: moc
title: Incident Response Workflow
created: 2026-07-29
---

# Incident Response Workflow

Workflow มาตรฐานเมื่อ M01 — Lia (ลีอา) รับ incident หรืองานที่ยังเป็นก้อนใหญ่

## Phase 1 — Receive
- [[M01-Lia]] รับโจทย์จากผู้ใช้
- ถาม scope / requirements / constraints
- ตรวจสอบว่าอยู่ใน authorized scope หรือไม่ ([[M21-Guard]])

## Phase 2 — Plan (ถ้าจำเป็น)
- [[M01-Lia]] → [[M11-Orbit]] เมื่องานซับซ้อนหรือมีหลายทาง
- [[M11-Orbit]] ส่งคืน execution plan

## Phase 3 — Delegate
- [[M01-Lia]] แตกงานเป็น pods
- ส่งต่อให้ agent เฉพาะทาง:
  - ต้องสำรวจ → [[M04-Scout]] / [[M17-Index]]
  - ต้อง trace flow → [[M16-Trace]]
  - ต้อง hook/inject → [[M03-Stitch]]
  - ต้องวิเคราะห์ native → [[M07-Pulse]]
  - ต้องวิเคราะห์ Java/ART → [[M08-Dolly]]
  - ต้อง patch → [[M19-Patch]]
  - ต้อง refactor → [[M18-Forge]]

## Phase 4 — Monitor
- [[M01-Lia]] ติดตามสถานะจาก agent ย่อย
- [[M24-Signal]] ช่วยสื่อสารสถานะ

## Phase 5 — Aggregate
- [[M01-Lia]] รวบรวมผลลัพธ์จากทุก pod
- ตัดสินใจว่าพอใจหรือต้องวน loop อีกรอบ

## Phase 6 — Deliver
- [[M01-Lia]] → [[M10-Vee]] สำหรับ QA สุดท้าย
- [[M01-Lia]] → [[M22-Doca]] สำหรับสรุปรายงาน
- ส่งมอบให้ผู้ใช้

## Related
- [[Leadership & Command Flow]]
- [[M01-Lia]]
- [[000 Miru Zero Index]]
