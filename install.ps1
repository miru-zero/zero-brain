# install.ps1 — zero-brain one-command installer (zero tokens, no AI in loop)
# ใช้:  powershell -ExecutionPolicy Bypass -File install.ps1 [-Actor kimi-code]
param(
  [string]$Actor = "kimi-code"
)
$ErrorActionPreference = 'Stop'

function Ok($m)   { Write-Host "[ OK ] $m" -ForegroundColor Green }
function Info($m) { Write-Host "[ .. ] $m" -ForegroundColor Cyan }
function Die($m)  { Write-Host "[FAIL] $m" -ForegroundColor Red; exit 1 }

$RepoUrl = "https://github.com/miru-zero/zero-brain.git"
$ZeroRoot = Join-Path $HOME ".zero"
$RepoDir  = Join-Path $ZeroRoot "mcp\zero-brain"
$BrainDir = Join-Path $ZeroRoot "brain"

Write-Host ""
Write-Host "=== zero-brain installer ===" -ForegroundColor Cyan
Write-Host "repo:  $RepoDir"
Write-Host "brain: $BrainDir  (default ZERO_BRAIN_ROOT)"
Write-Host ""

# --- 0) dependencies ---
if (-not (Get-Command node -ErrorAction SilentlyContinue)) { Die "ไม่เจอ node ใน PATH — ติดตั้ง Node.js LTS ก่อน แล้วเปิด terminal ใหม่" }
if (-not (Get-Command git  -ErrorAction SilentlyContinue)) { Die "ไม่เจอ git ใน PATH" }
Ok "node $(node -v) · $(git --version)"

# --- 1) clone or update repo ---
if (Test-Path (Join-Path $RepoDir ".git")) {
  Info "repo มีอยู่แล้ว — git pull"
  Push-Location $RepoDir
  git pull --ff-only
  if ($LASTEXITCODE -ne 0) { Pop-Location; Die "git pull ไม่ผ่าน (อาจมีไฟล์แก้ค้าง — เช็ค git status)" }
  Pop-Location
  Ok "repo อัพเดตแล้ว"
} else {
  New-Item -ItemType Directory -Force -Path (Split-Path $RepoDir) | Out-Null
  Info "clone $RepoUrl"
  git clone $RepoUrl $RepoDir
  if ($LASTEXITCODE -ne 0) { Die "git clone ไม่สำเร็จ" }
  Ok "clone เสร็จ"
}

Push-Location $RepoDir

# --- 2) dependencies + build ---
Info "npm install"
npm install --no-fund --no-audit --loglevel=error
if ($LASTEXITCODE -ne 0) { Pop-Location; Die "npm install พัง" }
Info "npm run build"
npm run build --silent
if ($LASTEXITCODE -ne 0) { Pop-Location; Die "npm run build พัง" }
Ok "build เสร็จ"

# --- 3) scaffold brain (idempotent ไม่ทับของเดิม) ---
Info "npm run init (สร้างโครงสมอง ถ้ามีอยู่แล้วจะไม่ทับ)"
npm run init --silent
if ($LASTEXITCODE -ne 0) { Pop-Location; Die "npm run init พัง" }
Ok "สมองพร้อมที่ $BrainDir"

# --- 4) smoke test ต้องผ่านก่อนจบ ---
Info "node test/smoke.mjs"
node test\smoke.mjs
if ($LASTEXITCODE -ne 0) { Pop-Location; Die "smoke test ไม่ผ่าน — ห้ามไปต่อ แคปหน้าจอนี้ส่งให้ทีม" }
Pop-Location
Ok "smoke test ผ่านครบ"

# --- 5) ผูก Zero เข้าทุก agent client ตั้งแต่ boot (idempotent, backup ทุกไฟล์) ---
# ใช้ .mjs เป็นหลัก — PS 5.1 อ่านสคริปต์ไทยไม่มี BOM เพี้ยน ทั้งคู่จึงย้าย logic ไป node
Info "node tools\setup-agents.mjs (codex / kimi-claw / kimi-code / daimon)"
node (Join-Path $RepoDir "tools\setup-agents.mjs")
if ($LASTEXITCODE -ne 0) { Die "setup-agents พัง — ดูตารางสรุปด้านบน" }

# --- 6) ซ่อน non-brain ใน Obsidian vault (userIgnoreFilters + CSS snippet, idempotent) ---
Info "node tools\setup-obsidian.mjs (ซ่อน mcp/share/… ให้เหลือ brain ก้อนเดียว)"
node (Join-Path $RepoDir "tools\setup-obsidian.mjs")
if ($LASTEXITCODE -ne 0) { Die "setup-obsidian พัง — ดูข้อความด้านบน" }

# --- 7) verify ว่าติดตั้งสำเร็จจริง (ไฟล์ครบ + spawn MCP คุย zero_health ได้) ---
Info "node tools\verify-install.mjs"
node (Join-Path $RepoDir "tools\verify-install.mjs")
if ($LASTEXITCODE -ne 0) { Die "verify-install ไม่ผ่าน — ดูข้อ ✘ ด้านบน" }
Ok "ติดตั้งเสร็จสมบูรณ์ (ใช้ 0 token — ไม่มี AI ในลูป)"
