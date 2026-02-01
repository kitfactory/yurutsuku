# usage.md（インストール / 使用方法）

入口は `docs/OVERVIEW.md`。P0（Windows）前提の簡易手順。

---

## 1. npm で CLI を入れる
```powershell
npm install -g @kitfactory/nagomi
```

## 2. Orchestrator / Worker の用意
CLI 単体では Orchestrator / Worker を同梱しないため、別途用意する。

開発用の例:
```powershell
cargo build -p nagomi-orchestrator -p nagomi-worker -p nagomi
```

バイナリを PATH に置くか、`NAGOMI_ORCHESTRATOR_PATH` で明示指定する。

---

## 3. 起動
起動すると Orchestrator の起動確認後に Terminal window を 1 枚開く。
```powershell
nagomi
```

固定 session_id で起動する場合:
```powershell
nagomi --session-id my-session
```

---

## 3.1 Windows ショートカット
デスクトップにショートカットを作る:
```powershell
nagomi shortcut --desktop
```

スタートメニュー（Programs）に作る:
```powershell
nagomi shortcut --start-menu
```

保存先を明示する（ファイル or ディレクトリ）:
```powershell
nagomi shortcut --path "C:\\Users\\<user>\\Desktop"
```

固定 session_id を付ける:
```powershell
nagomi shortcut --desktop --session-id my-session
```

---

## 4. デバッグ補助（テスト用）
`NAGOMI_ENABLE_TEST_ENDPOINTS=1` のときだけ `/terminal-send` が有効になる。
```powershell
$env:NAGOMI_ENABLE_TEST_ENDPOINTS = "1"
nagomi terminal-send --session-id codex-test --text "echo ok`r`n"
```

---

## 5. 代表的な環境変数
- `NAGOMI_ORCHESTRATOR_PATH`: Orchestrator 実行ファイルのパス
- `NAGOMI_ORCH_HEALTH_PORT`: ヘルスチェックポート（既定 17707）
- `NAGOMI_ENABLE_TEST_ENDPOINTS`: テスト用HTTPエンドポイントを有効化（`1` のとき有効）
