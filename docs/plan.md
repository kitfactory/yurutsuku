# Plan (current / future)

入口は `docs/OVERVIEW.md`。このファイルは **current / future** を管理する（完了/履歴は `docs/plan.archive.md` = archive）。

---

## 運用ルール（必須）
- 各項目は **「実装 → すぐテスト（確認） → チェック更新」** の順で進める
- テスト（確認）の種類は最小でよい（P0）
  - docs 変更: 自己レビュー（矛盾/用語/リンク）
  - UI 変更: `cargo build -p nagomi-orchestrator` → E2E/目視確認
  - Rust 変更: `cargo test -p nagomi-orchestrator`（可能なら）

---

## 目的（P0 / Windows）
nagomi の中核である「複数ターミナル並列作業」を、観測ベースで **分かりやすく・壊れにくく**する。

- `nagomi.exe` を起動すると、**ターミナルアプリを開いたのと同じ感覚**で Terminal が 1 枚開く
- Watcher（右下キャラ＋tint）で、状態（Running/NeedInput/Success/Fail）が一目で分かる
- Overview（タイル一覧 / Run相当）は起動可能にするが、優先度は下げる

---

## current（P0）
対象: N-6〜N-12（選択切替 / アニメ高速化 / タイトル表示改善 / `:ng` 内蔵コマンド / AI 状態判定 / Windows ショートカット / サブワーカー）

### N-6 選択切替（非選択ターミナルを選んだときの交代 + 拡大表示）
- [x] N-6.1 文書: 選択切替ルール（どの操作で選択が交代するか、選択時の拡大条件）を `docs/concept.md` / `docs/spec.md` / `docs/architecture.md` に反映する
- [x] N-6.1 テスト: docs の記述が一意で矛盾しない（自己レビュー）
- [x] N-6.2 実装: 非選択ターミナルをユーザーが選んだとき、SelectionState を更新して選択ウィンドウとして拡大表示する（Run/Terminal の両導線）
- [x] N-6.2 テスト: 選択交代と拡大表示が期待どおりに動作し、既存の `focus next/prev` と競合しない（`cargo test -p nagomi-orchestrator` / `npm test -w apps/orchestrator -- --test-reporter=spec`）

### N-7 選択ウィンドウ交代アニメーション高速化
- [x] N-7.1 文書: フォーカス切替アニメーションの速度方針（体感目標/上限/下限）を `docs/spec.md` / `docs/architecture.md` に反映する
- [x] N-7.1 テスト: docs の記述が一意で矛盾しない（自己レビュー）
- [x] N-7.2 実装: 選択ウィンドウ交代時の縮小→拡大アニメーションを高速化し、過剰な残像やジャンプを抑える
- [x] N-7.2 テスト: 連続交代時でも体感遅延が改善し、位置/サイズ遷移が破綻しない（`cargo test -p nagomi-orchestrator` / 目視E2E）

### N-8 タイトル表示改善（CWDベース）
- [x] N-8.1 文書: タイトル表示ルール（通常は末尾フォルダ名、`src` / `docs` / `tests` 等は2階層表示）を `docs/spec.md` / `docs/architecture.md` に反映する
- [x] N-8.1 テスト: docs の記述が一意で矛盾しない（自己レビュー）
- [x] N-8.2 実装: ターミナルウィンドウタイトルを CWD ベースで更新し、汎用名ディレクトリは `project/src` 形式で表示する
- [x] N-8.2 テスト: CWD 変化に追従してタイトルが更新され、汎用名ルールが適用される（`cargo test -p nagomi-orchestrator` / `npm test -w apps/orchestrator -- --test-reporter=spec`）

### N-9 内蔵特殊コマンド（`:ng`）
- [x] N-9.1 文書: `:ng` を **UI 内蔵コマンド層**で扱う I/F（文法、PTY非送信、ローカル表示、エラー応答、権限境界）とロールバックポイントを `docs/spec.md` / `docs/architecture.md` / `docs/OVERVIEW.md` に反映する
- [x] N-9.1 テスト: docs の記述が一意で矛盾しない（自己レビュー）
- [x] N-9.2 実装: `apps/orchestrator/src/index.html` に `:ng` の Frontend Internal Command Layer を実装する（入力中表示/Enter実行/`ping` 応答）
- [x] N-9.2 テスト: `:ng` を打ち始めた時点で文字が見え、` :ng ping ` が即時 `pong` を返すことを確認する（PTY漏れなし）
- [x] N-9.3 実装: ロールバックポイント RP-1/RP-2 を実装する（内蔵層の無効化で全面パススルーへ戻せる）
- [x] N-9.3 テスト: ロールバック有効時に `:ng` が通常シェル入力として動作し、入力不能/重複入力が再発しないことを確認する
- [x] N-9.4 実装: Rust 側の `:ng` 専用インターセプトを撤去し、`terminal_send_input` を通常パススルー中心へ整理する
- [x] N-9.4 テスト: `cargo test -p nagomi-orchestrator` / `npm test -w apps/orchestrator -- --test-reporter=spec` と目視確認で回帰がないことを確認する

