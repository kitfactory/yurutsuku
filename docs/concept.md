# concept.md（入口）

この文書は `docs/OVERVIEW.md` を前提に、P0 の **最小コンセプト**を整理する。

---

#1. Overview - What/Why/Who/When/Where
- What: nagomi Terminal で **複数ターミナルの状態（実行/入力待ち/完了/失敗）を観測・統合し、ひと目で分かる**体験を作る
- Why: 並列作業中に「どれが止まっているか」「どれが入力待ちか」が見えず、待ちや見落としが発生する
- Who: ローカル開発者（Windows + ターミナル中心）
- When/Where: nagomi Terminal（Tauri）内。Watcher/Observer を通じて状態表示する
- Outputs: Pane/Job の状態、Watcher 表情、tint による視覚フィードバック
- Assumptions: Windows P0、ConPTY、CLI エージェント（codex/claudecode/opencode）のフック取得が可能

#2. Main Pain
- 複数ターミナルの完了/入力待ちを見落とす
- AI ツールの完了検知が遅れて作業が止まる
- 出力量が多く、人間がログを追い切れない
- 設定画面のリサイズで項目が潰れると、実運用中の設定変更が止まる
- Run のタイル操作で「同じ場所に新しいターミナルを増やす」導線が弱い

#3. Target & Assumptions
- Windows 10/11 + nagomi Terminal
- PTY は表示と入力転送に使い、状態確定には使わない
- フック通知（JSON）を取得可能
- Codex / ClaudeCode / OpenCode は hook 完了で状態確定する

#4. 技術/構成（P0）
- UI: Tauri + HTML/TypeScript + xterm.js
- Orchestrator: Rust
- PTY: ConPTY
- Hook: codex / claudecode / opencode
- HookNormalizer: hook `kind` を `success/failure/need_input` へ正規化する

#5. Features
| ID | 機能 | 解決する Pain | 対応 UC |
|---|---|---|---|
| F-1 | TerminalTransport（PTY 入出力の表示/転送） | ターミナル表示と入力転送が不安定になる | UC-1 |
| F-2 | AgentEventObserver（CompletionHook） | AI ツールの完了/入力待ちが分からない | UC-2 |
| F-3 | HookStateProjector | hook 完了だけで一貫した状態機械へ投影できない | UC-3 |
| F-4 | Workspace/Task Group/Pane | 並列作業の整理ができない | UC-4 |
| F-5 | Settings Theme/Responsive | テーマ選択や設定編集が画面幅に依存して崩れる | UC-5 |
| F-6 | Shift Double Click Spawn | 同位置に新規ターミナルを即追加できない | UC-6 |
| F-7 | Selection Handoff | 非選択ターミナル選択時の交代/拡大が未整列時にも発火し、体験が不安定になる | UC-7 |
| F-8 | SubWorker Assist | 入力待ち/完了後に次アクションが止まり、手作業の判断と入力コストが増える | UC-8 |
| F-9 | Character 3D Prototype | 2D固定だとキャラクター追加/調整ができない | UC-9 |

