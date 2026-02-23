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
- PTY の input/output/exit を取得可能
- フック通知（JSON）を取得可能
- 30s 無出力を「終了候補」として扱う

#4. 技術/構成（P0）
- UI: Tauri + HTML/TypeScript + xterm.js
- Orchestrator: Rust
- PTY: ConPTY
- Hook: codex / claudecode / opencode
- Judge: LLM 判定（JSON 出力）+ heuristic フォールバック

#5. Features
| ID | 機能 | 解決する Pain | 対応 UC |
|---|---|---|---|
| F-1 | TerminalStateDetector（PTY 入出力/終了の観測） | ターミナルの状態が追えない | UC-1 |
| F-2 | AgentEventObserver（CompletionHook） | AI ツールの完了/入力待ちが分からない | UC-2 |
| F-3 | StateIntegrator + ToolJudge | 端末/フックを統合して判定できない | UC-3 |
| F-4 | Workspace/Task Group/Pane | 並列作業の整理ができない | UC-4 |
| F-5 | Settings Theme/Responsive | テーマ選択や設定編集が画面幅に依存して崩れる | UC-5 |
| F-6 | Context Menu Spawn | 同位置に新規ターミナルを即追加できない | UC-6 |
| F-7 | Selection Handoff | 非選択ターミナル選択時の交代/拡大が未整列時にも発火し、体験が不安定になる | UC-7 |
| F-8 | SubWorker Assist | 入力待ち/完了後に次アクションが止まり、手作業の判断と入力コストが増える | UC-8 |
| F-9 | Character 3D Prototype | 2D固定だとキャラクター追加/調整ができない | UC-9 |

#6. Use Cases
| ID | 名前 | 対象 | 前提 | トリガ | 結果 | 備考 |
|---|---|---|---|---|---|---|
| UC-1 | ターミナル状態の観測 | PTY | input/output/exit を取得 | 出力/終了/沈黙 | 状態が更新される | exit を優先 | 
| UC-2 | AI ツール完了の観測 | Hook | フック通知が取得できる | completed/error/need_input | 状態が更新される | tool に依存 | 
| UC-3 | Stream + Hook 統合判定 | UI | UC-1/UC-2 が有効 | 終了候補 | success/failure/need_input が確定 | Judge を使用 | 
| UC-4 | 並列作業の整理 | UI | 複数ターミナル | ペイン増加 | グループ化/状態集約 | CWD/タグ利用 | 
| UC-5 | 設定画面の安定操作 | Settings UI | 画面幅が変化する | リサイズ | 項目が潰れず編集継続できる | 1列/2列を自動切替 |
| UC-6 | 同位置での新規端末追加 | Run UI / Terminal UI | 既存ターミナルあり | Terminal 本文の右クリックメニューで `新しいターミナルを開く` を選ぶ | クリック元位置に新規端末を開く | 既存の単クリック操作は維持 |
| UC-7 | 選択対象の交代 | Run UI / Terminal UI | 複数ターミナルあり | 非選択ターミナルの選択操作 | 選択対象を交代する（整列済み時のみ拡大表示） | 未整列（起動直後/ドラッグ移動/リサイズ/ウィンドウ増減）時は focus のみ更新 |
| UC-8 | サブワーカー支援 | SubWorker / Terminal UI | AI Coding Agent が設定済み | `judge-complete(success/need_input/failure)`（モード共通起動） | 入力代行または表示専用アドバイスで次アクションを提示する | 稼働中は緑表示で可視化し、完了/アドバイスは Terminal 表示へ 1 行表示する（スクロールバックに残さない一時表示でよい。右上固定パネルや別表示欄は出さない）。`judge-complete` は `judge-result/hook-judge/judge-fallback` を統合する。`judge-complete=success|need_input|failure` で有効時は `start` または `skip(理由付き)` を必ず記録し、放置しない。アドバイスは「次に何を入力するか」を1行で明示し、代行時は入力内容を表示して実行する。表示は `[nagomi-subworker(自信度：xxx　アドバイス/代理入力)] (メッセージ)` 形式を使い、アドバイス生成は `ユーザー最終入力` と `最後の出力` を参照する。サブワーカー判断は LLM に定型 JSON（`action/confidence/input/advice_markdown/reason`）を問い合わせて決め、まずアドバイス本文+入力候補を作ってから最終適用を決める（`ガンガン/慎重に` は閾値判定で自動入力、`アドバイス` は常に表示）。プロンプトは Settings のテンプレで調整できる。Codex 利用時は初回 fresh 実行、2 回目以降は同一 `ipc_session_id` に紐づくセッションIDで resume して文脈継続する（resume 失敗時は fresh にフォールバック）。さらにユーザーが `codex` 新規起動した場合は保持IDをクリアし、`codex resume` 起動時は保持IDを維持する。同一 state の観測更新では再判定しない。制御状態は `terminalState`（`unified.subworker_phase(idle/running/paused)` と `runtime.subworker` / `runtime.automation`）を正本とし、`ON/OFF` / `サブワーカーデバッグON/OFF` / `一時停止/今回だけスキップ` は Settings から操作する（アドバイス表示時は `need_input` として扱う） |
| UC-9 | 3Dキャラクターパック管理 | Settings UI / Watcher | キャラクター表示機能が有効 | Pack 追加（`.vrm` 起点）/Pack 選択/`scale/yaw` 調整/デバッグ表示起動 | `pack.json` 正本でモデル/モーション/表情メタデータを保持し、Watcher が 3D表示へ切り替わる | VRM 未設定や読み込み失敗時は 2D 表示へフォールバック。組み込み Pack（Nikechan）とユーザー Pack を統合表示する。透明 watcher window は通常 watcher / `watcher-debug` とも native + UI フレームを選択状態（focus または pointer inside）で表示し、非選択時は隠す。3D読込は同一要求を畳み、描画は低負荷モードで応答性を優先する。`renderer=3d` かつ VRM 設定済みなら通常 watcher でも 3D を表示し、`watcher-debug` は大きめプレビューとして併用する。終了は `閉じる` ボタンまたはタイトルバー `×` を使い、`Esc` は使わない |

