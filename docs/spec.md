# 仕様

入口は `docs/OVERVIEW.md`。Given/When/Then（前提/条件/振る舞い）で番号付きに整理する。

## 1. セッション/ターン
1.1 Given: `start_session` を受け取る, When: Orchestrator が処理する, Then: session を作成し既定値（name/worker_id など）を付与する  
1.2 Given: `send_input` を送信する, When: UI から入力が確定する, Then: phase を thinking に遷移させる  
1.3 Given: Codex / ClaudeCode のターンが進行中である, When: hook を受信する, Then: hook の正規化結果をそのターンの状態確定候補として使う  
1.4 Given: hook を受信したターンで AI Coding Agent が有効, When: 状態を確定する, Then: hook `kind` をそのまま `success/failure/need_input` へ正規化する  
1.5 Given: レーンの表示行数が上限に達する, When: 追加出力が来る, Then: 先頭から破棄してスクロールバックを維持する（既定 5,000 行 / 上限 20,000 行）  

## 2. UI（Chat/Run/キャラクター）
2.1 Given: Chat モードを開く, When: UI を描画する, Then: 左に対話レーン、右下にキャラクターを表示する  
2.2 Given: 末尾追従が ON, When: 新しい出力が来る, Then: 自動スクロールで末尾に追従する  
2.3 Given: ユーザーが上方向にスクロールする, When: 追従解除条件を満たす, Then: 末尾追従を OFF にする  
2.4 Given: トレイメニューを表示する, When: 項目一覧を表示する, Then: `Open Terminal Window` / `Open Character Window` / `Arrange Terminal Windows` / `Open Settings` / `Quit` のみを表示する（`Open Chat` / `Open Run` / `worker_*` は表示しない）  
2.4.1 Given: トレイからキャラクターウィンドウを再表示したい, When: `Open Character Window` を選ぶ, Then: `terminal_watcher_enabled=true` を保存して通常 watcher window を再表示する  
2.5 Given: Run のタイル配置を行う, When: セッション一覧を描画する, Then: 各モニタの作業領域ごとにターミナルウィンドウを均等グリッドで並べる（現位置の中心点で上→下、左→右の順に並び替える / 同一行判定は中心点の y 差が作業領域高の約 12%（最低 80px）以内）  
2.6 Given: 各モニタ内のウィンドウ数が 4 以上, When: 配置する, Then: 2 行で並べる  
2.7 Given: 各モニタ内のウィンドウ数が 9 以上, When: 配置する, Then: 3 行で並べる  
2.8 Given: タイル表示を行う, When: セッションが更新される, Then: 小さな表情/状態/ログがタイル上に表示される  
2.9 Given: タイルを選択する, When: ピックアップする, Then: 対応するターミナルウィンドウを同じモニタの作業領域内で中央に寄せ、作業領域の約 80% で大きく表示する  
2.9.0 Given: 複数のターミナルがあり整列済みである, When: 非選択ターミナルをユーザーが選択する（Run タイルの選択 / Terminal 本文クリック）, Then: SelectionState を選択先へ交代し、選択ウィンドウの拡大表示を適用する  
2.9.1 Given: Terminal 本文を操作する, When: `Shift + ダブルクリック` する, Then: クリック元と同じ位置/サイズで新しいターミナルウィンドウを 1 つ追加する（取得できない場合は通常位置で追加する）  
2.9.2 Given: すでに選択中のターミナルを再選択する, When: 選択操作を受ける, Then: SelectionState は維持し、過剰なフォーカス遷移アニメーションは行わない  
2.9.3 Given: 選択ウィンドウを交代する, When: 縮小→拡大アニメーションを実行する, Then: 縮小は 60-100ms、拡大は 80-140ms、合計は 240ms 以下を目標にする  
2.9.4 Given: 連続で選択交代する, When: 先行アニメーションが未完了のまま次の交代が来る, Then: 先行遷移をキャンセルして最新の交代のみを適用し、残像やジャンプを抑える  
2.9.5 Given: 複数ターミナルが未整列または整列状態が崩れている, When: 非選択ターミナルを選択する, Then: 拡大表示は行わず選択対象とフォーカスのみを更新する  
2.9.6 Given: 整列状態を判定する, When: 条件を評価する, Then: `未整列` は「起動後に未整列」「整列後のドラッグ移動」「整列後のリサイズ/最大化」「整列後のウィンドウ増減（新規作成/終了）」で成立する  
2.10 Given: 整列ショートカット（既定 `Ctrl+Shift+Y`）を押す, When: トリガーされる, Then: すべてのターミナルウィンドウがタイル配置される  
2.11 Given: ターミナルウィンドウで「次へ移動」ショートカット（既定 `Ctrl+Shift+J`）, When: 押下する, Then: 選択中のウィンドウを起点に同じ画面内で次のターミナルへ移動し、末尾なら次の画面の先頭へ移動する  
2.12 Given: ターミナルウィンドウで「前へ移動」ショートカット（既定 `Ctrl+Shift+K`）, When: 押下する, Then: 選択中のウィンドウを起点に同じ画面内で前のターミナルへ移動し、先頭なら前の画面の末尾へ移動する  
2.13 Given: 複数のモニタがある, When: 画面の順序を決める, Then: 各モニタの作業領域の位置（x, y）の昇順で並べる  
2.14 Given: phase が更新される, When: キャラクター表情を決める, Then: 優先順位に従って表情を切り替える  
2.15 Given: success/failure/need_input になる, When: 表情保持時間に到達, Then: idle/thinking に戻す（既定 4s）  
2.16 Given: Terminal 画面を開く, When: UI を描画する, Then: ターミナル表示領域が初期化される  
2.16.1 Given: 複数の Terminal window を開く, When: `Open Terminal Window` / `GET /open-terminal` で追加する, Then: window ごとに別 `session_id` を持ち入力/出力は共有されない  
2.16.2 Given: Terminal window を表示中である, When: 出力テールから CWD を推定できる, Then: **ウィンドウタイトル**は CWD ベースで更新し、通常は末尾フォルダ名を表示する（末尾が汎用名の `src` / `docs` / `tests` の場合は 2 階層の `<parent>/<leaf>` を表示する）  
2.17 Given: ターミナル入力が行われる, When: 入力が確定する, Then: PTY/Worker に入力が送られる  
2.17.1 Given: Terminal 画面で入力行の先頭が `:ng` である, When: 入力/Enter を処理する, Then: **UI 内蔵コマンド**として解釈し PTY/Worker へは送信しない（初期対応は `:ng ping` のみ）  
2.17.2 Given: `:ng` 入力中である, When: 文字入力/削除が行われる, Then: 文字は terminal 画面にローカルエコーで即時表示される（PTY エコー待ちをしない）  
2.17.3 Given: `:ng ping` を Enter する, When: 実行する, Then: `:ng ping` の行に続けて `pong` を表示する（遅延表示しない）  
2.17.4 Given: 未定義の `:ng` サブコマンドを Enter する, When: 実行する, Then: `[nagomi] unknown :ng command: <args>` を表示する（PTY へは送らない）  
2.17.5 Given: 内蔵コマンド層が入力不能/重複送信/応答欠落を再発させる, When: 不具合を再現する, Then: **ロールバックポイント**として `settings > Windows > :ng 内蔵コマンド` を OFF にして `:ng` 解釈を無効化し、すべての入力を PTY/Worker へそのまま送る  
2.17.6 Given: ロールバックが有効, When: `:ng ...` を入力する, Then: 通常のシェル入力として扱う（内蔵応答を出さない）  
2.18 Given: PTY/Worker から出力が届く, When: 受信する, Then: ターミナルに表示されスクロールバックが更新される  
2.19 Given: ユーザーがコピー/ペースト操作を行う, When: ターミナルにフォーカスがある, Then: OS のクリップボードで操作できる  
2.20 Given: ターミナルウィンドウのサイズが変わる, When: リサイズが確定する, Then: PTY/Worker にサイズ変更が送られる  
2.21 Given: ターミナル設定を変更する, When: 設定を保存する, Then: フォント/テーマ/スクロールバックが反映される  
2.21.1 Given: P0 既定値を参照する, When: 初回起動で settings が未作成, Then: 既定値を採用する（実装参照: `apps/orchestrator/src-tauri/src/main.rs` の `Settings::default`、UI 参照: `apps/orchestrator/src/index.html` の `terminalSettingsDefaults`）  
2.21.2 Given: トレイの Settings を開く, When: トレイメニューから設定画面を選ぶ, Then: `view=settings` の設定画面が表示される  
2.22 Given: IME を使う, When: 変換操作を行う, Then: OS の IME に従って入力できる（専用処理は持たない）  
2.23 Given: ターミナル画面を表示する, When: 描画する, Then: 画面内の基本表示は PTY 出力と `:ng` 内蔵コマンドのローカル出力で構成する（サブワーカーのアドバイスは「次に何を入力するか」を示すローカル出力行として追記する）  
2.24 Given: ターミナルが表示中, When: 観測（Watcher）を表示する, Then: **全ターミナルを代表する状態**を右下のキャラクターで示す（実装参照: `apps/orchestrator/src/assets/watcher/nagomisan_*.png` / 元データ: `apps/orchestrator/src/assets/watcher/nagomi_fullbody_icons_96_v3.zip`）  
2.24.1 Given: 観測（Watcher）を表示する, When: 表示設定が ON, Then: **別ウィンドウ（透過）**でフルボディ（256x512）を右下に表示する  
2.24.2 Given: 観測（Watcher）を表示する, When: 表示設定が OFF, Then: 透過ウィンドウを表示しない  
2.24.2.1 Given: `view=watcher` の専用ウィンドウを開く, When: watcher view を初期化する, Then: terminal view 用の `terminal-board` は DOM から除外し、キャラクター表示との重なりを防ぐ  
2.24.3 Given: 観測表示を行う, When: 全体状況で表情/モーションを選ぶ, Then: `need_input` は呼びかけ、`failure` は困った、`idle/success` は眠い表情として表示する。`processing` モーションは SubWorker 稼働中のみ使う  
2.24.4 Given: 観測表示を行う, When: 通常 watcher または `watcher-debug` を描画する, Then: 通常表示は常に 3D を使う（選択中VRMが未設定なら組み込み3D Pack またはプロトタイプ3Dを使う）  
2.24.4.1 Given: 3D表示を初期化する, When: 選択中VRMの読み込みに失敗する, Then: 機能実証向けの 3Dプロトタイプモデルへフォールバックし、3D canvas 自体は維持する  
2.24.5 Given: 開発用のキャラクターデバッグ表示を使う, When: `watcher-debug` を開く, Then: `watcher-debug` ウィンドウを別で開く（背景透明・常時最前面・既定 480x960）  
2.24.6 Given: キャラクターデバッグ表示を使う, When: `watcher-debug` を描画する, Then: キャラクターを通常 Watcher より大きく中央表示する（背景透明）  
2.24.7 Given: キャラクターデバッグ表示を終了する, When: Settings の `キャラクターデバッグ表示` トグルを閉じる側へ切り替える, Then: `watcher-debug` を閉じる（通常 Watcher の ON/OFF には影響しない）  
2.24.8 Given: キャラクターデバッグ表示で 3D表示を行う, When: ウィンドウサイズが変わる, Then: 3D canvas と camera aspect を表示サイズへ追従させる  
2.24.9 Given: 透明 watcher window を開いている, When: ウィンドウ表示を制御する, Then: 通常 watcher は選択時（focus 時）のみ Windows の native titlebar / 枠を表示し、移動・最大化・閉じる・サイズ変更を OS 標準操作で行える。非選択時は枠なしへ戻る。`watcher-debug` は既存どおり選択時 frame 制御を維持する  
2.24.9.1 Given: キャラクターデバッグ表示を開いている, When: ウィンドウを選択（focus）する, Then: デバッグ用フレームを表示し、フレーム上の `閉じる` ボタンで `watcher-debug` を閉じられる  
2.24.9.2 Given: 通常 watcher を開いている, When: 3D キャラクターを表示する, Then: 描画は window client area 内に収まり、titlebar / 枠の non-client 操作を妨げない  
2.24.9.3 Given: 通常 watcher を閉じる, When: タイトルバー `×` を押す, Then: UI は保存待ちでブロックせず即時に閉じる。`set_terminal_watcher_enabled(false)` で非表示化と永続化を同期し、失敗時のみ `save_settings` をフォールバックする  
2.24.9.4 Given: すべてのターミナルが終了する, When: 最後のターミナルウィンドウが閉じて terminal session/worker が空になる, Then: キャラクター表示ウィンドウ（通常 watcher / `watcher-debug`）を自動で閉じる  
2.24.9.5 Given: watcher の IPC 発火条件を定義する, When: watcher window を操作する, Then: watcher 系IPCは `watcher_window_ready`（window起動ごとに1回）/ `set_watcher_window_framed`（通常 watcher は focus/blur 時、`watcher-debug` は選択状態遷移時のみ）/ `set_terminal_watcher_enabled(false)`（通常 watcher 明示close時のみ）/ `close_character_debug_watcher`（`watcher-debug` 明示close時のみ）に限定する  
2.24.9.5.1 Given: pointer enter/leave/down や hover が発生する, When: watcher UI フレーム表示を更新する, Then: 通常 watcher では custom frame を表示せず、native frame は focus の間だけ表示する。`watcher-debug` のみ pointer/focus に応じて frame 表示と native frame 再同期を行う  
2.24.9.5.2 Given: `set_watcher_window_framed` が in-flight である, When: 追加の frame 切替要求が入る, Then: 要求は `latest desired state` に上書きし、同時実行せず直列適用する  
2.24.10 Given: 3Dキャラクター表示を行う, When: キャラクター状態を描画する, Then: 固定モーションは `neutral` / `processing` / `waiting` / `need_user` の4状態で扱う（複数ターミナルの集約状態から決定する）  
2.24.10.1 Given: ワンショット反応を行う, When: 状態遷移を検知する, Then: `completion`（処理完了）と `error_alert`（エラー発生）をトリガーモーションとして再生する  
2.24.10.2 Given: `error_alert` を再生する, When: `fail` が短時間で連続する, Then: クールダウンを入れて連打再生を抑制する  
2.24.10.3 Given: Watcher 3D を描画する, When: 同一 VRM 読込要求が短時間で重なる, Then: 同一路径の読込は 1 本に畳み、重複ロードを起こさない  
2.24.10.4 Given: Watcher 3D を描画する, When: UI 応答性を維持したい, Then: 描画は低負荷モード（pixel ratio 上限 + フレーム間引き）で実行する  
2.24.10.5 Given: 通常 watcher を表示する, When: キャラクター表示設定が ON である, Then: 通常 watcher は常に 3D を表示する（`watcher-debug` は大きめプレビュー用途として併用できる）  
2.24.10.6 Given: Watcher 3D を再計算/再読込する, When: 読込を開始する, Then: 3Dは完了まで非表示にし、完了後に再表示する（読込中は loading 表示）  
2.24.10.7 Given: アプリ起動直後に watcher を表示する, When: 設定読込中である, Then: settings 適用完了まで watcher の本表示を保留し、2D を一瞬表示してから切り替える経路を使わない  
2.24.10.8 Given: watcher の初期化/再読込を行う, When: 3D表示の準備中である, Then: watcher 内の専用 Div に `準備中...` を表示して、準備完了後に通常表示へ切り替える  
2.24.10.9 Given: Watcher 3D の依存/VRM 読込が遅延または停止する, When: タイムアウト時間を超える, Then: 読込を失敗扱いとして `準備中...` を解除し、組み込み3D Pack またはプロトタイプ3Dフォールバックへ進む  
2.24.10.10 Given: 起動時に設定を読む, When: `load_settings` IPC が応答しない, Then: 試行ごとのタイムアウトで次試行へ進み、最終的に defaults へフォールバックして `準備中...` 固定を回避する  
2.24.10.11 Given: Watcher の起動/再読込が詰まる, When: `status_debug_enabled=ON` でデバッグする, Then: `status_debug_events.jsonl` に `watcher-*` イベント（settings/pack/deps/model/fallback/preparing）を時系列追記し、`watcher-preparing-stuck` で長時間待機を明示する  
2.24.10.12 Given: キャラクターパック一覧を再構築する, When: built-in fetch または stored pack list が遅延する, Then: timeout 後に空配列フォールバックして `reloadCharacterPackCatalog` を完走し、`settingsHydrated` を進める  
2.24.10.13 Given: `reloadCharacterPackCatalog` が完了する, When: `settingsHydrated` が `true` へ遷移する, Then: watcher 表示評価（`applyTerminalWatcherVisibility` -> `refreshWatcherRendererMode`）を即時実行し、`settings-hydration` のまま停止しない  
2.24.10.14 Given: モーションをデバッグしたい, When: Settings から固定モーション（`auto/neutral/processing/waiting/need_user`）またはトリガー（`completion/error_alert`）を選ぶ, Then: `watcher` / `watcher-debug` の 3Dキャラクターへ即時反映される（イベント配信経路）  
2.24.10.15 Given: プロトタイプ表現を適用する, When: 各固定モーションを描画する, Then: `neutral=軽い微笑み`、`waiting=あくび`、`need_user=手を振る`、`processing=考え中（腕組み+顎に手）` を優先して表現する  
2.25 Given: 観測状態が変化する, When: 状態を適用する, Then: terminal の背景に対して半透明でトーンの揃った tint を重ねて状態を区別する  
2.25.1 Given: 状態を表示する, When: 表示色を決める, Then: **色は以下で固定**する（黒=idle/success、オレンジ=need_input、赤=failure、SubWorker 稼働中は緑オーバーレイ）  
2.25.1.1 Given: 状態表示を行う, When: 実行主体を区別する, Then: 表示/報告用ステータスは `idle` / `need_input` / `success` / `failure` / `subworker-running` に限定する。AI ツールは hook 到達時だけ見える状態を変える  
2.25.2 Given: 画面に文言を表示する, When: UI を描画する, Then: 表示文言はリソース管理し **日本語/英語** を用意する  
2.25.3 Given: サブワーカーが対象ターミナルを支援中である, When: 稼働中表示を行う, Then: 状態色とは別レイヤーで `サブワーカー処理中（Escで抜けます）` を緑表示し、処理終了時に元の状態表示へ戻す  
2.25.3.1 Given: サブワーカー稼働中表示が出ている, When: ユーザーが `Esc` を押す, Then: `manual-hold` に入り表示ステータスは `idle` になり、ユーザーの `Enter` 確定入力まで自動処理を再開しない  
2.25.4 Given: サブワーカーが有効である, When: 支援処理を開始する, Then: 進行中メッセージは Terminal 本文へ追記せず、処理完了後の表示に集約する（PTY へは送らない）  
2.25.4.1 Given: サブワーカー支援が完了する, When: 結果を反映する, Then: Terminal 上に 1 行だけ追記する（入力代行時は入力内容、アドバイス時は「次に何を入力するか」）  
2.25.4.1.1 Given: サブワーカー結果を Terminal 表示へ 1 行表示する, When: 表示文字列を作る, Then: フォーマットは `[nagomi-subworker(自信度：xxx　アドバイス/代理入力)] (メッセージ)` を使う（スクロールバックに残さない一時表示でよい）  
2.25.4.2 Given: ターミナルの表示領域を確保したい, When: サブワーカー状態を可視化する, Then: 右上固定の状態パネル（閾値/待機/操作ボタン常時表示）は出さない  
2.25.4.3 Given: ターミナル幅が狭い, When: サブワーカー結果を表示する, Then: 1 行メッセージを過長にしない（可読性が極端に落ちる長文を抑制する）  
2.25.5 Given: サブワーカー稼働表示を行う, When: `active=false` になる, Then: 緑表示は即時解除する（遅延保持しない）  
2.25.6 Given: サブワーカーを運用中である, When: ユーザーが即時操作する, Then: Settings > AI Coding Agent で `一時停止` と `今回だけスキップ` をワンクリックで実行できる  
2.25.7 Given: Terminal 本文で右クリックする, When: コンテキストメニューを開く, Then: ブラウザ既定メニューではなく nagomi 専用メニューを表示し、少なくとも `Open New Terminal / Copy / Paste / Select All / Open Settings` を提供する  
2.25.7.1 Given: settings 画面の非入力領域で右クリックする, When: コンテキストメニューを開く, Then: `Open New Terminal` を提供し、input/select/textarea/button 上では既定メニューを残す  
2.25.7.2 Given: `Open New Terminal` を押す, When: 新しい terminal を開く, Then: 選択中またはフォーカス中の terminal を優先し、見つからなければ現在 window を基準にして、少し右下へずらした位置に開く  
2.25.7.3 Given: terminal-only window で `Open Settings` を押す, When: 設定画面を開く, Then: backend command で `settings` window を開き、既存 window があれば前面化する  
2.26 Given: プロセスが終了する, When: exit_code を受信する, Then: Terminal 表示へ `[exit ...]` を追記してよいが、状態ソースとしては扱わない  
2.27 Given: AI ツールのプロセスが生存している, When: hook 未到達である, Then: プロセス生存判定は状態ソースとして使わず、状態は直前の hook 結果を維持する  
2.27.1 Given: hook が到達する, When: `kind=completed|error|need_input` を受ける, Then: hook 種別をそのまま `success/failure/need_input` に正規化する  
2.27.2 Given: agent 未検知または hook が壊れている, When: 末尾がプロンプト風（例: `[y/n]`, `Press Enter`, `password:`）を検出する, Then: 誤爆回避を優先し、状態確定は行わず補助表示のヒントにとどめる  
2.27.3 Given: hook 観測を実装する, When: P0 を実装する, Then: 観測ロジックは純粋関数として切り出し unit test できる（実装参照: `apps/orchestrator/src/agent_event_observer.js`）  
2.27.4 Given: `idle/success/failure/need_input` の状態にある, When: ユーザーが入力しても hook 未到達である, Then: 状態は変更しない  

