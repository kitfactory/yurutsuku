# docs/OVERVIEW.md（入口 / 運用の正本）

この文書は **プロジェクト運用の正本**です。`AGENTS.md` は最小ルールのみで、詳細はここに集約します。

---

## 現在地（必ず更新）
- 現在フェーズ: P0
- 今回スコープ（1〜5行）:
  - 起動導線（`nagomi.exe`）を軸に、Orchestrator/Terminal を「必要時だけ開く」体験を固める
  - nagomi: ターミナル並列作業の「俯瞰（Overview）＋順番フォーカス＋観測ベース状態表示」を中核に据える
  - Terminal の環境変数をユーザー環境に同期し、PATH 等の差分をなくす
  - Windows 設定画面に `Windows` カテゴリを追加し、terminal 起動方式（CMD / PowerShell / WSL）と WSL distro 選択を分離する
  - Windows 設定画面で整列/選択ショートカット（既定 `Ctrl+Shift+Y/J/K`）を変更できるようにする
  - Windows ショートカット（Desktop/Start Menu）起動時に余分なランチャー/コンソールウィンドウを出さない
- グローバル `nagomi` コマンドで `--restart`（Orchestrator 強制再起動）と `--status`（実行バイナリ/health 表示、起動/停止しない）と `--debug-paths`（ログパス表示、起動/停止しない）と `debug-tail`（直近ログ要約、起動/停止しない）を使えるようにする
  - テーマは 8 種類（light-sand / light-sage / light-sky / light-mono / dark-ink / dark-ocean / dark-ember / dark-mono）を 1 つの選択UIで提供する
  - 設定画面のレスポンシブを安定化し、狭幅では 1 列、十分な幅で 2 列表示に切り替える
  - キャラクター素材を `pack.json` ベースで管理し、`モデル/モーション/表情` の拡張を見据えた追加導線（一覧/選択/保存）と `Nikechan` 既存VRMの組み込みパックをプロトタイプとして整備する
  - キャラクターデバッグ表示（大きめ・背景透明）を Settings から開閉できるようにし、3D表示の確認を行いやすくする
  - `watcher-debug` 開閉コマンドがタイムアウトする環境では、Settings のデバッグトグルは通常 watcher を 3Dプレビュー代替として開閉するフォールバックを使う（既存 watcher ON/OFF は復元）
  - 3Dキャラクター表示は CDN 依存の読み込みに複数候補を持ち、VRM読込失敗時は機能実証用の3Dプロトタイプモデルへフォールバックする（依存ロード失敗時のみ2Dへ戻す）
  - Watcher 3D は同一 VRM 読込の多重起動を抑止し、描画は低負荷モード（pixel ratio 上限 + 描画間引き）で UI 応答性を優先する
  - Watcher 3D は再計算/読込中に 3D を一旦非表示にし、完了後に再表示する（読込中は loading 表示）
  - 起動時は settings 読込完了まで watcher 描画を保留し、`renderer=3d` の場合に 2D を挟まず loading から 3D へ遷移する
  - watcher の準備中は 2D/3D 共通で専用 Div に `準備中...` を表示し、読込中であることを明示する
  - Watcher 3D の依存/モデル読込にはタイムアウトを設け、ハング時は準備中表示を解除してフォールバックへ遷移する
  - settings 読込（`load_settings`）にも試行ごとのタイムアウトを設け、IPCぶら下がり時に `準備中` 固定にならないようにする
  - Watcher のデバッグ時は `status_debug_events.jsonl` に `watcher-*` イベント（`load-settings` / `pack-catalog` / `deps` / `model-load` / `fallback` / `preparing-stuck`）を追記し、`nagomi debug-tail watcher --n <N>` で段階別に追跡できるようにする
  - キャラクターパック読込（built-in fetch / stored list）は timeout 付きで実行し、読込ハング時でも `settingsHydrated` が進んで `準備中` 固定にならないようにする
  - `settingsHydrated=true` へ遷移した瞬間に watcher の表示再評価を強制し、`settings-hydration` のまま停止しないようにする
  - 通常 watcher は `renderer=3d` かつ VRM 設定済みで 3D を表示し、`watcher-debug` は大きめプレビュー用途として併用する
  - キャラクターモーションは集約状態ベースの固定4状態（`neutral` / `processing` / `waiting` / `need_user`）+ トリガー2状態（`completion` / `error_alert`）でプロトタイプ実装し、モーション素材差し替えに備える
  - 通常 watcher は 2D/3Dキャラクター表示を最小UIで行い、デバッグフレーム・デバッグボタン（`debug ui` トグル/スナップショット/スクリーンショット）は表示しない
  - watcher 操作系デバッグは UI ではなく `status_debug_events.jsonl` の `watcher-*` ログ（`nagomi debug-tail watcher`）で追跡する
  - Terminal 右クリックメニューに `新しいターミナルを開く` を追加し、クリック元と同位置に新規ターミナルを開けるようにする
  - 非選択ターミナルを選んだときの選択交代は維持し、拡大表示は整列済み状態でのみ適用する（未整列時はフォーカスのみ）
  - 選択ウィンドウ交代時のフォーカス切替アニメーションを高速化する
  - ターミナルウィンドウタイトルを CWD ベース表示にし、`src` / `docs` / `tests` など汎用名は 2 階層表示にする
  - nagomi ターミナル内で `:ng` 内蔵特殊コマンドを **UI 内蔵コマンド層**として扱えるようにする（PTY へは送らない）
  - `:ng` で入力不能/重複入力/応答欠落が再発した場合は `settings > Windows > :ng 内蔵コマンド` OFF で全面パススルーへ戻せるようにする
  - Terminal ストリームと AI フックの統合で終了候補を作り、AI判定（JSON 出力）で状態を確定する
  - ターミナル状態遷移の正本を `docs/spec.md` に明記し、`操作が固まる` 事象の診断手順を定義する
  - Codex 実問合せ E2E（`今の日本の総理大臣は？`）で状態遷移/色クラス/hook を時系列採取し、`blue -> black` を再現・追跡できるようにする
  - E2E は `apps/orchestrator/e2e/sandbox/isolated-workdir/` を隔離起動ディレクトリとして使い、サブワーカー検証ケースを増やしていく
  - サブワーカー機能を future より先行で実装し、各ターミナルの状況に応じて入力代行またはアドバイス提示で次アクションを支援する
  - サブワーカー既定モードは `慎重に` とし、誤作動を抑えつつ必要時だけ支援を起動できるようにする
  - サブワーカー稼働中は対象ターミナルを緑表示し、終了後は元の状態表示へ戻す
  - `running` ステータスは用途を分離し、AI 実行中は `ai-running`、サブワーカー実行中は `subworker-running` として扱う（状態機械の `running` は維持）
  - サブワーカーの進行中メッセージは本文へ出さず、完了後に結果（代行/アドバイス）をターミナル表示する
  - サブワーカー実行中は、入力行プレースホルダに `サブワーカー処理中（Escで抜けます）`（文言側もフレームごとにハイライト移動）+ `[...]` スピナー（通常色1文字 + 薄色3文字）を表示して「処理継続中」と `Esc` での離脱可否を可視化する
  - サブワーカー設定に `ON/OFF` と `サブワーカーデバッグON/OFF` を追加し、挙動と補助ログ表示を切り替えられるようにする
  - サブワーカーデバッグON時は `subworker_debug_events.jsonl` にイベント/状態を追記し、実行有無を後から解析できるようにする
  - 状態デバッグログON時は `status_debug_events.jsonl` に状態遷移/フック/Judge イベントを追記し、サブワーカー以前の挙動も解析できるようにする
  - サブワーカーのアドバイス表示は別欄ではなく Terminal 表示へ 1 行表示し、「次に何を入力するか」を明示する（スクロールバックに残さない一時表示でよい）
  - サブワーカー出力フォーマットは `[nagomi-subworker(自信度：xxx　アドバイス/代理入力)] (メッセージ)` に統一する
  - サブワーカーのアドバイス生成は `ユーザー最終入力` と `最後の出力` を併用する
  - サブワーカーの判断/アドバイス生成は Settings > AI Coding Agent の `サブワーカー用プロンプト（Markdown）` で調整できる（未設定時は既定プロンプト）。出力フォーマット（定型 JSON）は実装側の固定プレフィックスで規定し、ユーザー編集は文脈（context）のみを担う
  - サブワーカーの Codex 呼び出しは「初回はセッションIDなし（fresh）」で実行し、2回目以降は同一 `ipc_session_id` ごとに保持した Codex セッションIDで `resume` する（`resume` 失敗時はセッションを破棄して fresh を1回だけ再試行する）
  - ユーザーが shell から `codex` を新規起動した場合は、サブワーカー側の保持セッションIDをクリアして fresh 扱いに戻す。ユーザーが `codex resume ...` で起動した場合は保持セッションIDを維持して文脈継続する
  - サブワーカー判定は **AIターミナル状態判定の完了時のみ** 実行し、通常の状態遷移/観測更新/リサイズでは再判定しない
  - サブワーカー起動の完了イベントは論理名 `judge-complete` に統一し、`judge-result` / `hook-judge` / `judge-fallback` を同等ソースとして扱う
  - `judge-complete=need_input` かつサブワーカー有効時は、`start` か `skip(理由付き)` のどちらかを必ず記録し、`need_input` を無記録のまま放置しない
  - サブワーカー制御の正本はターミナル単一状態オブジェクト `terminalState`（`unified.subworker_phase` と `runtime.subworker` / `runtime.automation`）とし、独立変数や別状態オブジェクトの分岐増殖を避ける
  - サブワーカー起動は `judge-complete` を唯一の起点とし、同一文脈（state/reason/入力/出力）の短時間重複完了は 1 回に畳んで二重起動を防ぐ（`judge_complete_source` は重複判定キーに含めない）
  - codex prompt marker は `need_input` の補助信号として扱い、検知後は `prompt-hint` 理由で Judge を即時実行して判定完了イベントへ収束させる（Judge 実行中/間隔ガード時は短時間リトライ）
  - ghost 補完候補は「入力行の薄色プレースホルダ」として `(Tabで補完)候補文` 形式で表示し、`Tab` で確定入力、`Tab` 以外のキー入力時は ghost を消して通常入力のみを通す
  - `(Tabで補完)` 表示中は候補文を PTY へ仮入力しない（未確定のまま表示のみ）。`Tab` 押下時のみ候補文を入力し、`Enter` は自動送信しない（実行はユーザー確定時）
  - `need-input` 中にターミナル外へフォーカスが外れても、通常キー（文字/Enter/Backspace/矢印など）は terminal へフォワードして入力欠落を避ける
  - `Esc` 押下時は自動判定/サブワーカーを `manual-hold` にして、そのターンの自動処理を停止する。`manual-hold` 中の表示ステータスは `idle` とし、`Enter` でユーザー確定入力が来るまで Judge / SubWorker は再起動しない
  - Codex への入力直後は「入力後の最初の**有意な** PTY 出力（prompt断片/`for shortcuts`/`context left` だけは除外）」を受けるまで Judge を保留し、前ターン末尾（stale tail）だけで `need_input` 再判定→サブワーカー再起動するループを防ぐ
  - Codex が処理中（`agentWorkActive` / `await-first-output`）は補完プレースホルダを描画せず、PTY本文出力への割り込みを防ぐ
  - サブワーカーの起動条件はモードで分けず、`judge-complete(success|need_input|failure)` で共通起動する。モード差は最終適用のみ（`アドバイス` は常に Tab補完表示、`ガンガン/慎重に` は `confidence>=threshold` なら自動入力、未満は Tab補完表示）
  - ターミナル右上の固定ステータスパネルは表示せず、進行/結果はターミナル表示に集約する
  - サブワーカーを「一時停止」「今回だけスキップ」できる即時操作は Settings > AI Coding Agent に置き、全判断ログ（mode/confidence/action/result）を残す
  - 既定値（フォント/サイズ/scrollback 等）の参照元を docs→実装まで辿れる状態にする（値は当面ハードコードでOK）
  - トレイから設定画面を開ける導線を整える
  - トレイに `Open Character Window` を追加し、通常 watcher を閉じたあとでも再表示できるようにする
  - すべてのターミナルが終了したら、キャラクター表示ウィンドウ（通常 watcher / `watcher-debug`）も自動で閉じる
  - docs（正本）を実装に追従させ、将来の改修が迷子にならない状態にする
- 非ゴール（やらないこと）:
  - P1 (WSL Worker) の実装
  - P2 (Linux/macOS) の対応
  - ターミナルのタブ/分割/検索などの拡張操作
- 重要リンク:
  - concept: `./concept.md`
  - spec: `./spec.md`
  - usage: `./usage.md`
  - architecture: `./architecture.md`
  - plan (current/future): `./plan.md`
  - plan (archive): `./plan.archive.md`
  - tauri-driver E2E: `./tauri-driver-e2e.md`
  - complete spec: `../nagomi_complete_spec_v1.3.md`

---

## レビューゲート（必ず止まる）
共通原則：**自己レビュー → 完成と判断できたらユーザー確認 → 合意で次へ**

---

## 更新の安全ルール（判断用）
### 合意不要
- 誤字修正、リンク更新、意味を変えない追記
- plan のチェック更新
- 小さな明確化（既存方針に沿う）

### 提案→合意→適用（必須）
- 大量削除、章構成変更、移動/リネーム
- Spec ID / Error ID の変更
- API/データモデルの形を変える設計変更
- セキュリティ/重大バグ修正で挙動が変わるもの
