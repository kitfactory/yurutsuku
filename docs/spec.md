# 仕様

入口は `docs/OVERVIEW.md`。Given/When/Then（前提/条件/振る舞い）で番号付きに整理する。

## 1. セッション/ターン
1.1 Given: `start_session` を受け取る, When: Orchestrator が処理する, Then: session を作成し既定値（name/worker_id など）を付与する  
1.2 Given: `send_input` を送信する, When: UI から入力が確定する, Then: phase を thinking に遷移させる  
1.3 Given: 出力が一定時間止まる, When: 沈黙タイムアウト（既定 3.5s）に到達, Then: turn_completed 候補を生成する  
1.4 Given: exit_code が確定する, When: `exit` を受信する, Then: turn_completed を確定させる  
1.5 Given: レーンの表示行数が上限に達する, When: 追加出力が来る, Then: 先頭から破棄してスクロールバックを維持する（既定 5,000 行 / 上限 20,000 行）  

## 2. UI（Chat/Run/キャラクター）
2.1 Given: Chat モードを開く, When: UI を描画する, Then: 左に対話レーン、右下にキャラクターを表示する  
2.2 Given: 末尾追従が ON, When: 新しい出力が来る, Then: 自動スクロールで末尾に追従する  
2.3 Given: ユーザーが上方向にスクロールする, When: 追従解除条件を満たす, Then: 末尾追従を OFF にする  
2.4 Given: Run 画面を開く, When: トレイから起動する, Then: 整列/順序設定の操作パネルとして表示される  
2.5 Given: Run のタイル配置を行う, When: セッション一覧を描画する, Then: 各モニタの作業領域ごとにターミナルウィンドウを均等グリッドで並べる（現位置の中心点で上→下、左→右の順に並び替える / 同一行判定は中心点の y 差が作業領域高の約 12%（最低 80px）以内）  
2.6 Given: 各モニタ内のウィンドウ数が 4 以上, When: 配置する, Then: 2 行で並べる  
2.7 Given: 各モニタ内のウィンドウ数が 9 以上, When: 配置する, Then: 3 行で並べる  
2.8 Given: タイル表示を行う, When: セッションが更新される, Then: 小さな表情/状態/ログがタイル上に表示される  
2.9 Given: タイルを選択する, When: ピックアップする, Then: 対応するターミナルウィンドウを同じモニタの作業領域内で中央に寄せ、作業領域の約 80% で大きく表示する  
2.10 Given: 整列ショートカットを押す, When: トリガーされる, Then: すべてのターミナルウィンドウがタイル配置される  
2.11 Given: ターミナルウィンドウで Ctrl+Shift+J, When: 押下する, Then: 選択中のウィンドウを起点に同じ画面内で次のターミナルへ移動し、末尾なら次の画面の先頭へ移動する  
2.12 Given: ターミナルウィンドウで Ctrl+Shift+K, When: 押下する, Then: 選択中のウィンドウを起点に同じ画面内で前のターミナルへ移動し、先頭なら前の画面の末尾へ移動する  
2.13 Given: 複数のモニタがある, When: 画面の順序を決める, Then: 各モニタの作業領域の位置（x, y）の昇順で並べる  
2.14 Given: phase が更新される, When: キャラクター表情を決める, Then: 優先順位に従って表情を切り替える  
2.15 Given: success/error/attention になる, When: 表情保持時間に到達, Then: idle/thinking に戻す（既定 4s）  
2.16 Given: Terminal 画面を開く, When: UI を描画する, Then: ターミナル表示領域が初期化される  
2.16.1 Given: 複数の Terminal window を開く, When: `Open Terminal Window` / `GET /open-terminal` で追加する, Then: window ごとに別 `session_id` を持ち入力/出力は共有されない  
2.17 Given: ターミナル入力が行われる, When: 入力が確定する, Then: PTY/Worker に入力が送られる  
2.18 Given: PTY/Worker から出力が届く, When: 受信する, Then: ターミナルに表示されスクロールバックが更新される  
2.19 Given: ユーザーがコピー/ペースト操作を行う, When: ターミナルにフォーカスがある, Then: OS のクリップボードで操作できる  
2.20 Given: ターミナルウィンドウのサイズが変わる, When: リサイズが確定する, Then: PTY/Worker にサイズ変更が送られる  
2.21 Given: ターミナル設定を変更する, When: 設定を保存する, Then: フォント/テーマ/スクロールバックが反映される  
2.22 Given: IME を使う, When: 変換操作を行う, Then: OS の IME に従って入力できる（専用処理は持たない）  
2.23 Given: ターミナル画面を表示する, When: 描画する, Then: 画面内の表示は PTY 出力のみで構成し、説明文や装飾テキストは表示しない  
2.24 Given: ターミナルが表示中, When: 観測（Watcher）を表示する, Then: 右下にキャラクター（nagomisan）を重ねて表示し、状態が一目で分かる  
2.25 Given: 観測状態が変化する, When: 状態を適用する, Then: terminal の背景に対して半透明でトーンの揃った tint を重ねて状態を区別する  
2.26 Given: プロセスが終了する, When: exit_code を受信する, Then: 即時に `success`（exit_code=0）または `fail`（exit_code!=0）として確定する  
2.27 Given: プロセスが生存している, When: 無出力が続く, Then: 観測ベースで `running/stalled/need_input` を推定する（P0 既定は `stalled=60s`、`need_input=15s` かつ末尾がプロンプト風の場合のみ）  
2.27.1 Given: `need_input` 推定を行う, When: 末尾がプロンプト風（例: `[y/n]`, `Press Enter`, `password:`）で無出力が続く, Then: 誤爆回避を優先し、強い兆候のときのみ `need_input` に遷移する  