## 3. Hook 正規化
3.1 Given: AI ツールの hook `kind=completed`, When: 正規化する, Then: state を success にする  
3.2 Given: AI ツールの hook `kind=error`, When: 正規化する, Then: state を failure にする  
3.3 Given: AI ツールの hook `kind=need_input`, When: 正規化する, Then: state を need_input にする  
3.4 Given: hook payload に `last-assistant-message` がある, When: 要約を作る, Then: 最大2行程度の `summary` を生成して状態ログとサブワーカー文脈へ渡す  
3.5 Given: hook payload に `input-messages` / `last-assistant-message` がある, When: project 履歴へ保存する, Then: `state` とともに `project-prompt-history/<project-key>.jsonl` へ追記する  

## 4. 通知（OS/音声）
4.1 Given: turn_completed で failure/need_input, When: 通知設定が ON, Then: OS トーストを送る  
4.2 Given: turn_completed で failure/need_input, When: 音声設定が ON, Then: 音声を再生する  
4.3 Given: 連続通知が発生, When: クールダウン中, Then: 同種通知を抑制する（既定 1500ms）  

## 5. NDJSON プロトコル
5.1 Given: 送受信する, When: メッセージを作る, Then: UTF-8 の 1 行 1 JSON で送る  
5.2 Given: Orchestrator → Worker, When: セッション開始する, Then: `start_session` を送る  
5.3 Given: Worker → Orchestrator, When: 出力が来る, Then: `output` を chunk（目安 4096 bytes〜）で送る（実装は time/size で coalesce してよい。順序は保持する）  
5.4 Given: Orchestrator → Worker, When: PTY サイズ変更が必要になる, Then: `resize` を送る  
5.5 Given: Orchestrator → Worker, When: セッションを停止する, Then: `stop_session` を送る  
5.6 Given: 不明な `type`, When: 受信する, Then: 無視して処理を継続する  

