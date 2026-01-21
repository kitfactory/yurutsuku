# Terminal Debug Kit (P0)

UI を使わずに PTY/Worker の出力経路を確認する最小キットです。  
E2E で「worker が出力できるか」「出力トークンが返るか」を確認します。

## 使い方

```powershell
node tooling/terminal-debug-kit/worker_smoke.js --build
```

### 主要オプション
- `--cmd` : 起動コマンド（既定: Windows は `cmd.exe` / それ以外は `sh`）
- `--text` : 送信する入力（既定: `echo ok`）
- `--token` : 出力に含まれるべきトークン（既定: `ok`）
- `--timeout-ms` : タイムアウト（既定: 3000）
- `--out` : NDJSON ログ出力先（既定: `tooling/terminal-debug-kit/worker_smoke.ndjson`）

## 例

```powershell
node tooling/terminal-debug-kit/worker_smoke.js --build --token ok
node tooling/terminal-debug-kit/worker_smoke.js --cmd "cmd.exe /C echo ok" --token ok
```

## 成功条件
- `output token "ok" received` が表示される
- `worker_smoke.ndjson` に output/exit が記録される
