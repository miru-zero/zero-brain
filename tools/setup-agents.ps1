# setup-agents.ps1 — ผูก Zero เข้าทุก agent client ตั้งแต่ boot (idempotent, มี backup ทุกไฟล์)
# เรียกจาก install.ps1 หรือรันเอง:  powershell -ExecutionPolicy Bypass -File tools\setup-agents.ps1
# หลักการ: ไม่ทับของเดิม — เติมเฉพาะส่วนที่ยังไม่มี, block ข้อความใช้ marker ZERO:BEGIN/END, config ทุกตัว backup ก่อนแตะ
param(
  [string]$RepoDir = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
)

$ErrorActionPreference = "Stop"
$Dist = (Join-Path $RepoDir "dist\index.js")
if (-not (Test-Path $Dist)) { Write-Host "✗ ไม่เจอ $Dist — รัน npm run build ก่อน" -ForegroundColor Red; exit 1 }
$DistEsc = $Dist.Replace('\', '\\')

$Results = @()
function Note($client, $item, $status) { $script:Results += [pscustomobject]@{ Client = $client; Item = $item; Status = $status } }
function Backup($path) {
  $stamp = Get-Date -Format "yyyyMMdd-HHmmss"
  Copy-Item $path "$path.bak-zero-setup-$stamp"
}

# ---------- 1) marker block สำหรับ AGENTS.md ทุก client ----------
$Block = @"

<!-- ZERO:BEGIN (managed by zero-brain setup-agents.ps1 — แก้ผ่าน repo เท่านั้น) -->
## ⭕ ZERO SYSTEM
- โซน: ``~/.zero/brain`` (สมอง) · ``~/.zero/mcp/zero-brain`` (โค้ด+MCP) · ``~/.zero/share`` (runtime ไม่ใช่สมอง)
- ความจำผ่าน MCP tools ``zero_*`` เท่านั้น — ค้นก่อนทำ (``zero_search``/``zero_resolve``) · จบงานจด (``zero_capture``) · เช้า ``zero_home`` ก่อนนอน ``zero_nightly``
- กฎสัญญาเต็ม: อ่าน ``~/.zero/brain/AGENTS.md`` ก่อนใช้สมองทุกครั้ง
- งบโทเค้น: STOP → THINK → RUN ONCE · ห้าม poll loop · instrument ก่อนรันใหญ่ — เต็มที่ ``~/.zero/brain/20_Atlas/Token Budget Policy.md``
<!-- ZERO:END -->
"@

function Ensure-Block($path, $client) {
  if (-not (Test-Path $path)) { Note $client "AGENTS.md" "SKIP (ไม่มีไฟล์)"; return }
  $text = Get-Content $path -Raw
  $m = [regex]::Match($text, "(?s)<!-- ZERO:BEGIN.*?ZERO:END -->")
  if ($m.Success) {
    if ($m.Value.Trim() -ceq $Block.Trim()) { Note $client "AGENTS.md" "OK (มีอยู่แล้ว)"; return }
    $new = $text.Remove($m.Index, $m.Length).Insert($m.Index, $Block.Trim())
    Backup $path; Set-Content $path $new -NoNewline -Encoding UTF8; Note $client "AGENTS.md" "UPDATED block"
  } else {
    Backup $path; Add-Content $path $Block -Encoding UTF8; Note $client "AGENTS.md" "ADDED block"
  }
}

# ---------- 2) Codex (~/.codex) ----------
$CodexHome = Join-Path $HOME ".codex"
if (Test-Path $CodexHome) {
  $toml = Join-Path $CodexHome "config.toml"
  if (Test-Path $toml) {
    $t = Get-Content $toml -Raw
    if ($t -match "\[mcp_servers\.zero-brain\]") { Note "codex" "config.toml MCP" "OK (มีอยู่แล้ว)" }
    else {
      Backup $toml
      Add-Content $toml @"

[mcp_servers.zero-brain]
command = "node"
args = ["$DistEsc"]

[mcp_servers.zero-brain.env]
ZERO_BRAIN_ACTOR = "codex"
"@ -Encoding UTF8
      Note "codex" "config.toml MCP" "ADDED zero-brain"
    }
  }
  Ensure-Block (Join-Path $CodexHome "AGENTS.md") "codex"
} else { Note "codex" "-" "SKIP (ไม่มี ~/.codex)" }

# ---------- 3) Kimi Claw / OpenClaw (~/.kimi + ~/.kimi_openclaw) ----------
$ClawJson = Join-Path $HOME ".kimi\kimi-claw\openclaw.json"
if (Test-Path $ClawJson) {
  $cfg = Get-Content $ClawJson -Raw | ConvertFrom-Json
  $has = $cfg.PSObject.Properties["mcp"] -and $cfg.mcp.PSObject.Properties["servers"] -and $cfg.mcp.servers.PSObject.Properties["zero-brain"]
  if ($has) { Note "kimi-claw" "openclaw.json MCP" "OK (มีอยู่แล้ว)" }
  else {
    Backup $ClawJson
    if (-not $cfg.PSObject.Properties["mcp"]) { $cfg | Add-Member -NotePropertyName "mcp" -NotePropertyValue ([pscustomobject]@{}) }
    if (-not $cfg.mcp.PSObject.Properties["servers"]) { $cfg.mcp | Add-Member -NotePropertyName "servers" -NotePropertyValue ([pscustomobject]@{}) }
    $srv = [pscustomobject]@{ command = "node"; args = @($Dist); env = [pscustomobject]@{ ZERO_BRAIN_ACTOR = "kimi-claw" } }
    $cfg.mcp.servers | Add-Member -NotePropertyName "zero-brain" -NotePropertyValue $srv
    ($cfg | ConvertTo-Json -Depth 30) | Set-Content $ClawJson -Encoding UTF8
    Note "kimi-claw" "openclaw.json MCP" "ADDED zero-brain (restart gateway)"
  }
  Ensure-Block (Join-Path $HOME ".kimi_openclaw\workspace\AGENTS.md") "kimi-claw"
} else { Note "kimi-claw" "-" "SKIP (ไม่มี openclaw.json)" }

# ---------- 4) Kimi Code (~/.kimi-code) ----------
$KimiCode = Join-Path $HOME ".kimi-code"
if (Test-Path $KimiCode) {
  $mcpJson = Join-Path $KimiCode "mcp.json"
  if (Test-Path $mcpJson) {
    $m = Get-Content $mcpJson -Raw | ConvertFrom-Json
    if ($m.mcpServers.PSObject.Properties["zero-brain"]) { Note "kimi-code" "mcp.json" "OK (มีอยู่แล้ว)" }
    else {
      Backup $mcpJson
      $srv = [pscustomobject]@{ command = "node"; args = @($Dist); env = [pscustomobject]@{ ZERO_BRAIN_ACTOR = "kimi-code" } }
      $m.mcpServers | Add-Member -NotePropertyName "zero-brain" -NotePropertyValue $srv
      ($m | ConvertTo-Json -Depth 30) | Set-Content $mcpJson -Encoding UTF8
      Note "kimi-code" "mcp.json" "ADDED zero-brain"
    }
  }
  Ensure-Block (Join-Path $KimiCode "AGENTS.md") "kimi-code"
  # skills: เติมเฉพาะที่ขาดจาก repo\skills
  $skillSrc = Join-Path $RepoDir "skills"
  $skillDst = Join-Path $KimiCode "skills"
  if ((Test-Path $skillSrc) -and (Test-Path $skillDst)) {
    Get-ChildItem $skillSrc -Directory | Where-Object { $_.Name -ne "README.md" } | ForEach-Object {
      $target = Join-Path $skillDst $_.Name
      if (-not (Test-Path $target)) { Copy-Item $_.FullName $target -Recurse; Note "kimi-code" "skill $($_.Name)" "COPIED" }
    }
  }
} else { Note "kimi-code" "-" "SKIP (ไม่มี ~/.kimi-code)" }

# ---------- 5) Daimon / Kimi Work skills (~/.zero/share) ----------
$DaimonSkills = Join-Path $HOME ".zero\share\daimon-share\daimon\skills"
if (Test-Path $DaimonSkills) {
  $skillSrc = Join-Path $RepoDir "skills"
  Get-ChildItem $skillSrc -Directory | ForEach-Object {
    $target = Join-Path $DaimonSkills $_.Name
    if (-not (Test-Path $target)) { Copy-Item $_.FullName $target -Recurse; Note "daimon" "skill $($_.Name)" "COPIED" }
    else { Note "daimon" "skill $($_.Name)" "OK (มีอยู่แล้ว)" }
  }
} else { Note "daimon" "skills" "SKIP (ไม่มี daimon skills dir)" }

# ---------- สรุป ----------
Write-Host ""
$Results | Format-Table -AutoSize
Write-Host "เสร็จ: ทุกไฟล์ที่ถูกแตะมี backup ต่อท้าย .bak-zero-setup-<เวลา> ข้างไฟล์เดิม" -ForegroundColor Green
Write-Host "ขั้นสุดท้าย: restart client แต่ละตัว (codex / gateway kimi-claw / kimi-code / Kimi Work) แล้วเรียก zero_health ยืนยัน" -ForegroundColor Yellow