## 3. Judge
3.1 Given: exit_code が 0, When: 判定する, Then: state を success にする  
3.2 Given: exit_code が 0 以外, When: 判定する, Then: state を failure にする  
3.3 Given: exit_code 不明, When: 末尾ログが正規表現にヒット, Then: state を attention にする  
3.4 Given: failure/attention, When: summary を作る, Then: 末尾ログから 1〜2 行を抽出する  
3.5 Given: LLM Judge が ON, When: failure/attention になる, Then: マスク済みログを使って LLM を呼ぶ  
3.6 Given: LLM Judge が失敗, When: 結果が得られない, Then: Heuristic 結果にフォールバックする  

## 4. 通知（OS/音声）
4.1 Given: turn_completed で failure/attention, When: 通知設定が ON, Then: OS トーストを送る  
4.2 Given: turn_completed で failure/attention, When: 音声設定が ON, Then: 音声を再生する  
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
6.2 Given: LLM Judge が OFF, When: ログを扱う, Then: 外部送信しない  

## 7. Settings
7.1 Given: 設定画面を開く, When: 設定項目を表示する, Then: 通知/音量/沈黙タイムアウト/LLM/キャラ/ログ保持/ターミナル設定（テーマ/フォント/サイズ/スクロールバック/コピー）を編集できる  
7.2 Given: 通知設定を編集する, When: 設定を変更する, Then: OS トースト通知の ON/OFF と音声通知の ON/OFF を切り替えられる  
7.3 Given: LLM Judge を編集する, When: ツールを選択する, Then: codex/claude/opencode のいずれかを選べる  
7.4 Given: キャラクター追加を行う, When: zip をアップロードする, Then: サムネ/画像/音声（任意）を含むキャラコンテンツとして扱える  

