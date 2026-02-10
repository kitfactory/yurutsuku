# 仕様

入口は `docs/OVERVIEW.md`。Given/When/Then（前提/条件/振る舞い）で番号付きに整理する。

## 1. セッション/ターン
1.1 Given: `start_session` を受け取る, When: Orchestrator が処理する, Then: session を作成し既定値（name/worker_id など）を付与する  
1.2 Given: `send_input` を送信する, When: UI から入力が確定する, Then: phase を thinking に遷移させる  
1.3 Given: 出力が一定時間止まる, When: 沈黙タイムアウト（既定 30s）に到達, Then: turn_completed 候補を生成する  
1.4 Given: exit_code が確定する, When: `exit` を受信する, Then: turn_completed を確定させる  
1.5 Given: レーンの表示行数が上限に達する, When: 追加出力が来る, Then: 先頭から破棄してスクロールバックを維持する（既定 5,000 行 / 上限 20,000 行）  

## 2. UI（Chat/Run/キャラクター）
2.1 Given: Chat モードを開く, When: UI を描画する, Then: 左に対話レーン、右下にキャラクターを表示する  
2.2 Given: 末尾追従が ON, When: 新しい出力が来る, Then: 自動スクロールで末尾に追従する  
2.3 Given: ユーザーが上方向にスクロールする, When: 追従解除条件を満たす, Then: 末尾追従を OFF にする  
2.4 Given: トレイメニューを表示する, When: 項目一覧を表示する, Then: `Open Terminal Window` / `Arrange Terminal Windows` / `Open Settings` / `Quit` のみを表示する（`Open Chat` / `Open Run` / `worker_*` は表示しない）  
2.5 Given: Run のタイル配置を行う, When: セッション一覧を描画する, Then: 各モニタの作業領域ごとにターミナルウィンドウを均等グリッドで並べる（現位置の中心点で上→下、左→右の順に並び替える / 同一行判定は中心点の y 差が作業領域高の約 12%（最低 80px）以内）  
2.6 Given: 各モニタ内のウィンドウ数が 4 以上, When: 配置する, Then: 2 行で並べる  
2.7 Given: 各モニタ内のウィンドウ数が 9 以上, When: 配置する, Then: 3 行で並べる  
2.8 Given: タイル表示を行う, When: セッションが更新される, Then: 小さな表情/状態/ログがタイル上に表示される  
2.9 Given: タイルを選択する, When: ピックアップする, Then: 対応するターミナルウィンドウを同じモニタの作業領域内で中央に寄せ、作業領域の約 80% で大きく表示する  
2.9.0 Given: 複数のターミナルがあり整列済みである, When: 非選択ターミナルをユーザーが選択する（Run タイルの選択 / Terminal 本文クリック）, Then: SelectionState を選択先へ交代し、選択ウィンドウの拡大表示を適用する  
2.9.1 Given: Run タイルまたは Terminal 本文をダブルクリックする, When: クリック元に対応するターミナル位置が取得できる, Then: クリック元と同じ位置/サイズで新しいターミナルウィンドウを 1 つ追加する（取得できない場合は通常位置で追加する）  
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
2.17 Given: ターミナル入力が行われる, When: 入力が確定する, Then: PTY/Worker に入力が送られる  
2.18 Given: PTY/Worker から出力が届く, When: 受信する, Then: ターミナルに表示されスクロールバックが更新される  
2.19 Given: ユーザーがコピー/ペースト操作を行う, When: ターミナルにフォーカスがある, Then: OS のクリップボードで操作できる  
2.20 Given: ターミナルウィンドウのサイズが変わる, When: リサイズが確定する, Then: PTY/Worker にサイズ変更が送られる  
2.21 Given: ターミナル設定を変更する, When: 設定を保存する, Then: フォント/テーマ/スクロールバックが反映される  
2.21.1 Given: P0 既定値を参照する, When: 初回起動で settings が未作成, Then: 既定値を採用する（実装参照: `apps/orchestrator/src-tauri/src/main.rs` の `Settings::default`、UI 参照: `apps/orchestrator/src/index.html` の `terminalSettingsDefaults`）  
2.21.2 Given: トレイの Settings を開く, When: トレイメニューから設定画面を選ぶ, Then: `view=settings` の設定画面が表示される  
2.22 Given: IME を使う, When: 変換操作を行う, Then: OS の IME に従って入力できる（専用処理は持たない）  
2.23 Given: ターミナル画面を表示する, When: 描画する, Then: 画面内の表示は PTY 出力のみで構成し、説明文や装飾テキストは表示しない  
2.24 Given: ターミナルが表示中, When: 観測（Watcher）を表示する, Then: **全ターミナルを代表する状態**を右下のキャラクターで示す（実装参照: `apps/orchestrator/src/assets/watcher/nagomisan_*.png` / 元データ: `apps/orchestrator/src/assets/watcher/nagomi_fullbody_icons_96_v3.zip`）  
2.24.1 Given: 観測（Watcher）を表示する, When: 表示設定が ON, Then: **別ウィンドウ（透過）**でフルボディ（96x192）を右下に表示する  
2.24.2 Given: 観測（Watcher）を表示する, When: 表示設定が OFF, Then: 透過ウィンドウを表示しない  
2.24.3 Given: 観測表示を行う, When: 全体状況で表情/モーションを選ぶ, Then: `need_input` は呼びかけ、`running` は作業中、`failure` は困った、`idle/success` は眠い表情として表示する  
2.24.4 Given: 観測表示を行う, When: 3Dキャラ（VRM）が設定済み, Then: 3D表示を優先する（未設定なら2D画像を表示する）  
2.25 Given: 観測状態が変化する, When: 状態を適用する, Then: terminal の背景に対して半透明でトーンの揃った tint を重ねて状態を区別する  
2.25.1 Given: 状態を表示する, When: 表示色を決める, Then: **色は以下で固定**する（黒=idle/success、青=running、赤=need_input/failure）  
2.25.2 Given: 画面に文言を表示する, When: UI を描画する, Then: 表示文言はリソース管理し **日本語/英語** を用意する  
2.26 Given: プロセスが終了する, When: exit_code を受信する, Then: 即時に `success`（exit_code=0）または `fail`（exit_code!=0）として確定する  
2.27 Given: プロセスが生存している, When: 観測を行う, Then: 通常は `running` を維持し、**終了候補イベント**（出力無更新 30s / hook completed|error|need_input）を受けたときのみ Judge を走らせて `success/failure/need_input` に遷移する  
2.27.1 Given: **AI判定** が OFF, When: hook が来る/出力無更新 30s になる, Then: hook 種別（completed/error/need_input）をそのまま state に反映する（idle は `need_input` とみなす）  
2.27.2 Given: **AI判定** が OFF かつ agent 未検知, When: 末尾がプロンプト風（例: `[y/n]`, `Press Enter`, `password:`）を検出する, Then: 誤爆回避を優先し、強い兆候のときのみ `need_input` に遷移する  
2.27.3 Given: 観測を実装する, When: P0 を実装する, Then: 観測ロジックは純粋関数として切り出し unit test できる（実装参照: `apps/orchestrator/src/terminal_observer.js`）  
2.27.4 Given: `idle/success/failure` の状態にある, When: `need_input` 相当のイベント（hook/heuristic）を受ける, Then: **`need_input` へ直行せず一度 `running` を経由してから** `need_input` を確定する  

