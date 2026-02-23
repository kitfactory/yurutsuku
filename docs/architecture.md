# architecture.md（設計書）

この文書は `docs/OVERVIEW.md` と `docs/concept.md` / `docs/spec.md` を正本とし、P0（Windows）範囲の設計をまとめる。

---

#1. アーキテクチャ概要
- UI: Tauri + HTML/TypeScript + xterm.js（Terminal/Watcher/tint/Settings）
- Tray: 運用メニューは `Open Terminal Window` / `Open Character Window` / `Arrange Terminal Windows` / `Open Settings` / `Quit` に限定し、`worker_*` のデバッグ操作は常時表示しない
- Orchestrator: Rust（Session/Hook/Judge/StateIntegrator/IPC）
- Worker: Rust（ConPTY で PTY を実行、Windows では余分なコンソールを出さない）
- Protocol: NDJSON
- Storage: settings.json
- Debug: JSONLログ（`status_debug_events.jsonl` / `subworker_debug_events.jsonl` / `subworker_io_events.jsonl`）+ worker_smoke.log
- Environment: Windows の User/System 環境変数を統合して PTY に渡す。`NAGOMI_SESSION_ID` を付与する
- PATH は不足分のみ後ろに追加し、User/System の不足分を補完する
- Windows 設定画面では `Windows` カテゴリを分離し、terminal 起動方式（`cmd`/`powershell`/`wsl`）と `wsl` distro 指定を行う
- Windows 設定画面では terminal 操作ショートカット（整列/次へ移動/前へ移動）を編集でき、既定は `Ctrl+Shift+Y/J/K` とする
- テーマは 8 種類（`light-sand` / `light-sage` / `light-sky` / `light-mono` / `dark-ink` / `dark-ocean` / `dark-ember` / `dark-mono`）を 1 つの選択UIで選び、内部では mode（`dark`/`light`）+ palette に正規化して CSS 変数を切り替える
- 設定画面のレスポンシブは「十分な幅で 2 列、狭幅で 1 列」に固定し、項目幅を潰さない
- Terminal 右クリックメニューは「既存ウィンドウの位置/サイズを複製して新規ウィンドウを開く」経路を持つ
- 非選択ターミナルの選択による拡大表示は「整列済みレイアウトが維持されている場合」に限定し、未整列時は SelectionState/Focus のみ更新する
- 選択ウィンドウ交代アニメーションは短時間（縮小 60-100ms / 拡大 80-140ms / 合計 240ms 以下）で完了させ、連続交代時は旧遷移をキャンセルして最新遷移を優先する
- `未整列` の判定は「起動後未整列」「ユーザー操作による move/resize/maximize」「ウィンドウ増減」で `arranged=false` とし、`Arrange Terminal Windows` 実行時のみ `arranged=true` に戻す
- Terminal window の **ウィンドウタイトル**は CWD ベースで更新し、通常は末尾フォルダ名、末尾が汎用名（`src` / `docs` / `tests`）の場合は 2 階層 `<parent>/<leaf>` を表示する（推定は出力テールのプロンプトから行う）
- Terminal の `:ng` は **Frontend Internal Command Layer** で解釈し、PTY へ送信しない（初期対応は `:ng ping`）
- SubWorker はターミナル状態とモード（`ガンガン` / `慎重に` / `アドバイス`）を見て、入力代行または表示専用アドバイスを実行する
- SubWorker 稼働中は対象ターミナルへ緑の稼働オーバーレイを適用し、終了後は元の状態色表示へ戻す
- Watcher は通常表示（256x512, 右下）とデバッグ表示（480x960, 中央）を分離し、どちらも背景透明で描画する
- Watcher の 3D描画は CDN 依存を複数候補（esm.sh / jsdelivr）で初期化し、VRM読込失敗時は機能実証用 3Dプロトタイプモデルへフォールバックする（依存ロード失敗時のみ2Dへ戻す）
- キャラクター状態は terminal 状態とは別に集約し、固定モーションを `neutral` / `processing` / `waiting` / `need_user` の4状態で扱う。ワンショットは `completion` / `error_alert` を重ねて再生する
- `error_alert` は連続発火をクールダウンで抑止し、`completion` は処理完了遷移時のみ再生する
- 透明 watcher window は通常 watcher / `watcher-debug` とも UI フレームを選択状態（focus または pointer inside）で切り替える。native frame（decorations）も両者で同じ選択状態に合わせて切り替える
- watcher 系IPCの発火条件は最小化する。`watcher_window_ready` は初期化時1回、`set_watcher_window_framed` は通常 watcher / `watcher-debug` の選択状態遷移時のみ、`resize_watcher_window` は通常 watcher のリサイズハンドル操作時のみ許可する。pointer enter/leave は選択状態更新として扱い、pointer down は focus 通知欠落を補う 1 回のみ再同期を許可する
- `set_watcher_window_framed` / `resize_watcher_window` はともに Frontend 側で直列化し、in-flight 中は同時実行しない（pending は最新値へ上書き）
- Watcher 3D は `loadWatcher3dModel` の同一路径読込を in-flight Promise で畳み、重複ロードを防ぐ。描画は pixel ratio 上限とフレーム間引きで GPU 負荷を抑える
- 起動直後は settings hydration 完了まで通常 watcher の表示を保留し、`renderer=3d` の場合は 2D を挟まず `is-3d-loading -> is-3d` で描画を切り替える
- watcher には準備中専用レイヤ（Div）を持たせ、settings hydration 中および 3D 再読込中は `準備中...` を表示する（2D/3D 共通）
- 3D依存読込/VRM読込にはタイムアウトを設定し、ハングした Promise を再利用しない。期限超過時は `is-preparing` を解除してフォールバック経路へ戻す
- `load_settings` は strict timeout 付きで複数回試行し、IPC がぶら下がる環境でも `settingsHydrated` を確実に進めて watcher の準備中固定を防ぐ
- built-in pack fetch / stored pack list は timeout 付きで取得し、失敗時は空配列へフォールバックして `reloadCharacterPackCatalog` を完走させる
- watcher の読み込み各段階は `status_debug_events.jsonl` へ `watcher-*` イベントを記録する。`preparing` が長時間継続した場合は `watcher-preparing-stuck` を1回出力して詰まり箇所を特定しやすくする
- `settingsHydrated` を `true` にした直後に `applyTerminalWatcherVisibility('settings-hydrated')` を呼び、`refreshWatcherRendererMode` の再評価を強制する
- `renderer=3d` かつ VRM 設定済みなら通常 watcher でも 3D 表示する。`watcher-debug` は大きめ 3D プレビュー用途として併用する
- 通常 watcher は UI フレーム右下のリサイズハンドルでサイズ変更できる。サイズ変更は `resize_watcher_window` コマンドで行い、右下アンカーを維持する
- 通常 watcher の close はフロント側で `set_terminal_watcher_enabled(false)` を呼んで即時 hide し、保存待ちで UI をブロックしない。保存失敗時のみ `save_settings` をフォールバックする
- ターミナルライフサイクル終了時（terminal window 0 かつ session/worker 0）は、キャラクター表示ウィンドウ（通常 watcher / `watcher-debug`）を Rust 側で自動クローズし、孤立表示を残さない。新規 terminal を開いたときは `terminal_watcher_enabled=true` なら通常 watcher を再表示する
- デバッグ表示は focus 時にデバッグフレームを表示し、`閉じる` ボタンまたはタイトルバー `×` で `watcher-debug` を閉じられる（`Esc` は割り当てない）
- Windows ショートカット（`.lnk`）は既定ターゲットが Node.js の場合に `nodew.exe` を優先し、未検出時は `wscript.exe + *.vbs` の非表示ランチャーへ切替えて余分なウィンドウ表示を抑える（最終フォールバックのみ `node.exe`）

