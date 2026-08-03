---
id: sysref-a6702213
type: moc
title: Brain Operating Model
created: 2026-07-29
---

# Brain Operating Model — วงจรชีวิตของความรู้ในสมองใบนี้

## ภาพรวม

```
จดด่วน → จัดประเภท → เชื่อมโยง → ทบทวน → สุขภาพดี
capture   classify    link      nightly   health
```

ความรู้ทุกชิ้นเริ่มที่ `00_Fleeting/` แล้วไหลเข้าที่ถาวรเมื่อได้รับการจัดการ — ไม่มีอะไรถูกลบ มีแค่ "ถูกจัดที่" หรือ "ยังไม่ได้จัดที่"

## ขั้นตอน

### 1. Capture (จดด่วน)
- tool: `zero_capture` → ลง `00_Fleeting/`
- เบาที่สุด: ไม่ validate, ไม่ต้องมี evidence — แค่กันหลงลืม
- กติกา: fleeting ไม่ใช่บ้านถาวร — ต้องถูกจัดการภายใน 7 วัน

### 2. Classify (จัดประเภท)
- tool: `zero_write_note` (สร้างใหม่) หรือ `zero_update_note` (เลื่อน fleeting ขึ้นเป็นโน้ตถาวร)
- เลือก type ตาม `20_Atlas/Memory Placement Rules.md`
- atomic/entity บังคับ evidence ≥ 1 — ไม่มีหลักฐาน = ยังเป็น fleeting

### 3. Link (เชื่อมโยง)
- tool: `zero_link` / ใส่ `[[wikilink]]` ใน body
- โน้ตที่ไม่มีใครชี้มาหา = orphan → จะโดน `zero_health` จับ

### 4. Nightly (ทบทวนปิดวัน)
- tool: `zero_nightly` — รีเฟรช Today.md, คืน fleeting queue ค้าง, snapshot ลง `99_System/snapshots/`
- เช้าถัดไปเริ่มจาก `zero_home`

### 5. Health (ตรวจสุขภาพ)
- tool: `zero_health` — orphans / dead links / dead body links / packs unverified
- ผลเต็มอยู่ที่ `.kb/health.json` (response ของ tool เป็นสรุปเพื่อประหยัดโทเค็น)

## Privacy tiers

| Tier | ความหมาย | พฤติกรรม |
|---|---|---|
| T0 | สาธารณะในเครื่อง | ค้นเจอปกติ |
| T1 | ส่วนตัว | ค้นไม่เจอโดย default (`include_private` จะถูก audit) |
| T2 | ความลับ | บล็อกทุกทางจนกว่าเจ้าของอนุมัติด้วยมือ (`.kb/approvals/`) |