### N-10 AI 状態判定（ターミナル色付け）正確性確認
- [x] N-10.1 文書: 状態遷移と色対応（`idle/success=黒`、`running=青`、`need_input=オレンジ`、`failure=赤`、`idle/success/failure -> need_input` 直行禁止）を `docs/concept.md` / `docs/spec.md` / `docs/architecture.md` / `docs/tauri-driver-e2e.md` に反映する
- [x] N-10.1 テスト: docs の記述が一意で矛盾しない（自己レビュー）
- [x] N-10.2 実装: 観測イベント→状態遷移→tint/watcher 反映の経路を整理し、遷移漏れ/色反映漏れを防ぐ
- [x] N-10.2 テスト: `cargo test -p nagomi-orchestrator` / `npm test -w apps/orchestrator -- --test-reporter=spec` / 目視E2Eで `running -> need_input -> running -> success/failure` が色と一致することを確認する
- [x] N-10.3 実装: 誤判定時に追跡できるよう、P0最小のデバッグ可視化（遷移イベントと確定state）を追加する
- [ ] N-10.3 テスト: `:ng` 有効/無効、codex 通常入力、通常コマンド（`echo` / `dir` / 異常終了）で state と色が一致することを確認する
- [x] N-10.4 実装: Codex 実問合せシナリオ（`今の日本の総理大臣は？`）を E2E として追加し、状態遷移/色クラス/hook/出力を時系列採取できるようにする
- [x] N-10.4 テスト: `running -> success` の瞬間黒化（`blue -> black`）を実測で再現し、`hook completed` 経路の修正後に同シナリオで再発しないことを確認する
- [x] N-10.6 テスト: `codex` 起動（コマンドのみ）では `idle` を維持し、初回指示送信後のみ `ai-running`/Judge/`need_input` が発生することを E2E で検証する（`apps/orchestrator/e2e/codex.prime-minister.e2e.js`）
- [x] N-10.5 実装: IME 変換中（`isComposing` / `keyCode=229`）の Enter は入力確定扱いにせず、`running` への誤遷移（入力途中で running 化）を防ぐ
- [x] N-10.5 テスト: `npm test -w apps/orchestrator` で IME ガード（統合テスト）が通ることを確認する

### N-11 Windows ショートカット起動時の余分なウィンドウ抑止
- [x] N-11.1 文書: Windows ショートカット起動時のランチャー経路（コンソール非表示の方針、失敗時フォールバック）を `docs/spec.md` / `docs/architecture.md` に反映する
- [x] N-11.1 テスト: docs の記述が一意で矛盾しない（自己レビュー）
- [x] N-11.2 実装: `nagomi shortcut` が生成する `.lnk` の起動ターゲットを見直し、ショートカット起動時に余分なランチャー/コンソールウィンドウが表示されないようにする
- [x] N-11.2 テスト: Desktop ショートカット起動で余分なウィンドウが出ないこと、`--session-id` 指定と通常起動の両方が維持されることを確認する

