param(
  [string]$HookName = "unknown"
)

$logPath = Join-Path $HOME ".nagomi\hooks\hooks-test.log"
$payload = [Console]::In.ReadToEnd()

$record = [pscustomobject]@{
  ts = (Get-Date).ToString("o")
  hook = $HookName
  payload = $payload
}

$record | ConvertTo-Json -Compress | Add-Content $logPath