## 6. セキュリティ（ログマスク/外部送信）
6.1 Given: マスク対象が検出される, When: ログを送信/保存する, Then: `***REDACTED***` に置換する  
6.2 Given: サブワーカーが OFF, When: ログを扱う, Then: 外部送信しない  

## 7. Settings
7.1 Given: 設定画面を開く, When: 設定項目を表示する, Then: 通知/音量/**AI Coding Agent**/キャラ/ログ保持/外観（テーマ/フォント/サイズ/スクロールバック/コピー）を編集できる  
7.1.1 Given: 設定画面を表示する, When: 外観の優先度を上げる, Then: 外観セクションを先頭に配置する  
7.1.2 Given: フォント設定を行う, When: 設定画面を表示する, Then: フォントはリスト選択式で表示する  
7.1.3 Given: OS のローカルフォント一覧を取得できる, When: ユーザーが読み込み操作を行う, Then: OS フォントを選択肢に追加する（未対応の場合は既定リストのみ）  
7.1.4 Given: 設定が変更される, When: 設定を保存する, Then: 変更内容を全ウィンドウに通知し、起動済みターミナルの表示にも即時反映する  
7.1.4.1 Given: 設定画面を開く, When: カテゴリを一覧したい, Then: `外観 / Windows / AI Coding Agent / 通知 / キャラクター` をタブで切り替えられる  
7.1.4.2 Given: あるカテゴリの設定を編集する, When: 対応タブを選択する, Then: そのカテゴリのカードだけを表示し、他カテゴリは隠す  
7.1.5 Given: OS が Windows, When: 設定画面を表示する, Then: ターミナル起動方式として `CMD` / `PowerShell` / `WSL` を選択できる  
7.1.5.1 Given: OS が Windows かつ `pwsh.exe` が PATH 上にある, When: 設定画面を表示する, Then: ターミナル起動方式に `PowerShell 7` を追加表示する  
7.1.5.2 Given: OS が Windows かつ `pwsh.exe` が PATH 上にない, When: 設定画面を表示する, Then: `PowerShell 7` は選択肢に表示しない  
7.1.6 Given: 起動方式が `WSL`, When: 設定画面を表示する, Then: インストール済みディストロ一覧（`wsl -l -q`）から対象ディストロを選択できる（未選択は既定ディストロを使う）  
7.1.7 Given: OS が Windows 以外, When: 設定画面を表示する, Then: Windows 専用の起動方式設定は表示しない  
7.1.8 Given: OS が Windows, When: 設定画面を表示する, Then: 起動方式設定は `外観` ではなく `Windows` カテゴリで表示する  
7.1.9 Given: 設定画面でテーマを選択する, When: 外観を変更する, Then: **1つのテーマ選択UI**から 8 種類（`light-sand` / `light-sage` / `light-sky` / `light-mono` / `dark-ink` / `dark-ocean` / `dark-ember` / `dark-mono`）を選択できる（配色パレットの別ドロップダウンは表示しない）  
7.1.10 Given: 設定画面（Windows カテゴリ）を表示する, When: キーバインドを編集する, Then: `整列` / `次へ移動` / `前へ移動` のショートカットを変更して保存できる（既定 `Ctrl+Shift+Y` / `Ctrl+Shift+J` / `Ctrl+Shift+K`）  
7.1.11 Given: 設定画面をリサイズする, When: 幅が狭くなる, Then: アクティブタブ内の 2 列レイアウトは十分な幅でのみ有効になり、狭幅では 1 列に切り替えて項目が潰れない  
7.2 Given: 通知設定を編集する, When: 設定を変更する, Then: OS トースト通知の ON/OFF と音声通知の ON/OFF を切り替えられる  
7.3 Given: AI Coding Agent を編集する, When: ツールを選択する, Then: codex/claudecode/opencode のいずれかを選べる（内部識別子は `codex` / `claude` / `opencode`）  
7.3.1 Given: AI Coding Agent を選ぶ, When: 設定を保存する, Then: **ターミナルでの起動コマンド判別**に使う  
7.3.2 Given: AI Coding Agent が設定済み, When: 状態検出を行う, Then: hook completed/error/need_input をそのまま `success/failure/need_input` として扱う  
7.3.3 Given: AI Coding Agent セクションを表示する, When: 説明文を出す, Then: 「Codex / ClaudeCode / OpenCode の状態確定は hook のみを正本として扱う」旨を表示する  
7.4 Given: キャラクター追加を行う, When: zip をアップロードする, Then: サムネ/画像/音声（任意）を含むキャラコンテンツとして扱える  
7.4.1 Given: ターミナルキャラクター表示を編集する, When: 初回起動する, Then: ターミナル右下のキャラクター表示は既定 ON で始まる  
7.4.1.1 Given: ターミナルキャラクター表示を編集する, When: 設定を変更する, Then: ターミナル右下のキャラクター表示を ON/OFF できる  
7.4.2 Given: 3Dキャラクターを使う, When: VRM を設定する, Then: 通常 watcher は **VRM** を読み込み 3D 表示する。選択中VRMが無い場合は組み込み3D Pack またはプロトタイプ3Dへ寄せる  
7.4.3 Given: 3Dキャラクターで状態ごとのモーションを設定する, When: VRM Animation（`.vrma`）を割り当てる, Then: `idle/success`→`idle`、`need_input`→`need_input`、`failure`→`fail`、`subworker-running`→`running` の対応で再生する  
7.4.4 Given: 状態モーションが未設定, When: 3D表示を行う, Then: `idle` を再生し、`idle` 未設定なら静止にフォールバックする  
7.4.5 Given: 3Dキャラクター設定を調整する, When: `scale` / `yaw` を変更する, Then: 設定は永続化され、Watcher の 3D表示へ反映される  
7.4.5.1 Given: 通常 watcher を 3D 表示したい, When: `model_vrm_path` が未設定で組み込み3Dパックが存在する, Then: 組み込み3Dパック（優先: 現在選択Pack、次点: `nikechan-v2` -> `nikechan-v2-outerwear` -> `nikechan-v1` -> その他3D Pack）を自動適用して 3D表示へ遷移する  
7.4.6 Given: VRM を追加する, When: 設定画面から `.vrm` をアップロードする, Then: VRM は `app_config_dir/character-assets/vrm/` 配下へ保存され、`character_3d_vrm_path` に保存パスを保持する  
7.4.7 Given: キャラクター素材をパックで管理する, When: Pack を保存する, Then: `app_config_dir/character-packs/<pack_id>/pack.json` を正本として管理する  
7.4.7.1 Given: Pack を保存する, When: `pack.json` を作成する, Then: 必須キーは `pack_id` / `display_name` / `renderer` / `model_vrm_path` とする（`renderer` は互換保持用に保存するが、通常 watcher では常に `3d` として扱う）  
7.4.7.2 Given: Pack へ拡張素材を追加する, When: モーション/表情を定義する, Then: `motions`（state -> `.vrma` path）と `expressions`（state -> expression key）を任意で保持できる  
7.4.7.2.1 Given: 状態別モーションを設定する, When: Settings で `.vrma` を取り込む, Then: 取り込み対象 state は `neutral` / `processing` / `waiting` / `need-user` / `completion` / `error-alert` の6種類に限定する  
7.4.7.2.2 Given: `.vrma` 取り込みを実行する, When: ファイル選択ダイアログでファイルを指定する, Then: 指定ファイルを `app_config_dir/character-packs/<pack_id>/motions/<state>.vrma` へコピーし、`pack.json` の `motions[state]` を更新する  
7.4.7.2.3 Given: 状態別モーションを再取り込みする, When: 同じ state に別ファイルを取り込む, Then: `<state>.vrma` は上書き更新し、最新の `motions[state]` を正本とする  
7.4.7.2.4 Given: 状態別モーションを解除する, When: Settings の解除操作を実行する, Then: `pack.json` の `motions[state]` を削除し、3D表示は手続きモーションへフォールバックする  
7.4.7.2.5 Given: `.vrma` を取り込んだ直後, When: 設定を保存する, Then: 取り込んだ `motions[state]` のパスを `character_motion_default_paths[state]` に記録し、他のPackでもデフォルトモーションとして再利用できる  
7.4.7.3 Given: Pack の既定チューニングを定義する, When: 3D表示を初期化する, Then: `default_scale` / `default_yaw_deg` を適用する（未指定時は 1.0 / 0.0）  
7.4.8 Given: Pack の一覧を表示する, When: 設定画面を開く, Then: 組み込み Pack と `app_config_dir` 配下のユーザー Pack を統合して表示する  
7.4.8.1 Given: OS が Windows で通常 watcher を表示する, When: 透明 3D ウィンドウを生成する, Then: 通常 watcher は影/境界線/角丸を極力抑えた DWM 属性で開く（`watcher-debug` には強制しない）  
7.4.8.2 Given: 通常 watcher を選択する, When: 操作 UI を表示する, Then: focus 中だけ Windows の native titlebar / 枠を使って移動・最大化・閉じる・サイズ変更を行う  
7.4.8.3 Given: 通常 watcher が 3D 表示中である, When: ウィンドウサイズが変わる, Then: 3D 表示は client area に追従してリサイズされ、titlebar / 枠の操作を妨げない  
7.4.9 Given: Pack を選択する, When: ユーザーがキャラクター一覧をクリックする, Then: `character_id` と 3D設定（`model_vrm_path`/`scale`/`yaw`）へ即時反映する  
7.4.10 Given: 既存モデルをプロトタイプへ配置する, When: `tegnike/nikechan-assets` の VRM を参照する, Then: 組み込み Pack 定義（remote URL）として一覧に表示し、選択で 3D表示できる  
7.4.10.1 Given: Nikechan 系 VRM を表示する, When: Watcher 3D の向きを適用する, Then: Pack ID または VRM path に `nikechan` を含む場合は表示 yaw に +180 度オフセットを加えて正面向きに補正する（ユーザー設定 yaw は保持する）  
7.4.11 Given: 開発用にキャラクターデバッグ表示を操作する, When: `toggle_character_debug_watcher` / `open_character_debug_watcher` / `close_character_debug_watcher` を呼ぶ, Then: `watcher-debug` を開閉できる  
7.4.12 Given: デバッグ表示の URL パラメータを指定する, When: `character_debug=1` を付けて watcher view を開く, Then: `character_debug_width/height/state` を読み取り、固定表示サイズ/固定状態を適用できる  
7.4.12.1 Given: 3D未設定でデバッグ表示を開く, When: `character_debug_force_3d=1` を付ける, Then: 組み込み3Dパック（優先: 選択中Pack、次点: `nikechan-v2` -> `nikechan-v2-outerwear` -> `nikechan-v1` -> その他3D Pack）を自動適用して 3D 表示する（設定保存はしない）  
7.4.12.2 Given: 組み込み Pack の取得に失敗する, When: デバッグ表示で 3D 強制を行う, Then: `WATCHER_3D_PROTOTYPE_FALLBACK_PACKS` の remote URL を暫定 pack として利用し、3D表示の機能実証を継続する  
7.4.13 Given: デバッグ表示ウィンドウを閉じたい, When: デバッグ表示を開く, Then: focus 時のみデバッグフレームと native window frame を表示し、blur 時は隠す。`閉じる` ボタンまたはタイトルバー `×` で `close_character_debug_watcher`（または window close）を実行できる（`Esc` はこの機能に割り当てない）  
7.4.14 Given: キャラクターモーションを調整したい, When: Settings のキャラクター項目で固定モーション/トリガーを選択する, Then: `emit_character_motion_debug` を介して `watcher` / `watcher-debug` へイベント配信し、選択内容を即時反映する（保存設定には含めないデバッグ操作）  
7.4.14.1 Given: 3Dキャラクター表示中に state が変化する, When: 対応する `motions[state]` が存在する, Then: `.vrma` を優先して再生する（`completion` / `error-alert` はワンショット扱い）  
7.4.14.1.1 Given: 選択中Packに `motions[state]` が無い, When: `character_motion_default_paths[state]` が存在する, Then: デフォルトモーションを再生する  
7.4.14.2 Given: `.vrma` が未設定または読み込み失敗する, When: 3D表示を継続する, Then: 既存の手続きモーション（prototype/VRM pose）へフォールバックし表示を止めない  
7.5 Given: AI Coding Agent セクションを表示する, When: 設定画面を開く, Then: 「使用ツール」「サブワーカー設定（モード/閾値/運用操作）」を表示する（連携ボタンは表示しない）  
7.6 Given: AI Coding Agent を使う, When: 設定を保存する, Then: 使用する AI ツールを 1 つ選択できる（codex/claudecode/opencode）  
7.7 Given: AI Coding Agent を選択する, When: 設定画面を表示する, Then: 「選択したAIツールは起動コマンド判別と hook 状態確定の対象になる」旨を説明する  
7.8 Given: サブワーカー機能を使う, When: 設定画面でモードを選ぶ, Then: `ガンガン` / `慎重に` / `アドバイス` の 3 モードを切り替えられる  
7.8.1 Given: サブワーカーが支援を生成する, When: AI Coding Agent が設定されている, Then: nagomi に設定された AI Coding Agent（codex/claudecode/opencode）を使用する  
7.8.2 Given: サブワーカーがアドバイスを表示する, When: Terminal 画面に反映する, Then: Terminal 本文に「次に何を入力するか」を追記し、PTY の実行入力/プロセス入出力としては扱わない  
7.8.3 Given: サブワーカー設定の初期値を適用する, When: 設定未作成で起動する, Then: 既定モードは `慎重に` を使う  
7.8.4 Given: サブワーカー設定を編集する, When: 設定画面を表示する, Then: 入力代行を許可する `自信度閾値` を編集できる  
7.8.5 Given: サブワーカー運用を調整する, When: 設定画面を表示する, Then: `一時停止` と `今回だけスキップ` を実行できる  
7.8.6 Given: サブワーカー機能を制御する, When: 設定画面を表示する, Then: `サブワーカーON/OFF` を切り替えられる（OFF 時は自動支援を実行しない）  
7.8.7 Given: サブワーカーの診断表示を制御する, When: 設定画面を表示する, Then: `サブワーカーデバッグON/OFF` を切り替えられる（OFF 時は通常出力のみ表示する）  
7.8.8 Given: サブワーカーの判断/アドバイス内容を調整したい, When: 設定画面を表示する, Then: `サブワーカー用プロンプト（Markdown）` を編集できる（未設定時は既定プロンプトを使う）  
7.8.8.1 Given: サブワーカー用プロンプトテンプレを適用する, When: プロンプト本文を作る, Then: 出力フォーマット（定型 JSON と schema）は実装側の固定プレフィックスで規定し、ユーザー編集テンプレは `文脈（context）` のみを担う。テンプレ中の `{{state}}/{{summary}}/{{last_user_input}}/{{last_terminal_output}}/{{mode}}/{{threshold}}` を置換して文脈を生成する（互換のため `{{judge_state}}/{{judge_summary}}/{{input_preview}}/{{output_preview}}/{{instruction}}` も置換する）。未知のプレースホルダはそのまま残してよい  
7.8.8.3 Given: サブワーカーデバッグが ON, When: `llm-start/llm-result` を記録する, Then: `subworker_debug_events.jsonl` に `prompt_preview/prompt_context_preview/prompt_vars` と `llm_json` を追記し、入力（プロンプト）と出力（定型JSON）を後から確認できる（秘密っぽい値は `***REDACTED***` にマスクする）  
7.8.8.4 Given: サブワーカー用プロンプトを編集したい, When: Settings > AI Coding Agent の `編集` を押す, Then: 簡易エディタを開いて広い textarea で Markdown を編集し、`保存` で確定、`キャンセル` で破棄できる  
7.8.8.5 Given: サブワーカー用プロンプトをまだ開いていない, When: Settings > AI Coding Agent を見る, Then: 設定カード内には全文 textarea ではなく、現在値の短いプレビューと `編集` / `既定に戻す` を表示する  
7.8.8.4 Given: show_advice を表示する, When: Terminal 表示へ 1 行表示する, Then: アドバイスは短い 1 行プレビューになるため、**先頭に「次に入力: ...」で具体入力**を置き、`1/2` や `y/n` の選択肢がある場合はその入力を明示する（スクロールバックに残さない一時表示でよい）  
7.8.8.5 Given: サブワーカー結果を Terminal 表示へ 1 行表示する, When: 表示文字列を作る, Then: 1 行プレビューの最大長は 160 文字程度を目安にし、`次に入力:` と最低限の文脈が同一行で見えるようにする（過長は末尾を `…` で省略してよい。スクロールバックに残さない一時表示でよい）  
7.8.8.2 Given: サブワーカー用プロンプトが長い, When: LLM に問い合わせる, Then: プロンプトは UI 実装側で長さを制限し、極端な長文で性能/挙動が不安定にならないようにする  
7.8.8.2.1 Given: `last_terminal_output` をサブワーカー文脈として生成する, When: TUI/大量出力を扱う, Then: 末尾の「意味のある出力」から最大 200 行程度/最大 8,000 文字程度を目安に切り出し、プロンプト肥大化を抑える（judge 用の末尾は別途小さく切り出す）  
7.9 Given: 設定画面を表示する, When: 8種類のテーマのいずれかを選ぶ, Then: 設定画面の背景/カード/文字色を選択テーマに合わせて切り替える  
7.9.1 Given: AI Coding Agent の設定を表示する, When: 重要度を示す, Then: 設定カードを軽く強調して視認性を上げる  