### N-12 サブワーカー機能（future より先行）
- [x] N-12.1 文書: サブワーカー要件（目的/緑表示/表示専用アドバイス/3モード + 使いやすさ 1-8）を `docs/OVERVIEW.md` / `docs/concept.md` / `docs/spec.md` / `docs/architecture.md` / `docs/tauri-driver-e2e.md` に反映する
- [x] N-12.1 テスト: docs の記述が一意で矛盾しない（自己レビュー）
- [x] N-12.2 実装: サブワーカー稼働中の緑表示（`サブワーカー稼働中`）と終了時の状態表示復帰を実装する
- [x] N-12.2 テスト: 稼働中のみ緑表示になり、終了後に元の状態色（黒/青/オレンジ/赤）へ戻ることを確認する
- [x] N-12.3 実装: アドバイス表示を Terminal の表示専用レイヤーとして実装し、実コマンド入力/PTY 入出力と分離する
- [x] N-12.3 テスト: アドバイス表示が「次に何を入力するか」を示し、`terminal_send_input` へ混入しないことを確認する
- [x] N-12.4 実装: サブワーカーモード（`ガンガン` / `慎重に` / `アドバイス`）の設定と実行条件を実装する
- [x] N-12.4 テスト: モード別挙動（ガンガン: `success|need_input` の完了時のみ支援し `failure` 完了時は待機、慎重に: 起動条件 `need_input` 限定かつ入力代行後は終了判定に追従、アドバイス: 完了状態 `success|need_input|failure` で入力代行なし+表示時 `need_input`）を確認する
- [x] N-12.5 実装: サブワーカー既定モードを `慎重に` にし、`自信度閾値` 設定を実装する
- [x] N-12.5 テスト: 設定未作成時の既定値が `慎重に` であること、閾値変更で入力代行/アドバイス分岐が変わることを確認する
- [x] N-12.6 実装: サブワーカー進行中は緑表示で可視化し、完了時に `結果（代行/アドバイス）` を Terminal 表示する
- [x] N-12.6 テスト: 複数ターミナル同時表示でも処理中/結果表示が混線せず更新されることを確認する
- [x] N-12.7 実装: 入力代行時の理由 1 行（confidence + 根拠要約）と判断ログ（mode/confidence/action/result）を記録する
- [x] N-12.7 テスト: 1 操作ごとに判断ログが残り、後追いで代行理由が追跡できることを確認する
- [x] N-12.8 実装: サブワーカーの `一時停止` / `今回だけスキップ` を Settings > AI Coding Agent からワンクリックで実行できるUIを追加する
- [x] N-12.8 テスト: 一時停止中は自動支援が止まり、スキップは次の1回のみ抑止して自動復帰することを確認する
- [x] N-12.9 実装: Settings > AI Coding Agent に `サブワーカーON/OFF` と `サブワーカーデバッグON/OFF` を追加し、保存/復元できるようにする
- [x] N-12.9 テスト: ON/OFF の切り替えが永続化され、OFF 時はサブワーカー自動支援（およびデバッグ出力）が停止することを確認する
- [x] N-12.10 実装: サブワーカーのアドバイス/代理入力メッセージを共通フォーマット
  `[nagomi-subworker(自信度：xxx　アドバイス/代理入力)] (メッセージ)` に統一する
