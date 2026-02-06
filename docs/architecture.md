# architecture.md（設計書）

この文書は `docs/OVERVIEW.md` と `docs/concept.md` / `docs/spec.md` を正本とし、P0（Windows）範囲の設計をまとめる。

---

#1. アーキテクチャ概要
- UI: Tauri + HTML/TypeScript + xterm.js（Terminal/Watcher/tint/Settings）
- Orchestrator: Rust（Session/Hook/Judge/StateIntegrator/IPC）
- Worker: Rust（ConPTY で PTY を実行、Windows では余分なコンソールを出さない）
- Protocol: NDJSON
- Storage: settings.json
- Debug: デバッグ UI（バッジ/スナップショット/スクショ）+ worker_smoke.log
- Environment: Windows の User/System 環境変数を統合して PTY に渡す。`NAGOMI_SESSION_ID` を付与する
- PATH は不足分のみ後ろに追加し、User/System の不足分を補完する

#2. concept との対応
| concept | 実装モジュール | 責務 |
|---|---|---|
| F-1 TerminalStateDetector | `apps/orchestrator/src/terminal_observer.js` | PTY 入出力/終了から terminal 状態を推定 |
| F-2 AgentEventObserver | `apps/orchestrator/src/agent_event_observer.js` + `apps/orchestrator/src-tauri/src/completion_hook.rs` | hook イベントの正規化 |
| F-3 StateIntegrator + ToolJudge | `apps/orchestrator/src/state_integrator.js` + `tool_judge` | 終了候補の判定と状態統合 |
| F-4 Grouping | UI + Orchestrator（将来） | Workspace / Task Group / Pane の整理 |

#3. I/F 設計
## 3.1 UI → Orchestrator（Tauri Command）
- `start_terminal_session(sessionId, cols, rows)`
- `terminal_send_input(sessionId, text)`
- `terminal_resize(sessionId, cols, rows)`
- `register_terminal_session(sessionId)`
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
- AI Coding Agent 選択（codex/claudecode/opencode）

#7. エラー処理
- 不正な NDJSON type は無視
- tool_judge 失敗時は heuristic にフォールバック
- hook 正規化失敗は警告/無視

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