#2. concept との対応
| concept | 実装モジュール | 責務 |
|---|---|---|
| F-1 TerminalStateDetector | `apps/orchestrator/src/terminal_observer.js` | PTY 入出力/終了から terminal 状態を推定 |
| F-2 AgentEventObserver | `apps/orchestrator/src/agent_event_observer.js` + `apps/orchestrator/src-tauri/src/completion_hook.rs` | hook イベントの正規化 |
| F-3 StateIntegrator + ToolJudge | `apps/orchestrator/src/state_integrator.js` + `tool_judge` | 終了候補の判定と状態統合 |
| F-4 Grouping | UI + Orchestrator（将来） | Workspace / Task Group / Pane の整理 |
| F-5 Settings Theme/Responsive | `apps/orchestrator/src/index.html`（settings theme / responsive css） | モノクロテーマ追加と設定画面の崩れ防止 |
| F-6 Context Menu Spawn | `apps/orchestrator/src/index.html` + `open_terminal_window_same_position_for_session` | 右クリックメニューから同位置に新規 terminal を追加 |
| F-7 Selection Handoff | `pickup_terminal_window` + `SelectionState` + `terminal-focus-transition` | 整列済み時のみ非選択 terminal の選択交代と拡大表示を同期（未整列時は focus のみ） |
| F-8 SubWorker Assist | `SubWorkerCoordinator` + terminal local output + settings | モード別支援（入力代行/表示専用アドバイス）と稼働可視化 |
| F-9 Character 3D Prototype | `watcher-debug` window + 3D renderer | Pack 選択済みキャラクターを大きめ透明デバッグ表示で確認する |