- [x] N-12.10 テスト: アドバイス時/代理入力時の両方でフォーマットが一致し、端末幅が狭い場合でも可読性が落ちない（過長行は抑制される）ことを確認する
- [x] N-12.11 実装: アドバイス生成に `ユーザー最終入力` と `最後の出力` を必ず使うようにし、サブワーカー表示がサイズ変更時にも消えにくい経路へ整理する
- [x] N-12.11 テスト: 最終入力/最終出力の文脈に応じてアドバイス文が変化すること、およびリサイズ後も履歴表示から追跡できることを確認する
- [x] N-12.12 文書: サブワーカーの起動条件を「状態遷移時」から「AI状態判定完了時（judge/hook 完了）」へ更新し、`ガンガン` の `failure` 完了時は待機する仕様を `docs/OVERVIEW.md` / `docs/spec.md` に反映する
- [x] N-12.12 実装: サブワーカー起動トリガーを `state-update` から `judge/hook 完了` に変更し、`ガンガン` の `failure` 完了時は起動しないようにする
- [x] N-12.12 テスト: `subworker_ui_and_settings`（統合）と subworker 関連の選択実行テストで新トリガー（judge-result/hook-judge）を確認し、E2E（terminal/tint）で表示回帰がないことを確認する
- [x] N-12.13 実装: `apps/orchestrator/e2e/sandbox/isolated-workdir/` を隔離起動ベースにし、`subworker.matrix.template.e2e.js` でケース行列雛型（`scenario-matrix.template.json`）を生成できるようにする（app_config_dir は `NAGOMI_APP_CONFIG_DIR` で上書きする）
- [x] N-12.13 テスト: 雛型スクリプト実行で隔離 run ディレクトリと `scenario-matrix.template.json` が生成され、`NAGOMI_E2E_ISOLATED_DIR` 指定で `codex.prime-minister.e2e.js` が起動できることを確認する
- [x] N-12.14 文書: 仮想ケース（S1 慎重+アドバイス / S2 慎重+代理入力 / S3 ガンガン+fail待機 / S4 アドバイス専用）に相当するケースを `apps/orchestrator/e2e/subworker.matrix.e2e.js` に定義し、順序アサート（running中禁止・判定完了後起動）を明記する
- [x] N-12.14 実装: `apps/orchestrator/e2e/subworker.matrix.e2e.js` を matrix 実行スクリプトとして整備し、必要な完了イベントをテストフック経由で注入して順序/表示/メッセージを検証する
- [x] N-12.14 テスト: `npm run e2e:subworker:matrix -w apps/orchestrator` を実行し、全ケース `PASS` と report (`apps/orchestrator/tmp-e2e/subworker-matrix-*.json`) を確認する
- [x] N-12.15 文書: トリガー統合方針（prompt marker は補助信号、サブワーカー起動は `judge-result` / `hook-judge` 完了イベントのみ）を `docs/OVERVIEW.md` / `docs/spec.md` / `docs/architecture.md` に明記する
- [x] N-12.15 実装: codex prompt marker 補助遷移後に `prompt-hint` 理由で Judge を即時実行し、サブワーカー起動経路を判定完了イベントへ収束させる
- [x] N-12.15 テスト: `codex_prompt_marker_need_input_fallback` と subworker 関連統合テストで、prompt marker 経路から Judge 呼び出しが行われることと起動条件が `judge-result` / `hook-judge` 限定であることを確認する
- [x] N-12.16 実装: `prompt-hint` Judge が in-flight / 間隔ガードで弾かれた場合に短時間リトライし、`need_input` 表示だけでサブワーカーが止まる取りこぼしを防ぐ
- [x] N-12.16 テスト: `codex_prompt_marker_need_input_fallback` を更新し、`schedulePromptHintJudgeRetry` と `isPromptHintJudge` 分岐の存在を確認する
- [x] N-12.16 文書: `docs/OVERVIEW.md` / `docs/spec.md` / `docs/architecture.md` に prompt-hint の短時間リトライ方針を追記する
- [x] N-12.17 実装: グローバル `nagomi` CLI に `--restart` / `--status` を追加し、Orchestrator 再起動と実行状態確認を明示的に行えるようにする
- [x] N-12.17 テスト: `nagomi --help` / `nagomi --status` で新オプションと JSON ステータス（`orchestrator_path/running/healthy/health_url`、`--status` は起動/停止しない）を確認する
- [x] N-12.17 文書: ランチャー運用（再起動・状態確認）を `docs/OVERVIEW.md` / `docs/spec.md` に反映する
- [x] N-12.17.1 実装: グローバル `nagomi` CLI に `--debug-paths`（app_config_dir とログパス表示）を追加する
- [x] N-12.17.1 テスト: `nagomi --debug-paths` が JSON を表示し、`subworker_debug_events.jsonl` / `status_debug_events.jsonl` のパスが含まれることを確認する
- [x] N-12.17.2 実装: グローバル `nagomi` CLI に `debug-tail`（`status|subworker|terminal` の直近ログ要約表示）を追加する
- [x] N-12.17.2 テスト: `nagomi debug-tail status --n 5` 等でログ末尾が読めることを確認する
- [x] N-12.18 実装: サブワーカー制御の `active/evalInFlight/paused` 複数フラグを `subworkerRuntimePhase`（`idle/running/paused`）へ統合し、判定ガードとUI表示を単一状態で扱う
- [x] N-12.18 テスト: `npm test -w apps/orchestrator -- --test-reporter=spec` でサブワーカー関連を含む統合テスト回帰（42 pass）を確認する
- [x] N-12.19 実装: サブワーカーデバッグON時に `start/skip/result` ログを Terminal 本文へ出力し、実際に起動したかを追跡しやすくする
- [x] N-12.19 テスト: `subworker_debug_execution_logs` を追加し、デバッグログ文字列（start/skip/result）が実装に含まれることを確認する
- [x] N-12.20 実装: サブワーカーデバッグON時に `subworker_debug_events.jsonl`（app_config_dir）へ `event_type + status` を JSONL 追記し、解析しやすいファイルログを残す
- [x] N-12.20 テスト: `subworker_debug_execution_logs` で `append_subworker_debug_event` 経路と `subworker_debug_events.jsonl` 保存実装の存在を確認する
- [x] N-12.21 実装: `running` 表示を `ai-running`（AI 実行中）と `subworker-running`（サブワーカー稼働中）へ分離し、ターミナル報告/Watcher 表示/デバッグ出力で区別できるようにする
- [x] N-12.21 テスト: `npm test -w apps/orchestrator -- --test-reporter=spec` で `running` 分離後の統合テスト回帰が通ることを確認する
- [x] N-12.22 文書: サブワーカー起動トリガーを論理イベント `judge-complete` に統一し（`judge-result` / `hook-judge` / `judge-fallback`）、`need_input` 放置禁止（`start` または `skip(理由付き)` 必須）を `docs/OVERVIEW.md` / `docs/concept.md` / `docs/spec.md` / `docs/architecture.md` に反映する
- [x] N-12.22 テスト: docs の記述が一意で矛盾しない（自己レビュー）
- [x] N-12.23 実装: `queueSubworkerOnJudgeCompleted` の起動条件を `judge-complete` 正規化へ置換し、`judge-fallback` を含む完了ソースで同一経路処理する
- [x] N-12.23 テスト: `judge-result` / `hook-judge` / `judge-fallback` の各経路で `need_input` 時に `start` または `skip(理由)` が `subworker_debug_events.jsonl` に必ず記録されることを確認する（`npm test -w apps/orchestrator -- --test-reporter=spec` / `npm run -w apps/orchestrator e2e:subworker:matrix`）
- [x] N-12.24 実装: 状態デバッグログ（`status_debug_enabled`）を追加し、状態遷移/フック/Judge イベントを `status_debug_events.jsonl` に自動記録できるようにする
- [x] N-12.24 テスト: `status_debug_enabled=ON` で `status_debug_events.jsonl` が生成され、`state-transition` / `hook-event` 等が追記されることを確認する（`npm test -w apps/orchestrator -- --test-reporter=spec` / `npm run -w apps/orchestrator e2e:subworker:matrix` / `cargo test -p nagomi-orchestrator`）

