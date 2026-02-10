# architecture.md（設計書）

この文書は `docs/OVERVIEW.md` と `docs/concept.md` / `docs/spec.md` を正本とし、P0（Windows）範囲の設計をまとめる。

---

#1. アーキテクチャ概要
- UI: Tauri + HTML/TypeScript + xterm.js（Terminal/Watcher/tint/Settings）
- Tray: 運用メニューは `Open Terminal Window` / `Arrange Terminal Windows` / `Open Settings` / `Quit` に限定し、`worker_*` のデバッグ操作は常時表示しない
- Orchestrator: Rust（Session/Hook/Judge/StateIntegrator/IPC）
- Worker: Rust（ConPTY で PTY を実行、Windows では余分なコンソールを出さない）
- Protocol: NDJSON
- Storage: settings.json
- Debug: デバッグ UI（バッジ/スナップショット/スクショ）+ worker_smoke.log
- Environment: Windows の User/System 環境変数を統合して PTY に渡す。`NAGOMI_SESSION_ID` を付与する
- PATH は不足分のみ後ろに追加し、User/System の不足分を補完する
- Windows 設定画面では `Windows` カテゴリを分離し、terminal 起動方式（`cmd`/`powershell`/`wsl`）と `wsl` distro 指定を行う
- Windows 設定画面では terminal 操作ショートカット（整列/次へ移動/前へ移動）を編集でき、既定は `Ctrl+Shift+Y/J/K` とする
- テーマは 8 種類（`light-sand` / `light-sage` / `light-sky` / `light-mono` / `dark-ink` / `dark-ocean` / `dark-ember` / `dark-mono`）を 1 つの選択UIで選び、内部では mode（`dark`/`light`）+ palette に正規化して CSS 変数を切り替える
- 設定画面のレスポンシブは「十分な幅で 2 列、狭幅で 1 列」に固定し、項目幅を潰さない
- Run タイル/Terminal 本文のダブルクリックは「既存ウィンドウの位置/サイズを複製して新規ウィンドウを開く」経路を持つ
- 非選択ターミナルの選択による拡大表示は「整列済みレイアウトが維持されている場合」に限定し、未整列時は SelectionState/Focus のみ更新する
- 選択ウィンドウ交代アニメーションは短時間（縮小 60-100ms / 拡大 80-140ms / 合計 240ms 以下）で完了させ、連続交代時は旧遷移をキャンセルして最新遷移を優先する
- `未整列` の判定は「起動後未整列」「ユーザー操作による move/resize/maximize」「ウィンドウ増減」で `arranged=false` とし、`Arrange Terminal Windows` 実行時のみ `arranged=true` に戻す
- Terminal の `:ng` は **Frontend Internal Command Layer** で解釈し、PTY へ送信しない（初期対応は `:ng ping`）

#2. concept との対応
| concept | 実装モジュール | 責務 |
|---|---|---|
| F-1 TerminalStateDetector | `apps/orchestrator/src/terminal_observer.js` | PTY 入出力/終了から terminal 状態を推定 |
| F-2 AgentEventObserver | `apps/orchestrator/src/agent_event_observer.js` + `apps/orchestrator/src-tauri/src/completion_hook.rs` | hook イベントの正規化 |
| F-3 StateIntegrator + ToolJudge | `apps/orchestrator/src/state_integrator.js` + `tool_judge` | 終了候補の判定と状態統合 |
| F-4 Grouping | UI + Orchestrator（将来） | Workspace / Task Group / Pane の整理 |
| F-5 Settings Theme/Responsive | `apps/orchestrator/src/index.html`（settings theme / responsive css） | モノクロテーマ追加と設定画面の崩れ防止 |
| F-6 Double Click Spawn | `apps/orchestrator/src/index.html` + `open_terminal_window_by_index_same_position` + `open_terminal_window_same_position_selected` | クリック元と同位置に新規 terminal を追加 |
| F-7 Selection Handoff | `pickup_terminal_window` + `SelectionState` + `terminal-focus-transition` | 整列済み時のみ非選択 terminal の選択交代と拡大表示を同期（未整列時は focus のみ） |

#3. I/F 設計
## 3.1 UI → Orchestrator（Tauri Command）
- `start_terminal_session(sessionId, cols, rows)`
- `terminal_send_input(sessionId, text)`
- `terminal_resize(sessionId, cols, rows)`
- `register_terminal_session(sessionId)`
- `open_terminal_window_by_index_same_position(index)`（クリック元の位置/サイズを引き継いで新規 terminal を開く）
- `open_terminal_window_same_position_selected()`（選択中/フォーカス中の terminal の位置/サイズを引き継いで新規 terminal を開く）
- `open_terminal_window_same_position_for_session(sessionId)`（指定 terminal の位置/サイズを引き継いで新規 terminal を開く）
- `tool_judge(tool, tail)` -> `{ state, summary }`
- `append_terminal_debug_snapshot(payload)`（開発用）
- `save_debug_screenshot(ipc_session_id)`（開発用）

## 3.2 Orchestrator → UI（Tauri Event）
- `terminal-output { session_id, stream, chunk }`
- `terminal-exit { session_id, exit_code }`
- `terminal-error { session_id, message }`
- `completion-hook-state { source, kind, source_session_id?, judge_state?, summary? }`
- `terminal-focus-transition { token, active }`（UI アニメ制御）

## 3.3 Core Modules
### TerminalStateDetector
- 入力: `nowMs, lastOutputAtMs, lastTail, exitCode`
- 出力: `state, reason, idleMs`