## 3. Judge
3.1 Given: exit_code が 0, When: 判定する, Then: state を success にする  
3.2 Given: exit_code が 0 以外, When: 判定する, Then: state を failure にする  
3.3 Given: exit_code 不明, When: 末尾ログが正規表現にヒット, Then: state を failure にする（Heuristic）  
3.4 Given: exit_code 不明, When: 出力が 30s 無更新, Then: state を need_input にする（Heuristic）  
3.5 Given: Judge 入力を作る, When: P0 を実装する, Then: **出力のみ**から末尾 1500 字に切り、さらに末尾 50 行に整形して渡す  
3.6 Given: **AI判定** が ON, When: 終了候補イベントを受ける, Then: 選択した **AI Coding Agent**（codex/claudecode/opencode）を JSON 出力指定で実行し `state: success/failure/need_input` と `summary` を得る  
3.7 Given: **AI判定** が失敗, When: 結果が得られない, Then: Heuristic 結果（3.1〜3.4）にフォールバックする  
3.8 Given: フック観測で「停止（完了/入力待ち）」を検知, When: **AI判定** が ON, Then: 末尾ログを再判定して最優先で採用する  

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
6.2 Given: **AI判定** が OFF, When: ログを扱う, Then: 外部送信しない  

## 7. Settings
7.1 Given: 設定画面を開く, When: 設定項目を表示する, Then: 通知/音量/沈黙タイムアウト/**AI判定/AI Coding Agent**/キャラ/ログ保持/外観（テーマ/フォント/サイズ/スクロールバック/コピー）を編集できる  
7.1.1 Given: 設定画面を表示する, When: 外観の優先度を上げる, Then: 外観セクションを先頭に配置する  
7.1.2 Given: フォント設定を行う, When: 設定画面を表示する, Then: フォントはリスト選択式で表示する  
7.1.3 Given: OS のローカルフォント一覧を取得できる, When: ユーザーが読み込み操作を行う, Then: OS フォントを選択肢に追加する（未対応の場合は既定リストのみ）  
7.1.4 Given: 設定が変更される, When: 設定を保存する, Then: 変更内容を全ウィンドウに通知し、起動済みターミナルの表示にも即時反映する  
7.1.5 Given: OS が Windows, When: 設定画面を表示する, Then: ターミナル起動方式として `CMD` / `PowerShell` / `WSL` を選択できる  
7.1.6 Given: 起動方式が `WSL`, When: 設定画面を表示する, Then: インストール済みディストロ一覧（`wsl -l -q`）から対象ディストロを選択できる（未選択は既定ディストロを使う）  
7.1.7 Given: OS が Windows 以外, When: 設定画面を表示する, Then: Windows 専用の起動方式設定は表示しない  
7.1.8 Given: OS が Windows, When: 設定画面を表示する, Then: 起動方式設定は `外観` ではなく `Windows` カテゴリで表示する  
7.1.9 Given: 設定画面でテーマを選択する, When: 外観を変更する, Then: **1つのテーマ選択UI**から 8 種類（`light-sand` / `light-sage` / `light-sky` / `light-mono` / `dark-ink` / `dark-ocean` / `dark-ember` / `dark-mono`）を選択できる（配色パレットの別ドロップダウンは表示しない）  
7.1.10 Given: 設定画面（Windows カテゴリ）を表示する, When: キーバインドを編集する, Then: `整列` / `次へ移動` / `前へ移動` のショートカットを変更して保存できる（既定 `Ctrl+Shift+Y` / `Ctrl+Shift+J` / `Ctrl+Shift+K`）  
7.1.11 Given: 設定画面をリサイズする, When: 幅が狭くなる, Then: 2 列レイアウトは十分な幅でのみ有効になり、狭幅では 1 列に切り替えて項目が潰れない  
7.2 Given: 通知設定を編集する, When: 設定を変更する, Then: OS トースト通知の ON/OFF と音声通知の ON/OFF を切り替えられる  
7.3 Given: **AIターミナル状態判定（AI判定）**を編集する, When: ツールを選択する, Then: codex/claudecode/opencode のいずれかを選べる（内部識別子は `codex` / `claude` / `opencode`）  
7.3.1 Given: AI Coding Agent を選ぶ, When: 設定を保存する, Then: **ターミナルでの起動コマンド判別**に使う  
7.3.2 Given: **AI判定** が ON, When: 状態検出を行う, Then: AI Coding Agent の完了/入力待ち通知と判定結果を用いて状態を決める  
7.3.3 Given: **AI判定** が OFF, When: 状態検出を行う, Then: 端末出力のみで状態を判定する  
7.4 Given: キャラクター追加を行う, When: zip をアップロードする, Then: サムネ/画像/音声（任意）を含むキャラコンテンツとして扱える  
7.4.1 Given: ターミナルキャラクター表示を編集する, When: 設定を変更する, Then: ターミナル右下のキャラクター表示を ON/OFF できる  
7.4.2 Given: 3Dキャラクターを使う, When: VRM を設定する, Then: 3D表示は **VRM** を読み込み、2D画像より優先して表示する  
7.4.3 Given: 3Dキャラクターで状態ごとのモーションを設定する, When: VRM Animation（`.vrma`）を割り当てる, Then: `idle/success`→`idle`、`running`→`running`、`need_input`→`need_input`、`failure`→`fail` の対応で再生する  
7.4.4 Given: 状態モーションが未設定, When: 3D表示を行う, Then: `idle` を再生し、`idle` 未設定なら静止にフォールバックする  
7.5 Given: AI Coding Agent セクションを表示する, When: 設定画面を開く, Then: 「使用ツール」「AIターミナル状態判定」のみを表示する（連携ボタンは表示しない）  
7.6 Given: AI Coding Agent を使う, When: 設定を保存する, Then: 使用する AI ツールを 1 つ選択できる（codex/claudecode/opencode）  
7.7 Given: AI Coding Agent を選択する, When: 設定画面を表示する, Then: 「選択したAIツールは起動コマンド判別とAI判定の対象になる」旨を説明する  
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
10.2.3 Given: ユーザーが `nagomi` を繰り返し起動する, When: `--session-id` を指定しない, Then: 起動のたびに追加で新しい terminal window を開く  
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
10.4 Given: Windows 環境で `worker_backend = wsl`, When: Worker を起動する, Then: Orchestrator は `wsl.exe` 経由で Linux Worker を起動する  
10.5 Given: Windows 環境で `worker_backend = windows` または未指定, When: Worker を起動する, Then: Orchestrator は Windows Worker を起動する  
10.6 Given: WSL で Worker を起動する, When: Linux 側コマンドを指定する, Then: `wsl.exe -d <distro> -- <command>` 形式で実行する  
10.7 Given: WSL ターミナルを対話的に扱う, When: 端末入力/制御を行う, Then: ConPTY を用いて `wsl.exe` を接続する  
10.7.1 Given: Windows で terminal session を開始する, When: 起動方式が `CMD`, Then: 起動コマンドは `cmd.exe` を使う  
10.7.2 Given: Windows で terminal session を開始する, When: 起動方式が `PowerShell`, Then: 起動コマンドは `powershell.exe` を使う  
10.7.3 Given: Windows で terminal session を開始する, When: 起動方式が `WSL` かつディストロ未指定, Then: 起動コマンドは `wsl.exe` を使う  
10.7.4 Given: Windows で terminal session を開始する, When: 起動方式が `WSL` かつディストロ指定あり, Then: 起動コマンドは `wsl.exe -d <distro>` を使う  
10.8 Given: Worker の起動に失敗する, When: 再起動を試みる, Then: 再接続手段を提示しユーザーは再試行できる  
10.9 Given: Windows で Terminal session を開始する, When: PTY を起動する, Then: 環境変数は「通常の cmd/PowerShell と同等」を目指して同期する（現在の環境を優先しつつ、System/User の環境変数を不足分だけ補完し、PATH は不足分だけ後ろに追加する）  
10.10 Given: OS が Windows, When: Orchestrator/Worker/PTY を起動する, Then: **余分なコンソールウィンドウを表示せず**、ユーザーには Terminal（+ tray）だけが見える状態を保つ  

