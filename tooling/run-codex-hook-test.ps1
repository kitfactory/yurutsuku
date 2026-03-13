$hookLog = Join-Path $HOME ".nagomi\hooks\hooks-test.log"
if (Test-Path $hookLog) {
  Remove-Item $hookLog -Force
}
$launcher = "C:\Users\kitad\workspace\yurutsuku\tooling\codex-hook-launch.cmd"
$launcherProcess = Start-Process `
  -FilePath "cmd.exe" `
  -ArgumentList @("/c", "`"$launcher`"") `
  -WorkingDirectory (Split-Path $launcher -Parent) `
  -PassThru

try {
  Start-Sleep -Seconds 8
} finally {
  # 起動した cmd/codex ツリーだけを止める / Kill only the test-owned cmd/codex tree.
  if ($launcherProcess -and -not $launcherProcess.HasExited) {
    Start-Process `
      -FilePath "taskkill.exe" `
      -ArgumentList @("/PID", $launcherProcess.Id, "/T", "/F") `
      -WindowStyle Hidden `
      -Wait | Out-Null
  }
}

if (Test-Path $hookLog) {
  Get-Item $hookLog | Format-List FullName,Length,LastWriteTime
  Write-Output "---HOOKLOG---"
  Get-Content $hookLog
} else {
  Write-Output "HOOK_LOG_MISSING"
}