## 8. 環境変数/.env
8.1 Given: ローカル開発で環境変数を扱う, When: `.env` を用意する, Then: `.env` はリポジトリに含めず `.env.example` をテンプレートとして使う  
8.2 Given: 環境変数を追加/変更する, When: `.env.example` を更新する, Then: 変数名/意味/既定値/必須性を `docs/spec.md` に追記する  
8.3 Given: P0 時点, When: 環境変数一覧を確認する, Then: 必須の環境変数は存在しない  
8.4 Given: 環境変数一覧を参照する, When: P0 時点, Then: 以下は任意の環境変数として利用できる  
- YURUTSUKU_TOOL_CLI: 使用する CLI（固定小文字、実行ファイル名と同一 / 例: codex, claude, opencode、既定: codex）
- YURUTSUKU_TOOL_PATH: CLI の実行パス（未指定なら PATH 解決）
- YURUTSUKU_TOOL_ARGS: 追加引数（空白区切り）
- YURUTSUKU_TOOL_TIMEOUT_MS: 実行タイムアウト(ms）
- YURUTSUKU_ORCH_HEALTH_PORT: ヘルスチェックポート（未指定なら 17707）
- YURUTSUKU_ENABLE_TERMINAL_OUTPUT_BROADCAST: terminal-output-broadcast を有効化（`1` のとき有効、既定: 無効）

## 9. IPC通信セッション
9.1 Given: UI が起動する, When: `ipc_session_open` を呼ぶ, Then: `session_id`/`server_epoch`/`phase` を返しセッションを登録する  
9.2 Given: セッションが有効, When: `ipc_session_probe` を呼ぶ, Then: `session_id`/`phase`/`last_seen_ms` を返す  
9.3 Given: セッションが有効, When: `ipc_session_echo` を呼ぶ, Then: `message` をそのまま返し `last_seen_ms` を更新する  
9.4 Given: セッションが無効, When: `ipc_session_probe`/`ipc_session_echo` を呼ぶ, Then: エラーを返す  
9.5 Given: セッションを終了する, When: `ipc_session_close` を呼ぶ, Then: セッションを削除し以後の呼び出しはエラーになる  
9.6 Given: IPCセッションがない, When: IPCコマンドを呼ぶ, Then: `ipc_session_id` が不正としてエラーを返す  

## 10. 起動/バックエンド分岐（Windows + WSL）
10.1 Given: ユーザーが `yuru`（launcher）を起動する, When: Orchestrator が未起動, Then: Orchestrator を起動し Worker を起動する  
10.2 Given: ユーザーが `yuru`（launcher）を起動する, When: Orchestrator が起動済み, Then: Orchestrator は起動済みとして扱い terminal window を開く  
10.2.1 Given: Orchestrator を起動する, When: `--start-hidden` を付与する, Then: 初期 window（Chat）は表示しない（tray から操作する）  
10.2.2 Given: Orchestrator を起動する, When: `--exit-on-last-terminal` を付与する, Then: 最後の terminal session が停止した時点で Orchestrator は終了する  
10.3 Given: Orchestrator の起動済み判定を行う, When: プロセス名で検出した後に IPC probe を試す, Then: IPC が応答しない場合は未起動として扱う  
10.3.1 Given: 起動済み判定を行う, When: CLI から生存確認が必要, Then: `127.0.0.1` のヘルスチェックエンドポイントで確認する  
10.3.2 Given: ヘルスチェックを行う, When: `GET /health` にアクセスする, Then: `{"status":"ok","pid":<number>}` を返す  
10.3.3 Given: ヘルスチェックポートを決める, When: `YURUTSUKU_ORCH_HEALTH_PORT` が未指定, Then: 既定ポートは `17707` を使う  
10.3.4 Given: terminal window を開く, When: `GET /open-terminal?session_id=<id>` にアクセスする, Then: Terminal window を開き `{"status":"ok","session_id":"<id>"}` を返す  
10.3.4.1 Given: terminal window を開く, When: `GET /open-terminal`（`session_id` 未指定）にアクセスする, Then: `session_id` を自動採番し Terminal window を開き `{"status":"ok","session_id":"<generated>"}` を返す  
10.3.4.2 Given: `session_id` が既存と衝突する, When: `GET /open-terminal?session_id=<id>` にアクセスする, Then: 衝突を避けるため `session_id` を自動採番し直し、Terminal window を開き `{"status":"ok","session_id":"<generated>"}` を返す  
10.4 Given: Windows 環境で `worker_backend = wsl`, When: Worker を起動する, Then: Orchestrator は `wsl.exe` 経由で Linux Worker を起動する  
10.5 Given: Windows 環境で `worker_backend = windows` または未指定, When: Worker を起動する, Then: Orchestrator は Windows Worker を起動する  
10.6 Given: WSL で Worker を起動する, When: Linux 側コマンドを指定する, Then: `wsl.exe -d <distro> -- <command>` 形式で実行する  
10.7 Given: WSL ターミナルを対話的に扱う, When: 端末入力/制御を行う, Then: ConPTY を用いて `wsl.exe` を接続する  
10.8 Given: Worker の起動に失敗する, When: 再起動を試みる, Then: 再接続手段を提示しユーザーは再試行できる  