#3. I/F 設計
## 3.1 UI → Orchestrator（Tauri Command）
- `start_terminal_session(sessionId, cols, rows)`
- `terminal_send_input(sessionId, text)`
- `terminal_resize(sessionId, cols, rows)`
- `register_terminal_session(sessionId)`
- `set_current_window_title(title)`（Terminal window のネイティブウィンドウタイトルを更新する）
- `open_terminal_window_by_index_same_position(index)`（クリック元の位置/サイズを引き継いで新規 terminal を開く）
- `open_terminal_window_same_position_selected()`（選択中/フォーカス中の terminal の位置/サイズを引き継いで新規 terminal を開く）
- `open_terminal_window_same_position_for_session(sessionId)`（指定 terminal の位置/サイズを引き継いで新規 terminal を開く）
- `is_character_debug_watcher_open(ipc_session_id)`（キャラクターデバッグ表示が開いているか確認する）
- `toggle_character_debug_watcher(ipc_session_id)`（キャラクターデバッグ表示をトグル開閉する）
- `open_character_debug_watcher(ipc_session_id)`（キャラクターデバッグ表示ウィンドウを開く）
- `close_character_debug_watcher(ipc_session_id)`（キャラクターデバッグ表示ウィンドウを閉じる）
- `is_character_debug_watcher_open` / `toggle_character_debug_watcher` がタイムアウトした場合、Frontend は通常 watcher を 3D プレビュー代替として開閉するフォールバックを持つ（既存 watcher 設定は復元する）
- `set_watcher_window_framed(framed, ipc_session_id)`（通常 watcher / `watcher-debug` の native frame を選択状態に合わせて切り替える）
- `resize_watcher_window(width, height, ipc_session_id)`（通常 watcher の UIリサイズハンドル操作時のみ呼ぶ。送信は直列化し、最新サイズのみ適用する）
- `tool_judge(tool, tail)` -> `{ state, summary }`
- `set_subworker_paused(sessionId, paused)`（サブワーカー一時停止/再開）
- `skip_subworker_once(sessionId)`（次回 1 回分のみサブワーカー実行を抑止）

## 3.2 Orchestrator → UI（Tauri Event）
- `terminal-output { session_id, stream, chunk }`
- `terminal-exit { session_id, exit_code }`
- `terminal-error { session_id, message }`
- `completion-hook-state { source, kind, source_session_id?, judge_state?, summary? }`
- `terminal-focus-transition { token, active }`（UI アニメ制御）
- `subworker-decision { session_id, mode, confidence, threshold, action, result, reason }`（判断ログ表示）

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

