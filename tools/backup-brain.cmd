@echo off
rem wrapper for Task Scheduler — keeps schtasks /TR quoting trivial
"C:\Windows\System32\WindowsPowerShell\v1.0\powershell.exe" -NoProfile -ExecutionPolicy Bypass -File "C:\Users\Administrator\.zero\mcp\zero-brain\tools\backup-brain.ps1" >> "C:\Users\Administrator\.zero\brain\.kb\backup.log" 2>&1
