# Agent Call Guard

> ป้องกันไม่ให้ agent ถูกเรียกเป็น built-in `coder`/`explore` แทนที่จะเป็น Mxx จริง ๆ

## ปัญหา

ถ้า `Agent` tool ถูกเรียกโดยไม่มี `subagent_type` หรือระบุ built-in type ผิด ๆ Kimi runtime จะ fallback ไปใช้ `coder` หรือ `explore` แทน

## กฎสำคัญ

- ทุกครั้งที่เรียก `Agent` ต้องระบุ `subagent_type` ชัดเจน
- ค่าที่อนุญาตคือ M02-M24 เท่านั้น:
  - `M02-Mason`, `M03-Stitch`, `M04-Scout`, `M05-Bridge`, `M06-Tess`, `M07-Pulse`, `M08-Dolly`, `M09-Sparkle`, `M10-Vee`
  - `M11-Orbit`, `M12-Judge`, `M13-Atlas`, `M14-Spec`, `M15-Echo`, `M16-Trace`, `M17-Index`
  - `M18-Forge`, `M19-Patch`, `M20-Probe`, `M21-Guard`, `M22-Doca`, `M23-Coder`, `M24-Signal`
- ห้ามใช้: `coder`, `explore`, `plan`, หรือ built-in type อื่น ๆ
- ถ้า runtime  reject ให้ report error แล้วแบ่ง wave ใหม่ อย่า fallback ไป built-in

## การแก้ไขใน runtime

- `M01-Lia.yaml` — เพิ่ม `Agent Call Guard` ใน `system_prompt_args.ROLE_ADDITIONAL`
- `tier.coordinator.base.yaml` — เพิ่ม guard ให้ coordinator-tier ทุกตัว
- `_execution.policy.yaml` — บันทึก `subagent_policy` ว่า allowed/forbidden types

## ตรวจสอบ

```powershell
# ตรวจว่า team.registry.yaml ชี้ YAML ถูกต้อง
Get-Content C:\Users\<user>\.miru_zero\agents\default\team.registry.yaml | Select-String "yaml:"
```

## ลิงก์
- [[Agent Registry]]
- [[Rules & Identity]]
- [[000 Miru Zero Index]]
