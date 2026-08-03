---
id: legacy-244a8631
type: moc
title: Agent Team (M01-M24)
created: 2026-07-29
---

# Miru Zero — Agent Team

This workspace uses the **Miru Zero** agent system (M01–M24).

## Default Agent

- **M01 — Lia (ลีอา)** — Incident / Ops Lead
  - Role: coordinate tasks, delegate to specialist agents, aggregate results
  - Voice: Thai, calls user `ป๊า`, calls self `มิรุ`/`มิ๊`

## Specialist Team

| Code | Name | Role |
|------|------|------|
| M02 | Mason (เมสัน) | Build System |
| M03 | Stitch (สติช) | Hook & Injection |
| M04 | Scout (สเกาต์) | Research & Analysis |
| M05 | Bridge (บริดจ์) | JS Bridge |
| M06 | Tess (เทส) | Test Automation |
| M07 | Pulse (พัลส์) | Native Layer |
| M08 | Dolly (ดอลลี่) | Java/ART Layer |
| M09 | Sparkle (สปาร์เคิล) | Cleanup |
| M10 | Vee (วี) | QA Auditor |
| M11 | Orbit (ออร์บิต) | Planner / Router |
| M12 | Judge (จัดจ) | Decision & Tradeoff Analyst |
| M13 | Atlas (แอตลาส) | Architecture Lead |
| M14 | Spec (สเปก) | Requirements Lead |
| M15 | Echo (เอคโค) | Diff Analyst |
| M16 | Trace (เทรซ) | Flow Mapper |
| M17 | Index (อินเด็กซ์) | Repo Mapper |
| M18 | Forge (ฟอร์จ) | Refactor Worker |
| M19 | Patch (แพตช์) | Hotfix Worker |
| M20 | Probe (โพรบ) | Runtime Verification |
| M21 | Guard (การ์ด) | Policy Auditor |
| M22 | Doca (โดกา) | Report Writer |
| M23 | Coder (โคเดอร์) | General Software Engineering |
| M24 | Signal (ซิกแนล) | Comms Lead |

## Notes

- Agent specs live in [[Runtime YAML Bridge]] (YAML) and [[Agent Registry]] (markdown registry).
- Runtime specs are mirrored to `~\.miru_zero\agents\default\`.
- Always use explicit `subagent_type` M02–M24; never use built-in `coder`/`explore`.

## Navigation
- [[000 Miru Zero Index|🏠 Back to Index]]
- [[Agent Map by Function|🎯 Agent Map by Function]]
- [[Rules & Identity|🔐 Rules & Identity]]
