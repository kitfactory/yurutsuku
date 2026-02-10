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
| F-6 | Double Click Spawn | 同位置に新規ターミナルを即追加できない | UC-6 |
| F-7 | Selection Handoff | 非選択ターミナル選択時の交代/拡大が未整列時にも発火し、体験が不安定になる | UC-7 |

#6. Use Cases
| ID | 名前 | 対象 | 前提 | トリガ | 結果 | 備考 |
|---|---|---|---|---|---|---|
| UC-1 | ターミナル状態の観測 | PTY | input/output/exit を取得 | 出力/終了/沈黙 | 状態が更新される | exit を優先 | 
| UC-2 | AI ツール完了の観測 | Hook | フック通知が取得できる | completed/error/need_input | 状態が更新される | tool に依存 | 
| UC-3 | Stream + Hook 統合判定 | UI | UC-1/UC-2 が有効 | 終了候補 | success/failure/need_input が確定 | Judge を使用 | 
| UC-4 | 並列作業の整理 | UI | 複数ターミナル | ペイン増加 | グループ化/状態集約 | CWD/タグ利用 | 
| UC-5 | 設定画面の安定操作 | Settings UI | 画面幅が変化する | リサイズ | 項目が潰れず編集継続できる | 1列/2列を自動切替 |
| UC-6 | 同位置での新規端末追加 | Run UI / Terminal UI | 既存ターミナルあり | タイルまたは Terminal 本文のダブルクリック | クリック元位置に新規端末を開く | 既存の単クリック操作は維持 |
| UC-7 | 選択対象の交代 | Run UI / Terminal UI | 複数ターミナルあり | 非選択ターミナルの選択操作 | 選択対象を交代する（整列済み時のみ拡大表示） | 未整列（起動直後/ドラッグ移動/リサイズ/ウィンドウ増減）時は focus のみ更新 |

#7. Goals
- G-1: 終了/入力待ちを **30 秒以内**に気づける
- G-2: Stream/Hook を統合して誤判定を減らす
- G-3: 状態を最小 UI で明確に伝える
- G-4: 並列作業を迷子にしない
- G-5: 設定画面と Run 操作の UX を崩さず、実運用中でも編集/追加を止めない

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

#10. Implementation Order
1. TerminalStateDetector
2. CompletionHook / AgentEventObserver
3. StateIntegrator + ToolJudge
4. UI tint / Watcher
5. Overview（Run 相当）
6. Settings（モノクロテーマ + レスポンシブ安定化）
7. Run タイル/Terminal 本文（ダブルクリックで同位置新規端末）
8. 非選択ターミナルの選択交代（選択同期 + 拡大表示）

#11. Glossary
- nagomi: 複数ターミナルの観測と状態表示を行うアプリ
- Orchestrator: 状態統合の中核
- Worker: PTY を起動して入出力を扱う
- HookEvent: フック通知の正規化イベント
- Judge: 終了候補を success/failure/need_input に判定する機構