### SubWorkerCoordinator
- 入力: `session_id, merged_state, judge_complete_event, judge_complete_source, subworker_mode, llm_tool, terminal_context`
- 出力: `assist_action`（`delegate_input` / `show_advice` / `noop`）+ `reason_line`
- 判定: まず `advice_text` と `input_candidate` を生成し、その後に最終適用を決める（`ガンガン/慎重に` は `confidence>=threshold` なら `delegate_input`、未満は `show_advice`）
- 制約: `アドバイス` モードでは `delegate_input` を返さない
- 制約: 起動条件はモードで分けず `judge-complete(success|need_input|failure)` に統一し、モード差は最終適用（自動入力するか）だけで扱う
- 制約: 判定/実行は `session_id` ごとに独立させ、ターミナル間の優先順位競合を持たない
- 制約: `paused=true` のセッションでは `noop`、`skip_once=true` は 1 回だけ `noop` 後に解除する
- 制約: `judge-complete` が `success|need_input|failure` でサブワーカー有効時は、同一サイクルで `start` または `skip(理由付き)` を必ず記録し、未記録放置を禁止する
- 制約: `prompt-hint` 再判定などで `judge-complete` が短時間に連続しても、同一文脈（state/reason/最終入力/最終出力）は 1 回に畳み、重複 `llm-start` を抑止する（`judge_complete_source` は dedup 署名に含めない）
- 制約: `llm_tool=codex` は `ipc_session_id` 単位で subworker 用 Codex セッションIDを保持し、初回は fresh 実行、2 回目以降は resume 実行する。resume 失敗時は保持IDを破棄して fresh を 1 回だけ再試行する
- 制約: ユーザー入力で `codex` 新規起動を検知したときは保持IDをクリアし、`codex resume` 起動を検知したときは保持IDを維持する（サブワーカー側セッションとユーザー側セッションの整合を保つ）
- 制約: `Esc` で `manual-hold` に入ったターンは Judge/SubWorker を停止し、表示ステータスを `idle` としてユーザー入力完了待ちにする。ユーザー `Enter` 確定まで再起動しない（in-flight の結果は適用せず破棄）
- 制約: AI 入力送信後は `await-first-output` ガードを有効化し、最初の **有意な** PTY 出力（prompt断片/`for shortcuts`/`context left` だけのチャンクを除外）受信前に stale tail で Judge を走らせない（長時間無出力時はタイムアウトで解除）
- 記録: `mode/confidence/action/result/reason` を `subworker-decision` として emit する

### JudgeCompletionEventNormalizer
- 入力: `judge-result` / `hook-judge` / `judge-fallback`
- 出力: `{ event: 'judge-complete', source, state, reason }`
- 制約: `state` は `success|need_input|failure` の完了状態のみを通す
- 目的: サブワーカー起動条件を単一化し、fallback 経路でも挙動を分岐させない

