# tools/ — สคริปต์บำรุงรักษาสมอง

สคริปต์ maintenance สำหรับ vault (`ZERO_BRAIN_ROOT`, default `~/.zero/brain`) — รันด้วย `node tools/<script>.mjs`
⚠️ สคริปต์เหล่านี้แก้ไฟล์ใน vault ตรงๆ — รันตามลำดับที่เข้าใจผล และเช็ค `scan-floaters.mjs` หลังทุกครั้ง

| สคริปต์ | หน้าที่ | เมื่อไหร่ใช้ |
|---|---|---|
| `import-legacy.mjs` | ย้ายโน้ตจาก vault เก่าเข้า brain + ลง manifest (`legacy-*`, T0) | ครั้งเดียวตอนย้ายเข้า |
| `fix-linkage.mjs` | สร้าง/เขียนใหม่: Legacy Index (ลิงก์ด้วย filename stem), Skill Index, `Zero.md` hub | หลัง import หรือโครงสร้างพัง |
| `fix-path-links.mjs` | ตัด path เก่าใน wikilink (`[[01 Projects/X]]` → `[[X]]`) ให้ resolve ด้วยชื่อไฟล์ | หลังย้ายโฟลเดอร์โน้ต |
| `link-skills.mjs` | สแกนสกิลทั้งหมด (daimon/plugin) → stub ต่อสกิล + hub 4 กลุ่ม (`SKILL：Hack/Zero/Daimon/Plugin`) หมวดย่อย + ลิงก์ถึงตัวจริง | ติดตั้ง/ลบสกิล |
| `fix-orphans.mjs` | นับ inbound ทั้ง vault → สร้าง Template Index + เดินสายโน้ตลอย | หลังเพิ่มไฟล์จำนวนมาก |
| `rehash-manifest.mjs` | re-hash sha256 ทุกไฟล์ลง `.kb/manifest.jsonl` | หลังแก้ไฟล์นอก MCP ทุกครั้ง |
| `scan-floaters.mjs` | จำลอง Obsidian resolution (suffix/shortest-path) → รายงาน orphan + ghost แยกตาม vault view | **verify หลังทุกสคริปต์** |

## กฎเหล็กที่สคริปต์พวกนี้บังคับ

1. **ทุกโน้ตต้องมี inbound link ≥ 1** — node ลอย = ยังไม่ sync เข้าระบบ (ดู [[Zero]])
2. **ชื่อไฟล์ห้ามซ้ำ** — Obsidian resolve stem link ไปตัวเดียว ตัวที่เหลือลอย (เคยเจ็บกับ `AGENTS.md` 2 ตัว → ต้อง rename ให้ unique)
3. **ลิงก์ด้วย filename stem** ไม่ใช่ frontmatter title — Obsidian resolve ด้วยชื่อไฟล์
4. แก้ไฟล์นอก MCP → ต้อง `rehash-manifest.mjs` ทุกครั้ง ไม่งั้น zero_check ฟ้อง drift