- [x] N-12.25 文書/実装（過去）: サブワーカーの表示専用テンプレ（Markdown）を試作し、設定永続化と基本表示を確認する

- [x] N-12.26 文書: サブワーカー判断（アドバイス生成/代理入力文）を Codex で生成する仕様（judge 完了後の 2 回目呼び出し、定型 JSON、ガード/フォールバック、無限ループ抑止）を `docs/OVERVIEW.md` / `docs/spec.md` / `docs/concept.md` に反映する
- [x] N-12.26 実装: Settings に `subworker_prompt_template_markdown`（プロンプト用テンプレ）を追加し、既存 `subworker_advice_template_markdown` は serde alias で後方互換を維持する
- [x] N-12.26 実装: Orchestrator(Tauri) に `subworker_llm_decide` を追加し、Codex へ JSON schema 付きで問い合わせて `action/confidence/input/advice_markdown/reason` を取得する（内部呼び出しは hooks を隔離して hook-event ループを防ぐ）
- [x] N-12.26 実装: SubWorker の判断ロジックを LLM 結果優先へ置換し、`mode/threshold` と安全ガードで最終アクションを決定する（失敗時は現行ヒューリスティックへフォールバック）
- [x] N-12.26 テスト: `npm test -w apps/orchestrator -- --test-reporter=spec` と `cargo test -p nagomi-orchestrator` で設定/IPC/LLM 経路の回帰がないことを確認する
- [ ] N-12.26 テスト: 目視で `need_input`（Enter/y/n/任意入力）ケースで `advice_markdown` が表示され、`delegate_input` はガードに従って実行されることを確認する（ログにも request/result が残る）
- [x] N-12.26 テスト: E2E で `need-input` のアドバイスが `次に入力:` で始まり、表示 1 行が 160 文字程度まで保持されることを確認する（`npm run -w apps/orchestrator e2e:subworker:advice:format`）

- [x] N-12.27 実装: サブワーカー用プロンプトは「出力定型(JSON schema + JSON only指示)」を固定プレフィックスで必ず付与し、ユーザー編集テンプレは文脈（context）のみを担うようにする
- [x] N-12.27 テスト: `npm test -w apps/orchestrator -- --test-reporter=spec` / `cargo test -p nagomi-orchestrator` で回帰がないことを確認する

- [x] N-12.28 実装: `show_advice` の推奨入力を保持し、`need_input` 時に `Tab` で推奨入力をターミナルへ投入できるようにする（ユーザーが入力開始済みの場合は Tab を端末側へ優先する）
- [x] N-12.28 テスト: `npm test -w apps/orchestrator -- --test-reporter=spec` で回帰がないことを確認する（Tab 適用の統合テストを含む）

