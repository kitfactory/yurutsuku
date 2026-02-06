# tauri-driver E2E 実行手順

このドキュメントは、nagomi の **tauri-driver を使った E2E テスト**の手順と注意点をまとめる。

---

## 目的
- Tauri UI を WebDriver で操作し、Terminal/Hook/IPC の統合動作を確認する
- Windows 環境での PATH/CLI/Hook の問題を早期に検知する

---

## 前提
- Windows 10/11
- `tauri-driver` / `msedgedriver` が利用可能
- `target/debug/nagomi-orchestrator.exe` をビルド済み

---

## 環境変数
- `NAGOMI_TAURI_DRIVER`: tauri-driver のパス（未指定なら PATH 解決）
- `NAGOMI_EDGE_DRIVER`: msedgedriver のパス（未指定なら PATH 解決）
- `NAGOMI_ENABLE_TEST_ENDPOINTS`: `1` のとき `/terminal-send` が有効
- `NAGOMI_ORCH_HEALTH_PORT`: Orchestrator のヘルスチェックポート（既定 17707）
- `NAGOMI_E2E_STRICT`: `1` のとき前提不足でも fail する（未指定時は一部を skip 扱い）

---

## 実行手順
1) Orchestrator をビルド
```powershell
cargo build -p nagomi-orchestrator
```

2) E2E を実行
```powershell
node apps/orchestrator/e2e/terminal.e2e.js
node apps/orchestrator/e2e/ipc.session.e2e.js
node apps/orchestrator/e2e/terminal.smoke.e2e.js
node apps/orchestrator/e2e/terminal.screenshot.e2e.js
node apps/orchestrator/e2e/terminal.stress.e2e.js
node apps/orchestrator/e2e/codex.hook.e2e.js
node apps/orchestrator/e2e/terminal.tint.e2e.js
```

`terminal.tint.e2e.js` は前提不足（例: `msedge` 不在、driver/browser の major 不一致、既存プロセス残存）時に skip を返す。  
CI などで必ず失敗扱いにしたい場合は `NAGOMI_E2E_STRICT=1` を指定する。

```powershell
$env:NAGOMI_E2E_STRICT = "1"
npm run e2e:tint -w apps/orchestrator
```

---

## Rust 通知テスト（分離実行）
`notify_flow` は Rust 側単体テストとして分離し、Node 統合テストとは別で実行する。

```powershell
npm run test:rust:notify -w apps/orchestrator
```

---

## Codex フック E2E の注意点
- `apps/orchestrator/e2e/codex.hook.e2e.js` は **nagomi Terminal 上で codex を起動**し、フック検知を確認する
- Windows では npm の shim が PATH にないと `codex` が解決できない
- Terminal セッションは **通常の cmd/PowerShell と同等の環境変数**を目指している
  - `where codex` が通るかを確認する

---

## よくあるトラブルと対策
### 1) codex が cmd で解決できない
- 原因: PATH に `C:\nvm4w\nodejs` など npm の bin が入っていない
- 対策: Terminal 起動時に User/System の環境変数を統合し、PATH を不足分だけ後ろに追加する

### 2) Codex の notify が動かない
- 原因: `config.toml` の notify 設定が不正（配列指定など）
- 対策: `notify = "nagomi-codex-notify"` を使用。fallback は `node <script>`

### 3) tauri-driver / msedgedriver が見つからない
- `NAGOMI_TAURI_DRIVER` / `NAGOMI_EDGE_DRIVER` を指定する
- `ensureDriversOnPath` が PATH を補完する（`apps/orchestrator/e2e/driver_paths.js`）

---

## ノウハウ: ターミナル入力イベントのデバッグ
### 目的
- codex の開始/終了（`codex` / `/quit`）入力が検知できないときの切り分け
- 全自動 E2E が通らない場合でも、手動＋スナップショットで検証を継続できる

### 手順（開発中のデバッグ手段）
1) Terminal 画面右下のデバッグ表示（`terminal-debug-badge`）で状態を確認  
2) `save debug snapshot` ボタンでスナップショットを保存  
3) 保存先:  
   - `C:\\Users\\<user>\\AppData\\Roaming\\com.kitfactory.nagomi\\terminal_debug_snapshots.jsonl`
4) デバッグ UI は `debug ui: on/off` ボタンで切り替えられる（状態は localStorage に保持）

### 見るべきポイント
- `line=codex` / `line=/quit` が出ているか
- `agent=on` が立っているか
- `cap=data` で入力を拾えているか

### 典型的な原因と対策
- **line が崩れる / 先頭が二重になる**  
  - key/global/textarea 側の行判定が混ざっている可能性  
  - 対策: 送信キュー由来の行判定に統一する
- **line が空になる**  
  - 入力ストリームの改行判定が取れていない  
  - 対策: `\r` を境に `inputLineBuffer` を確定する
- **修正中のバックスペースが効かない**  
  - `\x7f`/`\b` を無視している  
  - 対策: 行バッファから 1 文字削除する

---

## ノウハウ: AI エージェントの E2E を安定させる
### 基本方針
- **E2E は最小化し、観測性と中間テストを厚くする**
  - E2E は「連結の確認」用途に絞る
  - 入力/出力/判定を unit/integration で担保する

### 実践ポイント
- **観測性のレイヤ分離**: 入力/出力/判定を別レイヤで検証できるようにする
- **半自動ルートの用意**: 失敗時に 1 クリックで情報採取できる導線（スナップショット/末尾ログ/スクショ）
- **入力系の単一路線化**: onData/送信キューのみに統一し、key/global/textarea の混在を避ける
- **フレーク対策**: 描画/タイミング揺れを減らす（固定フォント/サイズ、アニメ抑制）
- **イベント相関ID**: session_id や tool 名を全イベントに付与して追跡する
- **LLM 依存の切り離し**: 本番相当の E2E と stub/fixture の E2E を分ける
- **判定オラクルの構造化**: JSON/state を基準に判定し、自然言語判定を避ける

### 補助データの活用
- 全自動で通らない場合でも、**手動 + スナップショット**で前進する
- E2E の「失敗時の情報量」を増やし、再現性を高める

### 実際の運用で効いたこと（実感ベース）
- **観測が先、制御は後**: まず見える化してから制御を入れると試行が速くなる
- **観察コストを下げる仕掛けが効く**: 1クリックで状況を固定できるスナップショットは強い
- **入力検知は一本道が正義**: onData/送信キューに一本化すると誤判定が減る
- **E2Eが詰まっても前に進める**: 半自動ルートを用意すると実装もテストも止まらない
- **確実に拾えるイベントを軸にする**: `codex`/`/quit` のようなハードイベントを基準に設計する

---

## 参照
- `apps/orchestrator/e2e/`
- `apps/orchestrator/e2e/driver_paths.js`
- `apps/orchestrator/src-tauri/src/main.rs`（Terminal 起動時の env 統合）