### StatusPresentation / Routing
- 状態は `idle/running/need_input/success/failure/disconnected` を **区別して保持**する
- 表示/報告用ステータスは `idle/ai-running/subworker-running/need_input/success/failure` を使い、`running` を用途別に分離する
- 表示/報告用ステータスの優先順位は `subworker-running` > `ai-running` > `running/need_input/success/failure/idle` とする
- `state` / `status_state` / `subworker_phase` と実行時情報（`runtime.subworker` / `runtime.automation`）は単一状態オブジェクト `terminalState` で更新し、独立変数や別状態オブジェクトで持たない
- UI の色は `idle/success=黒`、`running=青`、`need_input=オレンジ`、`failure=赤` で固定
- **処理ルートは状態ごとに分離**する（アイコン/通知/音/ログなどの出し分けは state によって決める）
- `need_input` は `running` 経由でのみ確定する（`idle/success/failure -> need_input` の直行をガードし、一度 `running` を挟んで再評価する）
- 状態遷移の正本は `docs/spec.md` 12.20.2 の遷移マトリクスを参照する（実装差異が出た場合は spec を先に更新する）
- codex の hook 未到達時は prompt marker（`for shortcuts` など）を補助信号として扱い、短時間安定後に `need_input` へ補助遷移する（誤検知抑制のため settle 時間を設ける）
- prompt marker 補助遷移の直後は `prompt-hint` 理由で Judge を即時実行し、状態確定を `judge-result` / `hook-judge` へ収束させる（Judge 実行中/間隔ガード時は短時間リトライで取りこぼしを防ぐ）
- `await-first-output` 保留中は `prompt-hint` を起動しない（有意出力を受けるまで待機）
- codex 起動入力の取りこぼし時は output marker（`for shortcuts` / `context left`）で agent セッションを `running` に補助昇格し、`running` 固着を避ける
- SubWorker 稼働中は状態色レイヤーの上に緑の稼働オーバーレイ（`サブワーカー処理中（Escで抜けます）`）を重ね、稼働終了時に解除する
- SubWorker 稼働中は表示ステータスを `subworker-running` に切り替え、未稼働時の `running` は `ai-running` として扱う
- SubWorker の状態は右上固定パネルを常時表示せず、稼働中のみ緑バナーで可視化する（完了後は即時非表示）
- SubWorker は Settings > AI Coding Agent の `サブワーカーON/OFF` で有効化を制御する（OFF 時は判定/実行を止める）
- SubWorker の補助ログは `サブワーカーデバッグON/OFF` で制御し、OFF 時は通常のアドバイス/代理入力出力のみ表示する
- SubWorker の `show_advice` は表示専用だが、状態は `need_input` として扱う
- SubWorker の再判定は state が変化したタイミングに限定し、同一 state の観測更新では再実行しない
- SubWorker の起動条件は論理イベント `judge-complete` のみとし、`judge-result` / `hook-judge` / `judge-fallback` を同等ソースとして扱う
- prompt marker などの補助遷移では直接起動せず、`judge-complete` 後にのみ起動判定を行う
- 「操作が固まった」診断時は `status_debug_events.jsonl` を一次情報とし、`manual-hold` / `await-first-output` / `judge-complete未到達` の3系統で切り分ける

### AdviceDisplayChannel
- 入力: SubWorker の `show_advice` 判定結果
- 出力: Terminal 本文への表示専用ローカル出力（`[nagomi-subworker(自信度：xxx　アドバイス/代理入力)] (メッセージ)`）
- 制約: PTY input/output とは別チャネルで扱い、`terminal_send_input` を呼ばない
- 表示: サブワーカー進行中は緑オーバーレイで可視化し、完了時に Terminal 表示へ 1 行表示する（スクロールバックに残さない一時表示でよい。アドバイス時は「次に何を入力するか」、代行時は入力内容）
- 文脈: アドバイス生成時は `ユーザー最終入力` と `最後の出力` を両方参照して文面を作る
- 可読性: 端末幅依存で読みづらくならないよう、出力は過長 1 行を抑制する
- 入力連携: ghost 補完は入力行の薄色プレースホルダとして表示し、`Tab` は補完確定、`Tab` 以外のキーは ghost を解除して通常入力へ流す
- 入力連携: `agentWorkActive` / `await-first-output` 中は補完プレースホルダを描画しない（PTY本文出力を優先）

### ToolJudgeRunner
- 入力: `tool` と `tail`（末尾 1500 字 + 50 行）
- 出力: `success/failure/need_input`