#6. Use Cases
| ID | 名前 | 対象 | 前提 | トリガ | 結果 | 備考 |
|---|---|---|---|---|---|---|
| UC-1 | ターミナル表示と入力転送 | PTY | input/output を取得 | 出力/入力 | Terminal 表示と入力転送が継続する | 状態確定は行わない | 
| UC-2 | AI ツール完了の観測 | Hook | フック通知が取得できる | completed/error/need_input | 状態が更新される | tool に依存 | 
| UC-3 | Hook 状態投影 | UI | UC-2 が有効 | hook completed|error|need_input | success/failure/need_input が確定 | hook を唯一の正本とする | 
| UC-4 | 並列作業の整理 | UI | 複数ターミナル | ペイン増加 | グループ化/状態集約 | CWD/タグ利用 | 
| UC-5 | 設定画面の安定操作 | Settings UI | 画面幅が変化する | リサイズ | 項目が潰れず編集継続できる | 1列/2列を自動切替 |
| UC-6 | 同位置での新規端末追加 | Run UI / Terminal UI | 既存ターミナルあり | Terminal 本文で `Shift + ダブルクリック` する | クリック元位置に新規端末を開く | 既存の単クリック操作は維持 |
| UC-7 | 選択対象の交代 | Run UI / Terminal UI | 複数ターミナルあり | 非選択ターミナルの選択操作 | 選択対象を交代する（整列済み時のみ拡大表示） | 未整列（起動直後/ドラッグ移動/リサイズ/ウィンドウ増減）時は focus のみ更新 |
| UC-8 | サブワーカー支援 | SubWorker / Terminal UI | AI Coding Agent が設定済み | `hook-complete(success/need_input/failure)`（モード共通起動） | 入力代行または表示専用アドバイスで次アクションを提示する | 稼働中は緑表示で可視化し、完了/アドバイスは Terminal 表示へ 1 行表示する（スクロールバックに残さない一時表示でよい。右上固定パネルや別表示欄は出さない）。`hook-complete=success|need_input|failure` で有効時は `start` または `skip(理由付き)` を必ず記録し、放置しない。アドバイスは「次に何を入力するか」を1行で明示し、代行時は入力内容を表示して実行する。表示は `[nagomi-subworker(自信度：xxx　アドバイス/代理入力)] (メッセージ)` 形式を使い、アドバイス生成は `ユーザー最終入力` と `最後の出力` を参照する。サブワーカー判断は LLM に定型 JSON（`action/confidence/input/advice_markdown/reason`）を問い合わせて決め、まずアドバイス本文+入力候補を作ってから最終適用を決める（`ガンガン/慎重に` は閾値判定で自動入力、`アドバイス` は常に表示）。プロンプトは Settings のテンプレで調整できる。Codex 利用時は初回 fresh 実行、2 回目以降は同一 `ipc_session_id` に紐づくセッションIDで resume して文脈継続する（resume 失敗時は fresh にフォールバック）。さらにユーザーが `codex` 新規起動した場合は保持IDをクリアし、`codex resume` 起動時は保持IDを維持する。同一 state の観測更新では再判定しない。制御状態は `terminalState`（`unified.subworker_phase(idle/running/paused)` と `runtime.subworker` / `runtime.automation`）を正本とし、`ON/OFF` / `サブワーカーデバッグON/OFF` / `一時停止/今回だけスキップ` は Settings から操作する（アドバイス表示時は `need_input` として扱う） |
| UC-9 | 3Dキャラクターパック管理 | Settings UI / Watcher | キャラクター表示機能が有効 | Pack 追加（`.vrm` 起点）/Pack 選択/`scale/yaw` 調整/固定モーション選択/トリガー再生/デバッグ表示起動 | `pack.json` 正本でモデル/モーション/表情メタデータを保持し、Watcher が常時 3D表示へ切り替わる。モーションデバッグ操作は watcher へ即時反映される | ターミナルキャラクター表示は既定 ON とし、通常 watcher に renderer 切替 UI は持たない。選択中VRMが未設定または読込失敗時は組み込み3D Pack またはプロトタイプ3Dへ寄せる。透明 watcher window は通常 watcher / `watcher-debug` とも native + UI フレームを選択状態（focus または pointer inside）で表示し、非選択時は隠す。3D読込は同一要求を畳み、描画は低負荷モードで応答性を優先する。`watcher-debug` は大きめプレビューとして併用する。プロトタイプ表現の既定は `neutral=軽い微笑み` / `waiting=あくび` / `need_user=手を振る` / `processing=考え中（腕組み+顎に手）`。終了は `閉じる` ボタンまたはタイトルバー `×` を使い、`Esc` は使わない |

#7. Goals
- G-1: hook 完了後すぐに終了/入力待ちへ気づける
- G-2: 入力確定と hook のみで状態機械を単純に保つ
- G-3: 状態を最小 UI で明確に伝える
- G-4: 並列作業を迷子にしない
- G-5: 設定画面と Run 操作の UX を崩さず、実運用中でも編集/追加を止めない
- G-6: 色付き状態表示（`idle/success=黒`、`need_input=オレンジ`、`failure=赤`、`subworker-running=緑オーバーレイ`）と hook-only 状態遷移を常に一致させる
- G-7: サブワーカー支援を追加しても、実際のターミナルI/O境界（実行入力）と表示専用アドバイス境界を崩さない
- G-8: サブワーカー判断をユーザーが追える（モード/自信度/理由/結果）状態を維持し、ワンクリックで停止・スキップできる

#8. Layering
| レイヤー | 役割 | 主なモジュール |
|---|---|---|
| UI | 表示と操作 | Terminal / Watcher / Settings |
| Orchestrator | 状態統合 | Hook / HookNormalizer / Projector |
| Worker | PTY 実行 | ConPTY + Process |
| Protocol | 送受信 | NDJSON |
| Storage | 設定 | settings.json |

#9. Key Data Classes
| データ | 主な属性 | 対応 | 
|---|---|---|
| Pane | id, state, last_activity_at | UC-1/UC-3 |
| Job | id, pane_id, tool, state | UC-2/UC-3 |
| HookEvent | source, kind, ts_ms, source_session_id | UC-2 |
| HookCompletion | state, summary | UC-3 |
| SubWorkerTask | pane_id, mode, status, action, started_at | UC-8 |

#10. Implementation Order
1. TerminalTransport
2. CompletionHook / AgentEventObserver
3. HookStateProjector
4. UI tint / Watcher
5. Overview（Run 相当）
6. Settings（モノクロテーマ + レスポンシブ安定化）
7. Terminal `Shift + ダブルクリック`（同位置で新規端末）
8. 非選択ターミナルの選択交代（選択同期 + 拡大表示）
9. SubWorker（入力代行/表示専用アドバイス、稼働中緑表示、モード別動作）

#11. Glossary
- nagomi: 複数ターミナルの観測と状態表示を行うアプリ
- Orchestrator: 状態統合の中核
- Worker: PTY を起動して入出力を扱う
- HookEvent: フック通知の正規化イベント
- HookNormalizer: hook `kind` を success/failure/need_input に写像する機構
- subworker: 設定済み AI Coding Agent を使って次アクションを補助する支援実行主体
- advice display line: Terminal 表示上の 1 行アドバイス（実際の PTY 入出力には流さない。スクロールバックに残さない一時表示でよい）
