$log = Join-Path $HOME ".nagomi\hooks\codex-notify-capture.jsonl"
if (Test-Path $log) {
  Remove-Item $log -Force
}

$notifyScript = "C:/Users/kitad/workspace/yurutsuku/tooling/capture-codex-notify.js"
codex exec -c 'notify=["node","C:/Users/kitad/workspace/yurutsuku/tooling/capture-codex-notify.js"]' --skip-git-repo-check "Reply with the single word OK."

Write-Output "---LOG---"
if (Test-Path $log) {
  Get-Content $log -Tail 20
} else {
  Write-Output "HOOK_LOG_MISSING"
}