## 11. 外部ツールフック（観測/完了検知）
11.1 Given: 外部ツールのフック通知を受け取る, When: 正規化する, Then: `hook_event` を生成する（`source`, `kind`, `ts_ms`, `source_session_id?`, `raw?`）  
11.1.1 Given: Terminal session を開始する, When: AI ツールが起動される, Then: `NAGOMI_SESSION_ID` を環境変数に付与し hook に `source_session_id` を伝播する  
11.2 Given: `hook_event.kind = completed`, When: 受信する, Then: 「停止（完了）検知」として扱い Judge を実行する（success/failure/need_input を決める）  
11.3 Given: `hook_event.kind = error`, When: 受信する, Then: 「停止（完了）検知」として扱い Judge を実行する（失敗になるなら failure を優先する）  
11.4 Given: 「停止（完了）検知」を行う, When: Judge の判定結果が確定する, Then: 判定結果に応じて次のステップへ進める  
11.5 Given: `hook_event.kind = need_input`, When: 受信する, Then: 「停止（入力待ち）検知」として扱い Judge を実行する  
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
notify = "nagomi-codex-notify"
# fallback:
# notify = "node <path>/nagomi_codex_notify.js"
```
11.20 Given: codex の notify を使う, When: フック受信スクリプト（`nagomi-codex-notify` または `nagomi_codex_notify.js`）を実行する, Then: JSON 文字列 1 個を引数で受け取り `hook_event` に正規化する  
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
11.28 Given: `hook_event` を受信する, When: `kind = completed|error`, Then: Judge を起動して完了状態を確定する  
11.29 Given: `hook_event` を受信する, When: `kind = need_input`, Then: Judge を起動して need_input を判定する  
11.30 Given: フック取得対象ツールが未設定, When: 起動する, Then: `CompletionHookManager` はフック待受を行わない  

## 12. nagomi 要件（並列作業/状態/グループ/終了検知）
12.1 Given: 複数のターミナルが並列稼働している, When: ペイン数が増える, Then: 迷子にならず「状態/次の一手」が分かる（流れを止めない）  
12.2 Given: 既存の開発環境/CLI/プロジェクト構成がある, When: nagomi を導入する, Then: 大きな変更を要求しない（AIツール選択時は該当ツールの設定ファイルへの最小追加は許容する）  
12.3 Given: 長時間放置/再起動が発生する, When: 復帰する, Then: 状態が破綻しにくく、観測が継続/復帰できる  
12.4 Given: ペインの状態を扱う, When: 一覧/バッジ/通知を更新する, Then: 状態は `idle/running/need_input/success/failure/disconnected` のいずれかに限定する（`waiting_input` は `need_input` の別名として扱う。`streaming` は独立状態とせず `running` に統合する）  
12.5 Given: 状態をユーザーに伝える, When: 一覧/バッジ/通知を表示する, Then: 「人の目で追うログ」ではなく状態を前面に出す  
12.6 Given: ターミナルをグループ化する, When: 並列作業を扱う, Then: WIP の塊/視線移動コスト削減/状態集約/復帰を満たす  
12.7 Given: グループの粒度を決める, When: UI を設計する, Then: Workspace / Task Group / Pane の 3 層で表現する（実装は任意タグ集合でもよい）  
12.8 Given: 自動グループ化を行う, When: 情報が取得できる, Then: `CWD` と「コマンドによる指定（起動コマンド/タグ）」を同時に候補に入れ、衝突時は **分割せず同一グループに統合**する（手動補正は追加タグとして扱う）  
12.9 Given: グループの状態を集約する, When: 代表値を算出する, Then: `health/active/blocked` を表示し、`health` は `failure` が1つでもあれば Bad、`need_input/disconnected` があれば Warn、それ以外は OK とする  
12.10 Given: 終了検知を部品化する, When: 設計する, Then: TerminalStateDetector / AgentEventObserver / StateIntegrator に分離し unit test 可能にする  
12.11 Given: ペイン終了を検知する, When: PTY/プロセスが終了する, Then: `exit_code` が取れれば `success/failure`、取れない場合は `success` として扱い、明示的な切断であれば `disconnected` に遷移する  
12.12 Given: コマンド終了を検知する, When: 方法を選ぶ, Then: 優先度は A) 実行ラッパ（shim） > B) シェル統合（PROMPT フック） > C) 出力パターン推定 とする  
12.13 Given: Terminal状況検知の条件取得を行う, When: 入力/出力/終了を観測する, Then: PTY の `input` / `output` / `exit`（exit_code）を主要ソースとして取得する  
12.14 Given: Terminal状況検知の条件判断を行う, When: 条件を評価する, Then: `exit` があれば `success/failure`、それ以外は `running` を維持する（終了候補は Judge に委譲する）  
12.14.1 Given: AIツールの開始を扱う, When: 入力が確定する, Then: **AIツールのコマンド入力のみ**を開始イベントとして扱う（対話中の Enter も開始イベント）  
12.15 Given: CLI エージェントを観測する, When: イベントを正規化する, Then: `agent.started/thinking/running/need_input/success/failure/progress/artifact` に揃える  
12.16 Given: CLI エージェントのイベント取得を行う, When: 取得方式を決める, Then: 公式イベント > 安定ログ > ヒューリスティックの順で使う  
12.17 Given: AIツールイベントの条件判断を行う, When: 正規化イベントを評価する, Then: `started/thinking/running` は `running`、`need_input` は `need_input`、`success/failure` は `success/failure` として扱う（`progress/artifact` は状態を変えない）  
12.18 Given: ターミナル状況から状態を判断する, When: PTY/プロセスが生存している, Then: **出力無更新 30s** を終了候補として Judge を起動し、`success/failure/need_input` を決める  
12.19 Given: ターミナル監視とエージェント監視が両方ある, When: 状態を統合する, Then: エージェントイベントが来ている間は `agent` 側を優先し、`success/failure/need_input` は次の `running`（新しい実行開始）または `/quit` まで維持する（別コマンドが動作中なら `running` を優先）  
12.20 Given: 最小状態機械を定義する, When: 状態遷移を行う, Then: `idle -> running`（コマンド開始）, `running -> need_input`（終了候補判定）, `running -> success/failure`（exit_code or Judge）, `need_input -> running`（入力送信）, いつでも `disconnected` へ遷移可能とする  
12.20.1 Given: 状態遷移を実装する, When: `need_input` を扱う, Then: `idle/success/failure -> need_input` の直接遷移は禁止し、`running` 経由を強制する  
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
    "state": "running",
    "last_activity_at": "2026-01-29T12:34:56+09:00"
  },
  "job": {
    "id": "j77",
    "pane_id": "p9",
    "kind": "agent",
    "tool": "codex",
    "state": "running",
    "exit_code": null
  }
}
```
12.22 Given: 最小テスト観点を定める, When: P0 の壊れにくさを確認する, Then: PTY 終了（正常/異常/強制 kill/WSL 再起動/SSH 切断）/コマンド終了（exit code 0/非0）/入力待ち遷移/誤検知耐性/復帰の 5 点を確認する  
12.23 Given: ターミナルを起動する, When: 初期表示する, Then: 状態は `idle`（黒）として扱う  
12.24 Given: codex を起動する, When: `codex` コマンドだけを入力する, Then: 状態は **変化させない**（idle/success のまま）  
12.25 Given: codex に作業プロンプトを入力する, When: 処理が開始される, Then: 状態は `running`（青）になる  
12.26 Given: codex の処理が完了する, When: 完了を検知する, Then: 状態は `success`（黒）を **維持**する  
12.27 Given: codex が入力を要求する, When: input/permission/request を検知する, Then: 状態は `need_input`（赤）になる  
12.28 Given: codex を `/quit` で抜ける, When: セッション終了を検知する, Then: 状態は `idle`（黒）になる  
12.29 Given: 通常コマンドを実行する, When: コマンド入力が確定する, Then: 状態は `running`（青）になる  
12.30 Given: 通常コマンドが入力要求する, When: prompt を検知する, Then: 状態は `need_input`（赤）になる  
12.31 Given: 通常コマンドが正常終了する, When: exit_code=0 を検知する, Then: 状態は `success`（黒）を **維持**する  
12.32 Given: 通常コマンドが異常終了する, When: exit_code!=0 を検知する, Then: 状態は `failure`（赤）になる  