### CompletionHook
- `start(on_event)` / `stop()`
- `source_session_id` を伝播して関連付け（PTY セッションと hook を結びつける）

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
3) 終了候補（hook completed/error/need_input or 30s idle, prompt-hint）→ ToolJudgeRunner（失敗時は fallback）
4) Judge 完了結果（judge/fallback）→ JudgeCompletionEventNormalizer（`judge-complete` + source）
5) StateIntegrator（`need_input` は `running` 経由ガード適用）→ UI（Watcher/tint）
6) UI は state-to-color マップ（`idle/success=黒`、`running=青`、`need_input=オレンジ`、`failure=赤`）を単一経路で適用する
7) `judge-complete` + state + mode + selected AI Coding Agent → SubWorkerCoordinator → `delegate_input` or `show_advice` or `skip`
8) 緑の稼働オーバーレイを適用/解除する
9) `show_advice` は Terminal 本文の表示専用ローカル出力へ追記し、PTY I/O へは流さない
10) `subworker-decision` / `subworker-debug-events` を監査ログへ保存し、`start/skip/result` と理由を後追い参照可能にする
11) デバッグ表示は `open_character_debug_watcher` で `watcher-debug` を開き、通常 Watcher と同じ `terminal-aggregate-state` を受信して状態同期する。native frame は通常 watcher / `watcher-debug` とも `set_watcher_window_framed` で focus/blur に合わせて制御する。終了操作は `close_character_debug_watcher`（UIボタン）またはタイトルバー `×` で行う

#5. ストレージ
- `settings.json`: 通知/AI判定/Terminal 設定を保存
- 状態デバッグログ: `AppData/Roaming/com.kitfactory.nagomi/status_debug_events.jsonl`
- サブワーカーデバッグログ: `AppData/Roaming/com.kitfactory.nagomi/subworker_debug_events.jsonl`
- サブワーカー入出力ログ: `AppData/Roaming/com.kitfactory.nagomi/subworker_io_events.jsonl`

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
- `subworker_mode`（`gangan` / `careful` / `advice`）
- `subworker_confidence_threshold`（入力代行可否の自信度閾値）
- 運用操作UI（Settings > AI Coding Agent）: `一時停止` / `今回だけスキップ`（状態はセッション内で保持）

## 6.1 Windows Terminal 起動コマンド
- `terminal_shell_kind=cmd` -> `cmd.exe`
- `terminal_shell_kind=powershell` -> `powershell.exe`
- `terminal_shell_kind=wsl` かつ `terminal_wsl_distro` 空 -> `wsl.exe`
- `terminal_shell_kind=wsl` かつ `terminal_wsl_distro` 指定 -> `wsl.exe -d <distro>`

#7. エラー処理
- 不正な NDJSON type は無視
- tool_judge 失敗時は heuristic にフォールバック
- hook 正規化失敗は警告/無視
- subworker 支援生成に失敗した場合は入力代行を行わず、表示専用アドバイス（失敗通知）か `noop` にフォールバック

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
- `terminal_shell_kind`（`cmd` / `powershell` / `wsl`）で Windows の terminal 起動コマンドを切替可能

#9. セキュリティ
- ログマスク規則は `docs/spec.md` に従う
- AI判定 OFF の場合は外部送信しない

#10. 観測/デバッグ
- `terminal-output-broadcast`（任意）
- `status_debug_events.jsonl`（state/judge/hook/watcher 系）
- `subworker_debug_events.jsonl`（mode/confidence/action/result/reason）
- `subworker_io_events.jsonl`（subworker 入出力）

#11. E2E
- tauri-driver を用いた UI/E2E
- codex hook 統合テスト（`apps/orchestrator/e2e/codex.hook.e2e.js`）

#12. スコープ境界
- P0 は Windows のみ
- WSL Worker / Linux/macOS は非対象

#13. CLI
- `nagomi.exe` / `nagomi`（launcher）
- 連続起動は terminal window を追加で開く
- `nagomi shortcut` は Windows 専用で `.lnk` を生成する（Desktop / Start Menu / 任意パス）
- `nagomi shortcut` の既定ターゲット解決は `nodew.exe` 優先、未検出時は `wscript.exe + *.vbs` で非表示起動、`--target` 指定時は指定ターゲットをそのまま採用する