- [x] N-12.29.1 文書: サブワーカー実行フローを「AIターミナル状態判定完了（judge-complete）を唯一の起点」として整理し、`1判定=1回実行`（同一文脈の重複起動抑止）と ghost 入力仕様（`Tab`=補完確定、`Tab`以外=ghost解除して通常入力）を `docs/OVERVIEW.md` / `docs/spec.md` / `docs/architecture.md` に明記する
- [x] N-12.29.2 実装: `queueSubworkerOnJudgeCompleted` の dedup 署名を source 非依存（`hook-judge`/`judge-result` 共通）にし、同一文脈の `judge-complete` 連発を短時間で1回に畳む
- [x] N-12.29.3 実装: `maybeRunSubworker` の dedup 署名を `last_terminal_output` ベースへ安定化し、TUIノイズ（menu行や瞬間差分）で再起動しにくくする
- [x] N-12.29.4 実装: ghost 補完の入力状態機械を仕様準拠で整理し、ghost 表示中に `Tab` 以外のキーが来たら ghost を消去して当該キーを通常入力として扱う（入力阻害/二重処理を避ける）
- [x] N-12.29.5 テスト: `npm test -w apps/orchestrator` と `npm run e2e:smoke -w apps/orchestrator` を実行し、`npm run e2e:subworker:judge:dedup -w apps/orchestrator` のログで `judge-complete` 1回に対して `llm-start` が重複しないこと（`llmStartCount: 1`）を確認する
- [x] N-12.29.6 テスト: Tab/非Tabキーで ghost 挙動（Tab=補完確定、非Tab=ghost解除+通常入力）が一致することを E2E と状態ログで確認する（`subworker.judge.dedup.e2e.js` で非Tab時 `clear-suggestion(reason=user-typing)` を確認）
- [x] N-12.30 実装: ghost 補完候補を xterm 同一入力行へ「実入力風」に描画し、`Tab` 確定時は ghost を巻き戻してから提案入力を送信、`Tab` 以外キーは先に ghost を消去して通常入力へ戻す（別レイヤー表示を使わない）
- [x] N-12.30 テスト: `npm test -w apps/orchestrator`（52 pass）と `cargo build -p nagomi-orchestrator` で回帰なくビルドできることを確認する
- [x] N-12.31 実装: ghost 消去幅を `文字数(length)` ではなくターミナル表示セル幅（全角=2）で計算し、`（補完なし）` の残骸が残る問題を修正する
- [x] N-12.31 テスト: `npm test -w apps/orchestrator` と `cargo build -p nagomi-orchestrator` が通ることを確認する
- [x] N-12.32 実装: ghost 描画前に入力行の `EOL` を明示クリアし、Codex ネイティブプレースホルダと重なることで `（補完なし）eature}` のような混在表示になる不具合を修正する
- [x] N-12.32 テスト: `npm test -w apps/orchestrator`（統合）で回帰がないことを確認する
- [x] N-12.33 実装: 補完候補（suggestion）は表示出力ではなく PTY へ仮入力して Codex 側プレースホルダを自然に消す方式へ変更し、`Tab` は残りサフィックスのみ送信、`Tab` 以外は仮入力を Backspace で巻き戻す
- [x] N-12.33 テスト: `npm test -w apps/orchestrator`（統合）で回帰がないことを確認する
- [x] N-12.34 実装: `subworker-running` 中は入力行プレースホルダへ進行中文字列（`サブワーカーで処理中` + スピナー）を表示し、停止時はタイマーを即時解除して通常プレースホルダへ復帰する
- [x] N-12.34 テスト: `npm test -w apps/orchestrator -- --test-reporter=spec`（統合 53 pass）と `cargo build -p nagomi-orchestrator` が通ることを確認する
- [x] N-12.35 実装: 進行中スピナーを「通常色1文字 + 薄色3文字」の回転表示へ変更し、Codex風に進捗感が分かる見た目へ調整する（同一入力行プレースホルダ維持）
- [x] N-12.35 テスト: `npm test -w apps/orchestrator -- --test-reporter=spec`（統合 53 pass）と `cargo build -p nagomi-orchestrator` が通ることを確認する
- [x] N-12.36 実装: 未確定アドバイスは入力行で `(Tabで補完)候補文` の薄字表示に統一し、`subworker-running` 中はフラッシュ表示中でもスピナー更新を優先して回転継続する
- [x] N-12.36 テスト: `npm test -w apps/orchestrator -- --test-reporter=spec`（統合 53 pass）と `cargo build -p nagomi-orchestrator` が通ることを確認する
- [x] N-12.37 実装: `subworker-running` のプレースホルダで `サブワーカーで処理中` 文言側にも回転ハイライトを追加し、フレームごとに全体が動いて見えるようにする
- [x] N-12.37 テスト: `npm test -w apps/orchestrator -- --test-reporter=spec`（統合 53 pass）で回帰がないことを確認する
- [x] N-12.38 実装: `(Tabで補完)` 表示導入後も Tab 候補が PTY 仮入力経路へ入るように、提案行フラグ（`isSuggestionLine` / `suggestionPreview`）で判定を明示化する
- [x] N-12.38 テスト: `npm test -w apps/orchestrator -- --test-reporter=spec`（統合 53 pass）と `cargo build -p nagomi-orchestrator` が通ることを確認する
- [x] N-12.39 実装: `Tab` 未押下で候補が入力済みに見える問題を解消するため、提案表示中は PTY 仮入力を無効化し、候補は入力行の薄字表示のみとする（確定は `Tab` のみ）
- [x] N-12.39 テスト: `npm test -w apps/orchestrator -- --test-reporter=spec`（統合 53 pass）と `cargo build -p nagomi-orchestrator` が通ることを確認する
- [x] N-12.40 実装: `need-input` 中にターミナル外フォーカス（クリック後など）でも入力が落ちないよう、global keydown から terminal へのキー転送フォールバック（文字/Enter/Backspace/矢印/Home/End/PageUp/PageDown/Delete/Insert/Escape）を追加する
- [x] N-12.40 テスト: `npm test -w apps/orchestrator -- --test-reporter=spec`（統合 54 pass）で回帰がないことを確認する（`cargo build -p nagomi-orchestrator` は実行中 EXE ロック解除後に再確認）
- [x] N-12.41 実装: `Tab` 補完適用時は提案本文のみを PTY 入力し、`Enter` を自動送信しない（実行開始はユーザーの Enter 確定時のみ）
- [x] N-12.41 テスト: `npm test -w apps/orchestrator -- --test-reporter=spec`（統合 54 pass）と `cargo build -p nagomi-orchestrator` が通ることを確認する
- [x] N-12.42 実装: サブワーカーの `llm_tool=codex` 呼び出しをセッション継続化し、初回は fresh（セッションIDなし）、2回目以降は同一 `ipc_session_id` に紐づく Codex セッションIDで `resume` する（`resume` 失敗時は保持IDを破棄して fresh を1回再試行）
- [x] N-12.42 テスト: `cargo test --manifest-path apps/orchestrator/src-tauri/Cargo.toml`（`CARGO_TARGET_DIR=target-codex`）で追加ユニットテストを含めて成功することを確認する
- [x] N-12.43 実装: ユーザーの `codex` 起動入力を検知し、`codex` 新規起動時はサブワーカー保持セッションIDをクリア、`codex resume` 起動時は保持セッションIDを維持する
- [x] N-12.43 テスト: `cargo test --manifest-path apps/orchestrator/src-tauri/Cargo.toml`（`CARGO_TARGET_DIR=target-codex`）と `npm test -w apps/orchestrator -- --test-reporter=spec` が通ることを確認する
- [x] N-12.44 文書: サブワーカー新仕様（全モードで起動条件を統一し、まずアドバイス内容を生成してから閾値で `自動入力` / `Tab補完` を分岐）を `docs/OVERVIEW.md` / `docs/concept.md` / `docs/spec.md` / `docs/architecture.md` に反映する
- [x] N-12.44 実装: サブワーカー起動可否 `subworkerCanRunForState` をモード非依存に統一し、全モードで現行アドバイス相当の完了状態（`success|need_input|failure`）を同一に扱う
- [x] N-12.44 実装: 判定パイプラインを「1) まずアドバイス文 + 提案入力を生成 → 2) モード/閾値で最終適用を決定」へ整理する（`アドバイス` は常に表示、`ガンガン/慎重に` は `confidence>=threshold` のときのみ自動入力）
- [x] N-12.44 実装: 通常判定経路の最終アクションを `delegate_input|show_advice` の二択へ寄せ、`noop` は `disabled/paused/skip/error` 等の制御・例外経路のみに限定する
- [x] N-12.44 テスト: `npm test -w apps/orchestrator -- --test-reporter=spec` の統合テストを更新し、起動条件がモード非依存であることと、モード差が「閾値超過時の自動入力可否のみ」であることを検証する
- [ ] N-12.44 テスト: `subworker.matrix` 系 E2E を更新し、`success/need_input/failure` の各完了状態で 3 モードともサブワーカーが起動し、`アドバイス` は常に Tab補完、`ガンガン/慎重に` は閾値で自動入力分岐することを確認する
- [ ] N-12.44 テスト: 目視で実運用シナリオ（Codex対話）を確認し、`アドバイス表示 -> Tab補完` と `高信頼時の自動入力` が同一アドバイス起点で破綻なく切り替わることを確認する
- [x] N-12.45 文書: `Esc` 手動介入ターン（`manual-hold`）を仕様化し、`Esc` で Judge/SubWorker を停止、`Enter` 確定まで再起動しない条件を `docs/OVERVIEW.md` / `docs/spec.md` / `docs/architecture.md` に反映する
- [x] N-12.45 実装: `apps/orchestrator/src/index.html` に `manual-hold` 状態を追加し、Judge/SubWorker の起動経路（idle judge / prompt-hint / judge-complete）を `Esc` で停止、`Enter` で解除する
- [x] N-12.45 テスト: `npm test -w apps/orchestrator -- --test-reporter=spec` で統合テスト回帰を確認し、`manual-hold` ガード（judge/subworker skip）が実装に含まれることを検証する
- [x] N-12.46 実装: AI 入力直後に `await-first-output` ガードを追加し、入力後最初の PTY 出力を受けるまで Judge/SubWorker を起動しない（stale tail での早期再判定ループを防ぐ）
- [x] N-12.46 実装: `clearSubworkerOverlayLine('pty-output')` を非破壊クリア化し、Codex 本文出力時にカーソル巻き戻しで表示を消さないようにする
- [x] N-12.46 テスト: `npm test -w apps/orchestrator -- --test-reporter=spec` で統合テスト回帰を確認し、`await-first-output` と `pty-output` 非破壊クリアの実装文字列検証を追加する
- [x] N-12.47 実装: `await-first-output` の解除条件を「最初のPTY出力」から「最初の有意出力（prompt断片/`for shortcuts`/`context left` だけを除外）」へ強化し、prompt-only チャンクでは `prompt-hint` 判定を起動しないようにする
- [x] N-12.47 実装: Codex 処理中（`agentWorkActive` / `await-first-output`）は補完プレースホルダ描画を抑止し、本文出力への割り込みを防ぐ
- [x] N-12.47 テスト: `npm test -w apps/orchestrator -- --test-reporter=spec` で統合テスト回帰（58 pass）を確認し、`agent-first-output-skip` / `prompt_chunk_count` / 処理中プレースホルダ抑止の実装文字列検証を追加する
- [x] N-12.48 文書: サブワーカー稼働表示に `Esc` 離脱可能の表現（`サブワーカー処理中（Escで抜けます）`）と、`Esc` 手動介入時に表示ステータスを `idle` へ固定する仕様を `docs/OVERVIEW.md` / `docs/spec.md` / `docs/architecture.md` に反映する
- [x] N-12.48 実装: `apps/orchestrator/src/index.html` のサブワーカー稼働中表示文言を更新し、`manual-hold` 中は `resolveTerminalStatusState` が `idle` を返すようにして入力完了待ちを明示する
- [x] N-12.48 テスト: `apps/orchestrator/integration.test.js` に `Esc` 離脱文言と `manual-hold -> idle` 文字列検証を追加し、`npm test -w apps/orchestrator -- --test-reporter=spec` で回帰確認する
- [x] N-12.49 実装: サブワーカー/自動判定の実行時フラグ群（`last_*` / `skip_once` / `manual-hold` など）を `terminalState.runtime.subworker` / `terminalState.runtime.automation` に集約し、独立変数管理を撤去する
- [x] N-12.49 文書: 状態一元管理の正本を `terminalState`（`unified.subworker_phase` + `runtime.subworker` + `runtime.automation`）へ更新し、`docs/OVERVIEW.md` / `docs/concept.md` / `docs/spec.md` / `docs/architecture.md` を同期する
- [x] N-12.49 テスト: `npm test -w apps/orchestrator -- --test-reporter=spec` で統合テスト回帰（59 pass）を確認する

---

## future
- Overview: Orchestrator から Overview を開ける（tray/メニュー/ショートカットのいずれか）
- Overview: 開閉しても Terminal は壊れない（入力/表示が継続）
- Overview: 起動時に Overview を表示する設定（ON/OFF、既定OFF）
- Overview: ON/OFF で起動時の挙動が変わる
- グループごとの整列（Workspace / Task Group 単位でタイル配置、グループ内は pane 順で並べる）
- macOS のショートカット作成（.command / Automator などの起動導線）
- ターミナル入力補助の拡充（履歴/補完/スニペット/貼り付け支援）
- ターミナル表示の拡充（検索/ハイライト/スクロール補助）
- CompletionHook の正規化テスト（claudecode / opencode）

---

## archive
- 直近の完了項目（旧 current）は `docs/plan.archive.md` を参照する
