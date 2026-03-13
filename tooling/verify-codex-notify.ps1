$hookFile = Join-Path $HOME ".nagomi\hooks\codex.jsonl"
if (Test-Path $hookFile) {
  Remove-Item $hookFile -Force
}

$env:NAGOMI_SESSION_ID = "hook-test-session"
codex exec --skip-git-repo-check "Reply with the single word OK."

Write-Output "---HOOK---"
if (Test-Path $hookFile) {
  Get-Item $hookFile | Format-List FullName,Length,LastWriteTime
  Write-Output "---HOOK-CONTENT---"
  Get-Content $hookFile -Tail 20
} else {
  Write-Output "HOOK_FILE_MISSING"
}