## 8. 環境変数/.env
8.1 Given: ローカル開発で環境変数を扱う, When: `.env` を用意する, Then: `.env` はリポジトリに含めず `.env.example` をテンプレートとして使う  
8.2 Given: 環境変数を追加/変更する, When: `.env.example` を更新する, Then: 変数名/意味/既定値/必須性を `docs/spec.md` に追記する  
8.3 Given: P0 時点, When: 環境変数一覧を確認する, Then: 必須の環境変数は存在しない  
8.4 Given: 環境変数一覧を参照する, When: P0 時点, Then: 以下は任意の環境変数として利用できる  
- NAGOMI_TOOL_CLI: 使用する CLI（固定小文字、実行ファイル名と同一 / 例: codex, claude（claudecode）, opencode、既定: codex）
- NAGOMI_TOOL_PATH: CLI の実行パス（未指定なら PATH 解決）
- NAGOMI_TOOL_ARGS: 追加引数（空白区切り）
- NAGOMI_TOOL_TIMEOUT_MS: 実行タイムアウト(ms）
- NAGOMI_SUBWORKER_TOOL_ARGS: サブワーカー判断用ツールの追加引数（空白区切り、codex 以外で使用する場合に指定）
- NAGOMI_SUBWORKER_TOOL_TIMEOUT_MS: サブワーカー判断用ツールの実行タイムアウト(ms）
- NAGOMI_APP_CONFIG_DIR: app_config_dir を上書きする（E2E などの隔離起動用、未指定時は OS 既定の app_config_dir）
- NAGOMI_ORCHESTRATOR_PATH: Orchestrator 実行ファイルのパス（未指定なら PATH/開発ビルドを探す）
- NAGOMI_ORCH_HEALTH_PORT: ヘルスチェックポート（未指定なら 17707）
- NAGOMI_ENABLE_TEST_ENDPOINTS: テスト用HTTPエンドポイントを有効化（`1` のとき有効、既定: 無効）
- NAGOMI_ENABLE_TERMINAL_OUTPUT_BROADCAST: terminal-output-broadcast を有効化（`1` のとき有効、既定: 無効）
- NAGOMI_DEBUG_WORKER_IO: worker I/O のデバッグログを有効化（`1` のとき有効、既定: 無効）

## 9. IPC通信セッション
9.1 Given: UI が起動する, When: `ipc_session_open` を呼ぶ, Then: `session_id`/`server_epoch`/`phase` を返しセッションを登録する  
9.2 Given: セッションが有効, When: `ipc_session_probe` を呼ぶ, Then: `session_id`/`phase`/`last_seen_ms` を返す  
9.3 Given: セッションが有効, When: `ipc_session_echo` を呼ぶ, Then: `message` をそのまま返し `last_seen_ms` を更新する  
9.4 Given: セッションが無効, When: `ipc_session_probe`/`ipc_session_echo` を呼ぶ, Then: エラーを返す  
9.5 Given: セッションを終了する, When: `ipc_session_close` を呼ぶ, Then: セッションを削除し以後の呼び出しはエラーになる  
9.6 Given: IPCセッションがない, When: IPCコマンドを呼ぶ, Then: `ipc_session_id` が不正としてエラーを返す  

## 10. 起動/バックエンド分岐（Windows + WSL）
10.1 Given: ユーザーが `nagomi`（launcher: `nagomi.exe` / npm CLI `nagomi`）を起動する, When: Orchestrator が未起動, Then: Orchestrator を起動し Worker を起動する  
10.2 Given: ユーザーが `nagomi`（launcher）を起動する, When: Orchestrator が起動済み, Then: Orchestrator は起動済みとして扱い terminal window を開く  
10.2.1 Given: Orchestrator を起動する, When: `--start-hidden` を付与する, Then: 初期 window は表示しない（tray の `Open Terminal Window` / `Open Settings` から操作する）  
10.2.2 Given: Orchestrator を起動する, When: `--exit-on-last-terminal` を付与する, Then: 最後の terminal session が停止した時点で Orchestrator は終了する  
10.2.2.1 Given: terminal window を閉じる, When: ネイティブ window close (`CloseRequested` / `Destroyed`) が発生する, Then: Rust 側が対応 `session_id` を逆引きし、その場で session/worker cleanup と `--exit-on-last-terminal` 判定を完了する  
10.2.2.2 Given: terminal window を閉じる, When: frontend `beforeunload` が未達または失敗する, Then: terminal cleanup は Rust 側 native close 経路で完了し、frontend `beforeunload` は補助経路としてのみ扱う  
10.2.3 Given: ユーザーが `nagomi` を繰り返し起動する, When: `--session-id` を指定しない, Then: 起動のたびに追加で新しい terminal window を開く  
10.2.4 Given: ユーザーが `nagomi --restart` を実行する, When: 既存 Orchestrator が稼働中, Then: 既存プロセスを停止して再起動し、更新済みバイナリを確実に反映する  
10.2.5 Given: ユーザーが `nagomi --status` を実行する, When: 起動可否を確認したい, Then: **起動/停止は行わず**、解決した Orchestrator パスと `running/healthy/health_url` を JSON で表示する  
10.2.6 Given: ユーザーが `nagomi --debug-paths` を実行する, When: デバッグログの場所を確認したい, Then: **起動/停止は行わず**、app_config_dir と主要ログ/JSONL のパスを JSON で表示する（project 単位ログは `project_prompt_history_dir` として返す）  
10.2.7 Given: ユーザーが `nagomi debug-tail <kind>` を実行する, When: 直近ログを素早く見たい, Then: **起動/停止は行わず**、`status|watcher|subworker|terminal` の各 JSONL の末尾を読みやすく要約して表示する（`watcher` は `status_debug_events.jsonl` から `watcher-*` のみ抽出する）  
10.2.8 Given: ユーザーが `nagomi prompt-history export` を実行する, When: project ごとの hook 入出力履歴を外へ出したい, Then: **起動/停止は行わず**、`project-prompt-history/*.jsonl` を読み込んで JSON または JSONL で stdout または `--output` 先へ書き出す  
10.3 Given: Orchestrator の起動済み判定を行う, When: プロセス名で検出した後に IPC probe を試す, Then: IPC が応答しない場合は未起動として扱う  
10.3.1 Given: 起動済み判定を行う, When: CLI から生存確認が必要, Then: `127.0.0.1` のヘルスチェックエンドポイントで確認する  
10.3.2 Given: ヘルスチェックを行う, When: `GET /health` にアクセスする, Then: `{"status":"ok","pid":<number>}` を返す  
10.3.3 Given: ヘルスチェックポートを決める, When: `NAGOMI_ORCH_HEALTH_PORT` が未指定, Then: 既定ポートは `17707` を使う  
10.3.4 Given: terminal window を開く, When: `GET /open-terminal?session_id=<id>` にアクセスする, Then: Terminal window を開き `{"status":"ok","session_id":"<id>"}` を返す  
10.3.4.1 Given: terminal window を開く, When: `GET /open-terminal`（`session_id` 未指定）にアクセスする, Then: `session_id` を自動採番し Terminal window を開き `{"status":"ok","session_id":"<generated>"}` を返す  
10.3.4.2 Given: `session_id` が既存と衝突する, When: `GET /open-terminal?session_id=<id>` にアクセスする, Then: 衝突を避けるため `session_id` を自動採番し直し、Terminal window を開き `{"status":"ok","session_id":"<generated>"}` を返す  
10.3.5 Given: テスト用に入力を送る, When: `NAGOMI_ENABLE_TEST_ENDPOINTS=1` かつ `GET /terminal-send?session_id=<id>&text=<urlencoded>` にアクセスする, Then: 該当 `session_id` の端末へ入力を送る（無効時は 403 / パラメータ不足は 400 / 該当セッションがなければ 404 / その他は 500）  
10.3.5.1 Given: PowerShell でテスト送信する, When: URL エンコードした text を送る, Then: 端末へ入力が流れる  
```powershell
$env:NAGOMI_ENABLE_TEST_ENDPOINTS = "1"
Invoke-WebRequest "http://127.0.0.1:17707/open-terminal?session_id=codex-test" | Select-Object -Expand Content
$text = [System.Web.HttpUtility]::UrlEncode("codex `"ping`"`r`n")
Invoke-WebRequest "http://127.0.0.1:17707/terminal-send?session_id=codex-test&text=$text" | Select-Object -Expand Content
```
10.3.5.2 Given: CLI からテスト送信する, When: `nagomi terminal-send` を使う, Then: 端末へ入力が流れる  
```powershell
$env:NAGOMI_ENABLE_TEST_ENDPOINTS = "1"
nagomi terminal-send --session-id codex-test --text "codex `"ping`"`r`n"
```
10.4 Given: Windows で terminal session を開始する, When: 起動方式設定 `terminal_shell_kind` を参照する, Then: 設定値に応じた起動コマンドを使う  
10.5 Given: Windows で terminal session を開始する, When: 起動方式が `CMD`, Then: 起動コマンドは `cmd.exe` を使う  
10.6 Given: Windows で terminal session を開始する, When: 起動方式が `PowerShell`, Then: 起動コマンドは `powershell.exe` を使う  
10.6.1 Given: Windows で terminal session を開始する, When: 起動方式が `PowerShell 7`, Then: `pwsh.exe` が使える場合は `pwsh.exe` を使い、未導入なら `powershell.exe` へフォールバックする  
10.7 Given: Windows で terminal session を開始する, When: 起動方式が `WSL` かつディストロ未指定, Then: 起動コマンドは `wsl.exe` を使う  
10.7.1 Given: Windows で terminal session を開始する, When: 起動方式が `WSL` かつディストロ指定あり, Then: 起動コマンドは `wsl.exe -d <distro>` を使う  
10.8 Given: Worker の起動に失敗する, When: 再起動を試みる, Then: 再接続手段を提示しユーザーは再試行できる  
10.9 Given: Windows で Terminal session を開始する, When: PTY を起動する, Then: 環境変数は「通常の cmd/PowerShell と同等」を目指して同期する（現在の環境を優先しつつ、System/User の環境変数を不足分だけ補完し、PATH は不足分だけ後ろに追加する）  
10.10 Given: OS が Windows, When: Orchestrator/Worker/PTY を起動する, Then: **余分なコンソールウィンドウを表示せず**、ユーザーには Terminal（+ tray）だけが見える状態を保つ  
10.11 Given: Windows で `nagomi shortcut` が生成した `.lnk` を実行する, When: デスクトップ/スタートメニューから起動する, Then: ランチャー/コンソールの余分なウィンドウを表示せず Terminal を起動する  
10.11.1 Given: ショートカット生成時の既定ターゲットが Node.js である, When: `.lnk` の実行ターゲットを決定する, Then: `nodew.exe` を優先し、未検出時は `wscript.exe + *.vbs` の非表示ランチャーを使い、最終フォールバックのみ `node.exe` を使う  
10.11.2 Given: `nagomi shortcut --target <path>` を指定する, When: `.lnk` を生成する, Then: 実行ターゲットは指定値をそのまま使う（自動置換しない）  

## 11. 外部ツールフック（観測/完了検知）
11.1 Given: 外部ツールのフック通知を受け取る, When: 正規化する, Then: `hook_event` を生成する（`source`, `kind`, `ts_ms`, `source_session_id?`, `raw?`）  
11.1.1 Given: Terminal session を開始する, When: AI ツールが起動される, Then: `NAGOMI_SESSION_ID` を環境変数に付与し hook に `source_session_id` を伝播する  
11.2 Given: `hook_event.kind = completed`, When: 受信する, Then: `state=success` として扱う  
11.3 Given: `hook_event.kind = error`, When: 受信する, Then: `state=failure` として扱う  
11.4 Given: hook を受信する, When: `summary` を生成する, Then: 状態ログとサブワーカー文脈へ渡す  
11.5 Given: `hook_event.kind = need_input`, When: 受信する, Then: `state=need_input` として扱う  
11.6 Given: フックの `raw` を保存する, When: 受信する, Then: 6.x のマスク規則を適用する  
11.7 Given: フック検知機能を持つ, When: P0 を実装する, Then: 抽象クラス `CompletionHook` を用意し、ツールごとに実装（`CodexCompletionHook` / `ClaudeCodeCompletionHook` / `OpenCodeCompletionHook`）する  
11.8 Given: フック検知機能を持つ, When: ツールが選択されている, Then: 選択ツールに対応する `CompletionHook` 実装のみを有効化する  
11.9 Given: `CompletionHook` を実装する, When: 起動する, Then: `start(onHookEvent)` を呼ぶとフック入力の待受を開始し、正規化済み `hook_event` を `onHookEvent` に渡す  
11.10 Given: `CompletionHook` を実装する, When: 停止する, Then: `stop()` を呼ぶとフック入力の待受を停止する  
11.11 Given: `CompletionHook` がフック入力を受け取る, When: 正規化する, Then: 11.1 の `hook_event` へ変換して出力する  
11.12 Given: `CompletionHook` が不正な入力を受け取る, When: 正規化に失敗する, Then: 例外ではなく無視/警告に留める  
11.13 Given: フック通知を用いる, When: P0 の最小運用を行う, Then: codex の `agent-turn-complete` / `turn.completed` を `completed` として扱う  
11.13.1 Given: codex が入力待ちに遷移した, When: `type/status` に input/permission/request 等が含まれる, Then: `need_input` として扱う  
11.14 Given: フック通知を用いる, When: P0 の最小運用を行う, Then: claude の `Stop` を `completed` として扱う  
11.15 Given: フック通知を用いる, When: P0 の最小運用を行う, Then: claude の `PermissionRequest` / `Notification`（permission/idle）を `need_input` として扱う  
11.16 Given: フック通知を用いる, When: P0 の最小運用を行う, Then: opencode の `session.idle` を `completed` として扱う  
11.17 Given: フック通知を用いる, When: P0 の最小運用を行う, Then: opencode の `session.error` を `error` として扱う  
11.18 Given: フック通知を用いる, When: P0 の最小運用を行う, Then: opencode の `permission.updated` / `permission.replied` を `need_input` として扱う  
11.19 Given: codex のフック設定例を表示する, When: codex を選択する, Then: 以下の最小例を表示する（読み取り専用）  
```toml
# ~/.codex/config.toml
notify = ["node", "<path>/nagomi_codex_notify.js"]
```
11.20 Given: codex の notify を使う, When: フック受信スクリプト（`nagomi-codex-notify` または `nagomi_codex_notify.js`）を実行する, Then: コマンド配列の末尾引数として渡される JSON 文字列 1 個を受け取り `hook_event` に正規化する  
11.21 Given: claude のフック設定例を表示する, When: claude を選択する, Then: 以下の最小例を表示する（読み取り専用 / 例: `.claude/settings.local.json`）  
```json
{
  "hooks": {
    "Stop": [
      { "hooks": [ { "type": "command", "command": "python3 .claude/hooks/nagomi_hook.py" } ] }
    ],
    "PermissionRequest": [
      { "matcher": "*", "hooks": [ { "type": "command", "command": "python3 .claude/hooks/nagomi_hook.py" } ] }
    ],
    "Notification": [
      { "hooks": [ { "type": "command", "command": "python3 .claude/hooks/nagomi_hook.py" } ] }
    ]
  }
}
```
11.22 Given: claude の hooks を使う, When: フック受信スクリプトを実行する, Then: stdin の JSON を受け取り `hook_event` に正規化する  
11.23 Given: opencode のフック設定例を表示する, When: opencode を選択する, Then: 以下の最小例を表示する（読み取り専用 / 例: `.opencode/plugins/nagomi-notify.js`）  
```js
export const NagomiNotify = async ({ $, project, directory }) => {
  return {
    event: async ({ event }) => {
      if (event.type === "session.idle" || event.type === "session.error" || event.type === "permission.updated" || event.type === "permission.replied") {
        const payload = JSON.stringify({
          source: "opencode",
          project,
          directory,
          event
        });
        await $`python3 .opencode/hooks/nagomi_opencode_notify.py ${payload}`;
      }
    }
  };
};
```
11.24 Given: opencode のプラグインを使う, When: イベントを受信する, Then: `event` を `hook_event` に正規化する  
11.25 Given: フック検知機能を実装する, When: P0 を設計する, Then: `CompletionHookManager` は「選択ツールに対応する `CompletionHook` の開始/停止」と「`hook_event` の受け渡し」に責務を限定する  
11.26 Given: 起動時, When: 設定にフック取得対象ツールが指定されている, Then: `CompletionHookManager` は該当 `CompletionHook` を生成し `start(onHookEvent)` を呼ぶ  
11.27 Given: 設定が変更される, When: フック取得対象ツールが変わる, Then: 既存 `CompletionHook` を `stop()` で停止し、新しい `CompletionHook` を起動する  
11.28 Given: `hook_event` を受信する, When: `kind = completed|error`, Then: `state=success|failure` を確定する  
11.29 Given: `hook_event` を受信する, When: `kind = need_input`, Then: `state=need_input` を確定する  
11.30 Given: フック取得対象ツールが未設定, When: 起動する, Then: `CompletionHookManager` はフック待受を行わない  

## 12. nagomi 要件（並列作業/状態/グループ/終了検知）
12.1 Given: 複数のターミナルが並列稼働している, When: ペイン数が増える, Then: 迷子にならず「状態/次の一手」が分かる（流れを止めない）  
12.2 Given: 既存の開発環境/CLI/プロジェクト構成がある, When: nagomi を導入する, Then: 大きな変更を要求しない（AIツール選択時は該当ツールの設定ファイルへの最小追加は許容する）  
12.3 Given: 長時間放置/再起動が発生する, When: 復帰する, Then: 状態が破綻しにくく、観測が継続/復帰できる  
12.4 Given: ペインの状態を扱う, When: 一覧/バッジ/通知を更新する, Then: 状態は `idle/need_input/success/failure/subworker-running` のいずれかに限定する（`waiting_input` は `need_input` の別名として扱う）  
12.5 Given: 状態をユーザーに伝える, When: 一覧/バッジ/通知を表示する, Then: 「人の目で追うログ」ではなく状態を前面に出す  
12.6 Given: ターミナルをグループ化する, When: 並列作業を扱う, Then: WIP の塊/視線移動コスト削減/状態集約/復帰を満たす  
12.7 Given: グループの粒度を決める, When: UI を設計する, Then: Workspace / Task Group / Pane の 3 層で表現する（実装は任意タグ集合でもよい）  
12.8 Given: 自動グループ化を行う, When: 情報が取得できる, Then: `CWD` と「コマンドによる指定（起動コマンド/タグ）」を同時に候補に入れ、衝突時は **分割せず同一グループに統合**する（手動補正は追加タグとして扱う）  
12.9 Given: グループの状態を集約する, When: 代表値を算出する, Then: `health/active/blocked` を表示し、`health` は `failure` が1つでもあれば Bad、`need_input` があれば Warn、それ以外は OK とする  
12.10 Given: 状態確定を部品化する, When: 設計する, Then: CompletionHook / AgentEventObserver / HookCompletionNormalizer に分離し unit test 可能にする  
12.11 Given: PTY/プロセスが終了する, When: `exit_code` を受信する, Then: 表示ログへ通知してよいが、状態ソースとして使わない  
12.12 Given: コマンド終了を検知する, When: 方法を選ぶ, Then: 終了検知は表示用途に限定し、状態確定へは使わない  
12.13 Given: Terminal状況検知の条件取得を行う, When: 入力/出力/終了を観測する, Then: PTY の `input` / `output` / `exit` は表示用として取得する  
12.14 Given: 状態確定の条件判断を行う, When: 条件を評価する, Then: hook completed|error|need_input のみを状態ソースとして扱う  
12.14.1 Given: AIツールの開始を扱う, When: 入力が確定する, Then: 入力は PTY へ転送するが、状態は変えない  
12.15 Given: CLI エージェントを観測する, When: イベントを正規化する, Then: hook の完了系だけを `need_input/success/failure` に正規化する  
12.16 Given: CLI エージェントのイベント取得を行う, When: 取得方式を決める, Then: 公式イベント > 安定ログ > ヒューリスティックの順で使う  
12.17 Given: AIツールイベントの条件判断を行う, When: 正規化イベントを評価する, Then: `need_input` は `need_input`、`success/failure` は `success/failure` として扱う（開始/途中経過/進捗は状態を変えない）  
12.18 Given: Codex / ClaudeCode を扱う, When: 状態を判断する, Then: prompt marker / idle timeout / terminal exit を使わず hook だけで `success/failure/need_input` を確定する  
12.19 Given: 状態を統合する, When: UI 状態を決める, Then: hook イベントだけを正本とし、直前の hook 結果を次の hook 到達まで維持する  
12.20 Given: 最小状態機械を定義する, When: 状態遷移を行う, Then: `idle|success|failure|need_input -> success|failure|need_input` を hook 到達時だけ更新する  
12.20.1 Given: 状態遷移を実装する, When: hook を扱う, Then: `kind=completed|error|need_input` をそのまま `success|failure|need_input` に写像する  
12.20.2 Given: 状態遷移の正本を参照する, When: 実装/調査で遷移を判定する, Then: 以下の遷移マトリクスを優先して適用する  
| 現在 state | 受信イベント | ガード/条件 | 次 state | 備考 |
|---|---|---|---|---|
| `idle/success/failure/need_input` | `hook-complete(state=need_input)` | なし | `need_input` | 入力待ち確定 |
| `idle/success/failure/need_input` | `hook-complete(state=success)` | なし | `success` | 正常完了 |
| `idle/success/failure/need_input` | `hook-complete(state=failure)` | なし | `failure` | 異常完了 |
12.20.3 Given: 表示/報告用ステータス（`status_state`）を決める, When: 同一時刻に複数条件が成立する, Then: 優先順位は `subworker-running` > `need_input/success/failure/idle` とする（`state`/`status_state`/`subworker_phase` と実行時情報 `runtime.subworker` / `runtime.automation` は単一状態オブジェクトで同時更新する）  
12.20.4 Given: 「操作が固まった」疑いを診断する, When: 状態デバッグログを確認する, Then: 直近イベントを `manual-hold` / `hook未到達` / `hook-complete未到達` の3系統に分類して原因を切り分ける（確認対象: `status_debug_events.jsonl`）  
12.20.5 Given: 状態が固まった疑いがある, When: 回復操作を行う, Then: まず `Esc` で `manual-hold` にして自動処理/サブワーカーを停止し、表示ステータスを `idle` にしてユーザー入力完了待ちへ遷移する。次の hook 到達で状態再開を確認する  
12.20.6 Given: サブワーカー状態を扱う, When: 実装する, Then: `subworker_phase` だけでなく実行時情報（`runtime.subworker` / `runtime.automation`）も独立変数で管理せず、ターミナル単一状態オブジェクト `terminalState` に含めて一元管理する  
12.21 Given: 実装に落とす, When: 最小データモデルを持つ, Then: 以下の構造で扱える  
```json
{
  "workspace": { "id": "ws1", "root": "/mnt/c/Users/.../repo" },
  "group": { "id": "g1", "name": "feature-x", "workspace_id": "ws1", "tags": ["feature-x"] },
  "pane": {
    "id": "p9",
    "group_id": "g1",
    "title": "agent",
    "cwd": "/mnt/c/Users/.../repo",
    "pty_pid": 12345,
    "state": "idle",
    "last_activity_at": "2026-01-29T12:34:56+09:00"
  },
  "job": {
    "id": "j77",
    "pane_id": "p9",
    "kind": "agent",
    "tool": "codex",
    "state": "idle"
  }
}
```
12.22 Given: 最小テスト観点を定める, When: P0 の壊れにくさを確認する, Then: PTY 終了（正常/異常/強制 kill/WSL 再起動/SSH 切断）/コマンド終了（exit code 0/非0）/入力待ち遷移/誤検知耐性/復帰の 5 点を確認する  
12.23 Given: ターミナルを起動する, When: 初期表示する, Then: 状態は `idle`（黒）として扱う  
12.24 Given: codex を起動する, When: `codex` コマンドだけを入力する, Then: 状態は **変化させない**（idle/success のまま）  
12.24.1 Given: codex 起動入力の取りこぼしが発生する, When: codex 出力 marker（例: `for shortcuts` / `100% context left`）を検出する, Then: agent セッションを補助開始するが、**初回指示がまだなら状態は `idle`（準備完了）を維持**する  
12.25 Given: codex に作業プロンプトを入力する, When: 処理が開始される, Then: 状態は変化しない（次の hook 完了まで直前状態を維持する）  
12.25.1 Given: codex セッションが起動済みで初回指示が未送信である, When: 空Enter（空行）だけを送信する, Then: 状態は `idle`（準備完了）を維持し、状態は変化しない  
12.26 Given: codex の処理が完了する, When: 完了を検知する, Then: 状態は `success`（黒）を **維持**する  
12.27 Given: codex が入力を要求する, When: input/permission/request を検知する, Then: 状態は `need_input`（オレンジ）になる  
12.27.1 Given: codex が処理中である, When: PTY に prompt marker（例: `for shortcuts`）が出ても hook が未到達である, Then: 状態は変化せず、完了確定は hook を待つ  
12.28 Given: codex を `/quit` で抜ける, When: セッション終了を検知する, Then: 状態は変更しない  
12.29 Given: 通常コマンドを実行する, When: コマンド入力が確定する, Then: 状態は変更しない  
12.30 Given: 通常コマンドが入力要求する, When: prompt を検知する, Then: 状態は変更しない  
12.31 Given: 通常コマンドが正常終了する, When: exit_code=0 を検知する, Then: 表示ログへ通知してよいが、状態ソースとしては扱わない  
12.32 Given: 通常コマンドが異常終了する, When: exit_code!=0 を検知する, Then: 表示ログへ通知してよいが、状態ソースとしては扱わない  
12.33 Given: `idle/success/failure/need_input` の状態にある, When: ユーザーが入力しても hook 未到達である, Then: 状態は変更しない  
12.34 Given: サブワーカー機能が有効である, When: 対象ターミナルの状況を確認する, Then: 入力代行またはアドバイス表示で次アクションを支援する  
12.34.1 Given: サブワーカーが稼働中である, When: 対象ターミナルを描画する, Then: `サブワーカーで処理中` を緑で表示する  
12.34.2 Given: サブワーカー処理が終了する, When: UI を更新する, Then: 緑表示を解除し元の状態表示（黒/オレンジ/赤）に戻す  
12.34.3 Given: サブワーカーがアドバイスを提示する, When: Terminal に表示する, Then: Terminal 本文へ「次に何を入力するか」を1行で追記し、実コマンド実行/プロセス入力として扱わない  
12.34.3.1 Given: CLI が TUI 形式で UI 行（候補/メニュー/枠線）を多く出す, When: サブワーカーが文脈を組み立てる, Then: `last_terminal_output`（直近の意味のある出力群）を主情報として扱い、`output_preview`（末尾1行ヒント）には過度に依存しない  
12.34.3.1 Given: サブワーカーがアドバイス文を生成する, When: 判定文脈を作る, Then: `ユーザー最終入力` と `最後の出力` の両方を使って内容を決める  
12.34.3.2 Given: サブワーカーが表示文を作る, When: アドバイス/代理入力を出力する, Then: `[nagomi-subworker(自信度：xxx　アドバイス/代理入力)] (メッセージ)` 形式で 1 行表示する（スクロールバックに残さない一時表示でよい）  
12.34.3.3 Given: サブワーカーが次アクションを判断する, When: `hook-complete` で起動する, Then: 出力定型（JSON schema と JSON only 指示）は実装側の固定プレフィックスで必ず付与し、`subworker_prompt_template_markdown` は文脈（context）として LLM に渡す。LLM から定型 JSON（`action/confidence/input/advice_markdown/reason`）を取得して最終アクションを決める（表示用テンプレは持たず `advice_markdown` をそのまま表示する）  
12.34.3.4 Given: サブワーカーがアドバイス表示を行い推奨入力（single-line）を持つ, When: ユーザーが `Tab` を押す, Then: 推奨入力をそのままターミナルへ投入できる（自動送信はせず、`\\r` を含む場合のみ Enter 相当が送られる）  
12.34.3.5 Given: ユーザーがすでに入力を始めている, When: `Tab` を押す, Then: サブワーカー提案の適用は行わずターミナル側の `Tab`（補完など）を優先する  
12.34.3.6 Given: ghost 補完候補が表示中である, When: ユーザーが `Tab` 以外のキーを押す, Then: ghost は即時解除し、そのキーは通常入力として処理する（ghost が入力を阻害しない）  
12.34.3.7 Given: サブワーカーが `llm_tool=codex` で連続判定する, When: 同一 `ipc_session_id` で 2 回目以降の問い合わせを行う, Then: 初回は `codex exec`（fresh）で実行し、以後は保持した Codex セッションIDで `codex exec resume` を使う。`resume` 失敗時は保持IDを破棄し、fresh を 1 回だけ再試行する。さらに、ユーザーが shell で `codex` を新規起動した場合は保持IDをクリアし、`codex resume ...` で起動した場合は保持IDを維持する  
12.34.4 Given: サブワーカーが次アクションを選ぶ, When: 判定を行う, Then: まずアドバイス本文と推奨入力候補を生成し、その後に最終適用（自動入力/Tab補完表示）を決める  
12.34.4.1 Given: モードが `ガンガン` または `慎重に` である, When: 最終適用を決める, Then: `confidence >= threshold` なら入力代行、未満ならアドバイス表示（Tab補完）にする  
12.34.4.2 Given: モードが `アドバイス` である, When: 最終適用を決める, Then: 常にアドバイス表示（Tab補完）にし、自動入力は行わない  
12.34.5 Given: サブワーカーが入力代行を実行する, When: 実行後の状態を扱う, Then: 状態は次の hook 到達まで変更しない  
12.34.6 Given: サブワーカー支援を継続する, When: 代理入力が連続しうる, Then: 短時間の連続代理入力には上限を設け（例: 20 秒で 3 回まで）、超過時はアドバイス表示へフォールバックして暴走を抑止する  
12.34.7 Given: サブワーカーが入力代行を行う, When: 実行を記録する, Then: 代行理由を 1 行で残す（少なくとも `confidence` と根拠要約を含む）  
12.34.8 Given: サブワーカーが判定・実行する, When: ログを保存する, Then: `mode/confidence/action/result` を各回記録する  
12.34.9 Given: 複数ターミナルが同時に動作する, When: サブワーカー判定を行う, Then: ターミナルごとに独立して判定・実行し、他ターミナル完了待ちをしない  
12.34.9.1 Given: ターミナル状態が変わっていない, When: 観測更新だけが発生する, Then: サブワーカーの再判定は行わない（状態遷移だけでは判定しない）  
12.34.9.2 Given: サブワーカー起動条件を評価する, When: 判定トリガーを選ぶ, Then: **hook 完了イベント `hook-complete`** でのみ判定する（`source=hook` の完了だけを扱う）  
12.34.9.3 Given: 完了イベントが未到達である, When: 完了状態がまだ無い, Then: サブワーカーは起動しない  
12.34.9.4 Given: `need_input` が hook 由来で確定する, When: サブワーカー起動可否を評価する, Then: hook 完了イベント（論理名 `hook-complete`）を起点に判定する  
12.34.9.5 Given: `hook-complete` の完了状態（`success|need_input|failure`）でサブワーカーが有効である, When: 起動判定を実行する, Then: サブワーカーは同一判定サイクル内に `start`（実行）または `skip`（理由付き不実行）のどちらかを必ず記録し、無記録のまま放置しない  
12.34.9.6 Given: サブワーカー実行制御を実装する, When: 稼働状態を保持する, Then: 制御の正本は単一状態オブジェクト `terminalState`（`unified.subworker_phase`=`idle|running|paused` と `runtime.subworker` / `runtime.automation`）とし、独立した複数フラグや別状態オブジェクトで判定分岐を増やさない  
12.34.9.7 Given: Orchestrator が内部で LLM ツール（例: codex）を実行する, When: completion-hook を監視している, Then: 内部ツール呼び出しは hooks 出力先を隔離し、hook-event が実行中セッションへ逆流して無限ループしないようにする  
12.34.9.8 Given: `hook-complete` が短時間に連続到達する（例: hook 再送や重複通知）, When: state/reason/最終入力/最終出力が同一文脈である, Then: サブワーカー起動は 1 回に畳み、同一文脈で `llm-start` を重複発火しない（`hook_complete_source` は重複判定キーに含めない）  
12.34.9.9 Given: ユーザーが `Esc` で手動介入したい, When: 自動処理/サブワーカーの処理中または判定待ちで `Esc` を押す, Then: `manual-hold` を有効化して hook/SubWorker を停止し、表示ステータスを `idle` に固定する。ユーザーが `Enter` で確定入力するまで自動処理を再開しない（in-flight の結果は破棄してよい）  
12.34.9.10 Given: Codex が処理中（`agentWorkActive`）である, When: サブワーカー入力行プレースホルダ表示可否を評価する, Then: 補完プレースホルダは描画しない（PTY本文出力への割り込みを防ぐ）。`subworker-running` スピナー表示だけは継続してよい  
12.34.10 Given: サブワーカーを一時停止する, When: ユーザーが Settings > AI Coding Agent の `一時停止` を押す, Then: 解除されるまでそのターミナルの自動支援を停止する  
12.34.11 Given: サブワーカーを一時停止せずに1回だけ回避したい, When: ユーザーが Settings > AI Coding Agent の `今回だけスキップ` を押す, Then: 次の 1 回の支援実行のみを抑止する  
12.34.12 Given: ターミナルステータスを報告する, When: 状態を外部へ通知する, Then: `idle` / `need_input` / `success` / `failure` / `subworker-running` を使い分ける（`subworker-running` を優先して報告する）。AI ツールは hook 到達時だけ状態を更新する  
12.35 Given: モードが `ガンガン` である, When: AI状態判定の完了状態（`success|need_input|failure`）を受ける, Then: サブワーカーを起動し、`confidence>=threshold` のときのみ入力代行する（未満はアドバイス表示）  
12.36 Given: モードが `慎重に` である, When: AI状態判定の完了状態（`success|need_input|failure`）を受ける, Then: サブワーカーを起動し、`confidence>=threshold` のときのみ入力代行する（未満はアドバイス表示）  
12.37 Given: モードが `アドバイス` である, When: AI状態判定の完了状態（`success|need_input|failure`）を受ける, Then: サブワーカーを起動し、入力代行は行わずアドバイス表示のみを行う  
12.37.1 Given: モードが `アドバイス` である, When: サブワーカーがアドバイス表示を行う, Then: ターミナル状態は `need_input` として扱う  

## 13. デバッグ/開発用機能
13.1 Given: デバッグ情報を確認したい, When: Watcher/Terminal を操作する, Then: デバッグは UI ボタンではなく JSONL ログで追跡する（`status_debug_events.jsonl` / `subworker_debug_events.jsonl` / `subworker_io_events.jsonl` / `project-prompt-history/*.jsonl`）  
13.2 Given: 状態デバッグログが ON（`status_debug_enabled=true`）, When: 状態遷移/フック受信/サブワーカー開始・結果等が発生する, Then: app_config_dir の `status_debug_events.jsonl` に JSONL 追記する  
13.3 Given: `status_debug_events.jsonl` へ追記する, When: 1 件のイベントを保存する, Then: `ts_ms` と `event_type` に加えて、`terminal_observed/agent_observed/merged_observed/status_state/judge/subworker` を同時に記録し、後追い解析できるようにする  
13.4 Given: Watcher の起動/再読込をデバッグする, When: `status_debug_enabled=true` で watcher を表示する, Then: `status_debug_events.jsonl` に `watcher-*` イベント（`load-settings` / `pack-catalog` / `deps` / `model-load` / `fallback` / `preparing-stuck`）を追記する  
13.5 Given: サブワーカーデバッグが ON, When: サブワーカーの `start/skip/result/pause/resume` が発生する, Then: app_config_dir の `subworker_debug_events.jsonl` に JSONL 追記する  
13.6 Given: `subworker_debug_events.jsonl` へ追記する, When: 1 件のイベントを保存する, Then: `ts_ms` と `event_type`、およびサブワーカー状態（phase/mode/threshold/action/result など）を同時記録する  
13.7 Given: サブワーカーデバッグが ON, When: 初回保存に成功する, Then: Terminal 本文に `subworker-debug-file: <path>` を表示し、解析対象ファイルを即時確認できるようにする  
13.8 Given: サブワーカー判定を追跡する, When: `start/skip/result` を記録する, Then: `hook_complete_event`（固定 `hook-complete`）と `hook_complete_source`（`hook`）を保存し、`skip` の場合は理由を必須にする  
13.8.1 Given: Codex / ClaudeCode の hook を受ける, When: `cwd` と `input-messages` / `last-assistant-message` を抽出できる, Then: app_config_dir の `project-prompt-history/<project-key>.jsonl` に 1 件追記し、project ごとに最終入力/最終出力を残す  
13.8.2 Given: `project-prompt-history/<project-key>.jsonl` へ追記する, When: 1 件の hook 完了を保存する, Then: `ts_ms` / `source` / `hook_kind` / `state` / `cwd` / `project_key` / `input_messages` / `last_assistant_message` を記録し、必要なら `thread_id` / `turn_id` / `source_session_id` も併記する  
13.9 Given: terminal-output-broadcast を有効化する, When: `NAGOMI_ENABLE_TERMINAL_OUTPUT_BROADCAST=1`, Then: 端末出力を `terminal-output-broadcast` イベントとして emit する  
13.10 Given: worker I/O のデバッグを行う, When: `NAGOMI_DEBUG_WORKER_IO=1`, Then: worker 入出力ログを app_config_dir の `worker_smoke.log` に追記する  
13.11 Given: テスト用 HTTP エンドポイントを使う, When: `NAGOMI_ENABLE_TEST_ENDPOINTS=1`, Then: `/terminal-send` を有効化する（詳細は 10.3.5）  
