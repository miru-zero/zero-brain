# Runtime YAML Bridge

สะพานเชื่อมระหว่าง **agent markdown notes** ใน vault กับ **runtime YAML specs** ที่ `.miru_zero/agents/default/`

> YAML specs เป็น runtime definitions ไม่ควรถูก index หรือ render ใน Obsidian graph โดยตรง แต่ note นี้ช่วยให้รู้ว่า agent ตัวไหนอ้างอิง runtime spec ไหน

## Agent → YAML Mapping

| Agent | Markdown Note | Runtime YAML |
|---|---|---|
| M01-Lia | [[M01-Lia]] | `.miru_zero/agents/default/M01-Lia.yaml` |
| M02-Mason | [[M02-Mason]] | `.miru_zero/agents/default/M02-Mason.yaml` |
| M03-Stitch | [[M03-Stitch]] | `.miru_zero/agents/default/M03-Stitch.yaml` |
| M04-Scout | [[M04-Scout]] | `.miru_zero/agents/default/M04-Scout.yaml` |
| M05-Bridge | [[M05-Bridge]] | `.miru_zero/agents/default/M05-Bridge.yaml` |
| M06-Tess | [[M06-Tess]] | `.miru_zero/agents/default/M06-Tess.yaml` |
| M07-Pulse | [[M07-Pulse]] | `.miru_zero/agents/default/M07-Pulse.yaml` |
| M08-Dolly | [[M08-Dolly]] | `.miru_zero/agents/default/M08-Dolly.yaml` |
| M09-Sparkle | [[M09-Sparkle]] | `.miru_zero/agents/default/M09-Sparkle.yaml` |
| M10-Vee | [[M10-Vee]] | `.miru_zero/agents/default/M10-Vee.yaml` |
| M11-Orbit | [[M11-Orbit]] | `.miru_zero/agents/default/M11-Orbit.yaml` |
| M12-Judge | [[M12-Judge]] | `.miru_zero/agents/default/M12-Judge.yaml` |
| M13-Atlas | [[M13-Atlas]] | `.miru_zero/agents/default/M13-Atlas.yaml` |
| M14-Spec | [[M14-Spec]] | `.miru_zero/agents/default/M14-Spec.yaml` |
| M15-Echo | [[M15-Echo]] | `.miru_zero/agents/default/M15-Echo.yaml` |
| M16-Trace | [[M16-Trace]] | `.miru_zero/agents/default/M16-Trace.yaml` |
| M17-Index | [[M17-Index]] | `.miru_zero/agents/default/M17-Index.yaml` |
| M18-Forge | [[M18-Forge]] | `.miru_zero/agents/default/M18-Forge.yaml` |
| M19-Patch | [[M19-Patch]] | `.miru_zero/agents/default/M19-Patch.yaml` |
| M20-Probe | [[M20-Probe]] | `.miru_zero/agents/default/M20-Probe.yaml` |
| M21-Guard | [[M21-Guard]] | `.miru_zero/agents/default/M21-Guard.yaml` |
| M22-Doca | [[M22-Doca]] | `.miru_zero/agents/default/M22-Doca.yaml` |
| M23-Coder | [[M23-Coder]] | `.miru_zero/agents/default/M23-Coder.yaml` |
| M24-Signal | [[M24-Signal]] | `.miru_zero/agents/default/M24-Signal.yaml` |

## Shared Runtime Files

| File | Purpose |
|---|---|
| `.miru_zero/agents/default/agent.yaml` | Global agent config |
| `.miru_zero/agents/default/routing.rules.yaml` | Routing rules |
| `.miru_zero/agents/default/team.registry.yaml` | Team registry |
| `.miru_zero/agents/default/tier.coordinator.base.yaml` | Base coordinator tier |
| `.miru_zero/agents/default/worker.base.yaml` | Base worker spec |
| `.miru_zero/agents/default/_execution.policy.yaml` | Execution policy |

## Back to Index
- [[000 Miru Zero Index]]
- [[Agent Registry]]