### AgentEventObserver
- 入力: hook payload
- 出力: `state, reason, source`

### StateIntegrator
- 入力: terminal/agent
- 出力: merged state（agent を優先）

### StatusPresentation / Routing
- 状態は `idle/running/need_input/success/failure/disconnected` を **区別して保持**する
- UI の色は `idle/success=黒`、`running=青`、`need_input/failure=赤` で固定
- **処理ルートは状態ごとに分離**する（アイコン/通知/音/ログなどの出し分けは state によって決める）
- `need_input` は `running` 経由でのみ確定する（`idle/success/failure -> need_input` の直行をガードし、一度 `running` を挟んで再評価する）

### ToolJudgeRunner
- 入力: `tool` と `tail`（末尾 1500 字 + 50 行）
- 出力: `success/failure/need_input`

### CompletionHook
- `start(on_event)` / `stop()`
- `source_session_id` を伝播して関連付け（PTY セッションと hook を結びつける）

### DebugSnapshot
- 入力: UI 上の `save debug snapshot`
- 出力: `terminal_debug_snapshots.jsonl`（JSONL, `ts_ms` 付与）

### DebugScreenshot
- 入力: UI 上の `save debug screenshot`
- 出力: `terminal_debug_screenshots/terminal-<ts>.png`
- 実装: WebView2 DevTools（`Page.captureScreenshot`）で取得し保存
- 失敗時: `worker_smoke.log` に理由を記録（best-effort）

### Frontend Internal Command Layer（`:ng`）
- 配置: `apps/orchestrator/src/index.html`（入力行解釈とローカル表示）
- 入力: キー入力バッファ（行単位）
- 判定: 行先頭が `:ng` のときのみ内蔵コマンドとして処理
- 出力: terminal 画面へのローカル出力（`pong` / usage / unknown）
- 制約: `:ng` 系入力は PTY/Worker へ送らない
- 初期サブコマンド: `:ng ping` のみ

#4. データフロー
1) PTY output → TerminalStateDetector → terminal 状態
2) Hook → CompletionHook → AgentEventObserver
3) 終了候補（hook completed/error/need_input or 30s idle）→ ToolJudgeRunner
4) StateIntegrator → UI（Watcher/tint）

#5. ストレージ
- `settings.json`: 通知/AI判定/Terminal 設定を保存
- デバッグスナップショット（開発用途）: `AppData/Roaming/com.kitfactory.nagomi/terminal_debug_snapshots.jsonl`

#6. Settings
- `llm_enabled` / `llm_tool` / `silence_timeout_ms`
- `terminal_*`（font/size/theme/scrollback/copy）
- `terminal_theme_palette`（8テーマの palette 値。UIは単一テーマ選択）
- `terminal_shell_kind`（`cmd` / `powershell` / `wsl`）
- `terminal_wsl_distro`（空なら既定 distro）
- `terminal_keybind_arrange`（整列ショートカット）
- `terminal_keybind_focus_next`（次へ移動ショートカット）
- `terminal_keybind_focus_prev`（前へ移動ショートカット）
- AI Coding Agent 選択（codex/claudecode/opencode）

## 6.1 Windows Terminal 起動コマンド
- `terminal_shell_kind=cmd` -> `cmd.exe`
- `terminal_shell_kind=powershell` -> `powershell.exe`
- `terminal_shell_kind=wsl` かつ `terminal_wsl_distro` 空 -> `wsl.exe`
- `terminal_shell_kind=wsl` かつ `terminal_wsl_distro` 指定 -> `wsl.exe -d <distro>`

#7. エラー処理
- 不正な NDJSON type は無視
- tool_judge 失敗時は heuristic にフォールバック
- hook 正規化失敗は警告/無視

## 7.3 `:ng` のロールバックポイント
- RP-1: 入力不能/重複入力が再発した場合は、`settings > Windows > :ng 内蔵コマンド` を OFF にして Frontend Internal Command Layer を無効化し `terminal_send_input` へ全面パススルーする
- RP-2: `pong` などの内蔵応答が消失する場合は、ローカル描画を止めて `:ng` を通常シェル入力として扱う
- RP-3: 原因切り分け中は `:ng` サブコマンド追加を凍結し、`ping` のみで再現試験を継続する

#7.1 AI判定 OFF の扱い
- hook completed/error/need_input をそのまま state に反映する
- 30s idle も need_input として扱う

#7.2 AI ツール開始イベント
- **AI ツールのコマンド入力のみ**を開始イベントとして扱う
- 対話中の Enter も開始イベントとして扱う（ただし通常コマンドは開始とみなさない）

#8. 拡張性
- CompletionHook を tool ごとに差し替え可能
- AI判定の tool を選択可能
- Worker backend を Windows/WSL で切替可能（P0 は Windows）

#9. セキュリティ
- ログマスク規則は `docs/spec.md` に従う
- AI判定 OFF の場合は外部送信しない

#10. 観測/デバッグ
- `terminal-output-broadcast`（任意）
- ターミナル入力の debug snapshot 取得

#11. E2E
- tauri-driver を用いた UI/E2E
- codex hook 統合テスト（`apps/orchestrator/e2e/codex.hook.e2e.js`）

#12. スコープ境界
- P0 は Windows のみ
- WSL Worker / Linux/macOS は非対象

#13. CLI
- `nagomi.exe` / `nagomi`（launcher）
- 連続起動は terminal window を追加で開く
