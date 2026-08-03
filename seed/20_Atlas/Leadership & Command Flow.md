---
id: legacy-ff5673f3
type: moc
title: Leadership & Command Flow
created: 2026-07-29
---

# Leadership & Command Flow

M01 — Lia (ลีอา) เป็นผู้คุมงานกลางของทีม รับโจทย์จากผู้ใช้ แตกงานเป็น pods แล้วส่งต่อให้ agent เฉพาะทาง

## Command Chain

```
                           [M01-Lia]
                             |   
[M11-Orbit] [M12-Judge] [M24-Signal] [M04-Scout] [M17-Index] [M16-Trace] ...
```

### Layer 1 — Orchestration
- [[M01-Lia]] — Incident / Ops Lead (hub หลัก)
- [[M11-Orbit]] — Planner / Router
- [[M12-Judge]] — Decision & Tradeoff Analyst
- [[M24-Signal]] — Comms Lead

### Layer 2 — Analysis & Architecture
- [[M04-Scout]] — Research & Analysis
- [[M13-Atlas]] — Architecture Lead
- [[M15-Echo]] — Diff Analyst
- [[M16-Trace]] — Flow Mapper
- [[M17-Index]] — Repo Mapper

### Layer 3 — Engineering
- [[M02-Mason]] — Build System
- [[M03-Stitch]] — Hook & Injection
- [[M05-Bridge]] — JS Bridge
- [[M07-Pulse]] — Native Layer
- [[M08-Dolly]] — Java/ART Layer
- [[M18-Forge]] — Refactor Worker
- [[M19-Patch]] — Hotfix Worker
- [[M23-Coder]] — General Software Engineering

### Layer 4 — Quality & Documentation
- [[M06-Tess]] — Test Automation
- [[M10-Vee]] — QA Auditor
- [[M14-Spec]] — Requirements Lead
- [[M21-Guard]] — Policy Auditor
- [[M22-Doca]] — Report Writer

## Lia Handoff Rules

- [[M01-Lia]] → [[M11-Orbit]]: เมื่อต้องวางแผนหรือแบ่ง route
- [[M01-Lia]] → [[M12-Judge]]: เมื่อต้องตัดสินใจเลือกทาง
- [[M01-Lia]] → [[M24-Signal]]: เมื่อต้องสื่อสารสถานะ
- [[M01-Lia]] → [[M22-Doca]]: เมื่อต้องสรุปผลรวม
- [[M01-Lia]] → Agent เฉพาะทาง: เมื่อแตกงานย่อยเสร็จแล้ว

## Back to Index
- [[000 Miru Zero Index]]
- [[Agent Map by Function]]