## 13. デバッグ/開発用機能
13.1 Given: Terminal 画面でデバッグ UI を扱う, When: `debug ui: on/off` を切り替える, Then: デバッグバッジと保存ボタンの表示を切り替える（表示状態はローカルに保存する）  
13.2 Given: デバッグ UI が表示中, When: 状態/入力/イベントが更新される, Then: デバッグバッジに state と簡易情報を表示する  
13.3 Given: デバッグスナップショットを保存する, When: `save debug snapshot` を押す, Then: 現在の入力/イベント/状態を JSONL 1 行として保存する（保存先: app_config_dir の `terminal_debug_snapshots.jsonl`）  
13.4 Given: デバッグスナップショットを保存する, When: 保存する, Then: `ts_ms` を付与して追記保存する  
13.5 Given: terminal-output-broadcast を有効化する, When: `NAGOMI_ENABLE_TERMINAL_OUTPUT_BROADCAST=1`, Then: 端末出力を `terminal-output-broadcast` イベントとしてアプリ全体へ emit する  
13.6 Given: worker I/O のデバッグを行う, When: `NAGOMI_DEBUG_WORKER_IO=1`, Then: worker の入出力に関するログを app_config_dir の `worker_smoke.log` に追記する  
13.7 Given: テスト用 HTTP エンドポイントを使う, When: `NAGOMI_ENABLE_TEST_ENDPOINTS=1`, Then: `/terminal-send` を有効化する（詳細は 10.3.5 に従う）  
13.8 Given: デバッグスクリーンショットを保存する, When: `save debug screenshot` を押す, Then: WebView2 DevTools の `Page.captureScreenshot` で取得し、app_config_dir の `terminal_debug_screenshots/terminal-<ts>.png` に保存する  
13.9 Given: デバッグスクリーンショットを保存する, When: 取得後に PNG が 3s 以内に生成されない, Then: 失敗として扱い保存を中断する  
13.10 Given: デバッグスクリーンショットを保存する, When: 取得に失敗する, Then: 可能な範囲で `worker_smoke.log` に失敗理由を記録する  