#7. Goals
- G-1: 終了/入力待ちを **30 秒以内**に気づける
- G-2: Stream/Hook を統合して誤判定を減らす
- G-3: 状態を最小 UI で明確に伝える
- G-4: 並列作業を迷子にしない
- G-5: 設定画面と Run 操作の UX を崩さず、実運用中でも編集/追加を止めない
- G-6: 色付き状態表示（`idle/success=黒`、`running=青`、`need_input=オレンジ`、`failure=赤`）と状態遷移（`idle/success/failure -> need_input` 直行禁止）を常に一致させる
- G-7: サブワーカー支援を追加しても、実際のターミナルI/O境界（実行入力）と表示専用アドバイス境界を崩さない
- G-8: サブワーカー判断をユーザーが追える（モード/自信度/理由/結果）状態を維持し、ワンクリックで停止・スキップできる

#8. Layering
| レイヤー | 役割 | 主なモジュール |
|---|---|---|
| UI | 表示と操作 | Terminal / Watcher / Settings |
| Orchestrator | 状態統合 | Detector / Hook / Judge / Integrator |
| Worker | PTY 実行 | ConPTY + Process |
| Protocol | 送受信 | NDJSON |
| Storage | 設定 | settings.json |

#9. Key Data Classes
| データ | 主な属性 | 対応 | 
|---|---|---|
| Pane | id, state, last_activity_at | UC-1/UC-3 |
| Job | id, pane_id, tool, state | UC-2/UC-3 |
| HookEvent | source, kind, ts_ms, source_session_id | UC-2 |
| JudgeResult | state, summary | UC-3 |
| SubWorkerTask | pane_id, mode, status, action, started_at | UC-8 |

#10. Implementation Order
1. TerminalStateDetector
2. CompletionHook / AgentEventObserver
3. StateIntegrator + ToolJudge
4. UI tint / Watcher
5. Overview（Run 相当）
6. Settings（モノクロテーマ + レスポンシブ安定化）
7. Terminal 右クリックメニュー（同位置で新規端末）
8. 非選択ターミナルの選択交代（選択同期 + 拡大表示）
9. SubWorker（入力代行/表示専用アドバイス、稼働中緑表示、モード別動作）

#11. Glossary
- nagomi: 複数ターミナルの観測と状態表示を行うアプリ
- Orchestrator: 状態統合の中核
- Worker: PTY を起動して入出力を扱う
- HookEvent: フック通知の正規化イベント
- Judge: 終了候補を success/failure/need_input に判定する機構
- running gate: `need_input` 確定前に一度 `running` を経由させる遷移ガード
- subworker: 設定済み AI Coding Agent を使って次アクションを補助する支援実行主体
- advice display line: Terminal 表示上の 1 行アドバイス（実際の PTY 入出力には流さない。スクロールバックに残さない一時表示でよい）
