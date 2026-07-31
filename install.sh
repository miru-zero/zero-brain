#!/usr/bin/env bash
# install.sh — zero-brain one-command installer สำหรับ Linux/macOS + cloud sandbox (0 token, no AI in loop)
# ใช้:  bash install.sh    (Windows ใช้ install.ps1)
# หมายเหตุ: sandbox คลาวไม่มีดิสก์ถาวร — ติดตั้งได้ครบทุกขั้น แต่สมองต้อง sync ผ่าน brain git remote (ดู SKILL.md ส่วน Cloud)
set -euo pipefail

RepoUrl="https://github.com/miru-zero/zero-brain.git"
ZeroRoot="${ZERO_ROOT:-$HOME/.zero}"
RepoDir="$ZeroRoot/mcp/zero-brain"
BrainDir="${ZERO_BRAIN_ROOT:-$ZeroRoot/brain}"

say() { printf '[ .. ] %s\n' "$1"; }
ok()  { printf '[ OK ] %s\n' "$1"; }
die() { printf '[FAIL] %s\n' "$1" >&2; exit 1; }

echo ""
echo "=== zero-brain installer (bash) ==="
echo "repo:  $RepoDir"
echo "brain: $BrainDir"
echo ""

# --- 0) dependencies ---
command -v node >/dev/null 2>&1 || die "ไม่เจอ node ใน PATH — ติดตั้ง Node.js LTS ก่อน"
command -v git  >/dev/null 2>&1 || die "ไม่เจอ git ใน PATH"
ok "node $(node -v) · $(git --version)"

# --- 1) clone or update repo ---
if [ -d "$RepoDir/.git" ]; then
  say "repo มีอยู่แล้ว — git pull"
  git -C "$RepoDir" pull --ff-only || die "git pull ไม่ผ่าน (อาจมีไฟล์แก้ค้าง — เช็ค git status)"
  ok "repo อัพเดตแล้ว"
elif [ -f "$RepoDir/package.json" ]; then
  say "รันอยู่ใน repo ที่ติดตั้งแล้ว — ข้าม clone"
else
  mkdir -p "$(dirname "$RepoDir")"
  say "clone $RepoUrl"
  git clone "$RepoUrl" "$RepoDir" || die "git clone ไม่สำเร็จ"
  ok "clone เสร็จ"
fi
cd "$RepoDir"

# --- 2) dependencies + build ---
say "npm install"
npm install --no-fund --no-audit --loglevel=error || die "npm install พัง"
say "npm run build"
npm run build --silent || die "npm run build พัง"
ok "build เสร็จ"

# --- 3) scaffold brain (idempotent ไม่ทับของเดิม) ---
say "npm run init (สร้างโครงสมอง ถ้ามีอยู่แล้วจะไม่ทับ)"
npm run init --silent || die "npm run init พัง"
ok "สมองพร้อมที่ $BrainDir"

# --- 4) smoke test ต้องผ่านก่อนจบ ---
say "node test/smoke.mjs"
node test/smoke.mjs || die "smoke test ไม่ผ่าน — ห้ามไปต่อ"
ok "smoke test ผ่านครบ"

# --- 5) ผูก Zero เข้าทุก agent client ตั้งแต่ boot (idempotent, backup ทุกไฟล์) ---
say "node tools/setup-agents.mjs"
node tools/setup-agents.mjs || die "setup-agents พัง — ดูตารางสรุปด้านบน"

# --- 6) verify ว่าติดตั้งสำเร็จจริง ---
say "node tools/verify-install.mjs"
node tools/verify-install.mjs || die "verify-install ไม่ผ่าน — ดูข้อ ✘ ด้านบน"
ok "ติดตั้งเสร็จสมบูรณ์ (ใช้ 0 token — ไม่มี AI ในลูป)"
