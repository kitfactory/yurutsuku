# tauri-driver E2E 実行手順

このドキュメントは、nagomi の **tauri-driver を使った E2E テスト**の手順と注意点をまとめる。

---

## 目的
- Tauri UI を WebDriver で操作し、Terminal/Hook/IPC の統合動作を確認する
- Windows 環境での PATH/CLI/Hook の問題を早期に検知する

---

## 前提
- Windows 10/11
- `tauri-driver` / `msedgedriver` が利用可能
- `target/debug/nagomi-orchestrator.exe` をビルド済み

---

## 環境変数
- `NAGOMI_TAURI_DRIVER`: tauri-driver のパス（未指定なら PATH 解決）
- `NAGOMI_EDGE_DRIVER`: msedgedriver のパス（未指定なら PATH 解決）
- `NAGOMI_ENABLE_TEST_ENDPOINTS`: `1` のとき `/terminal-send` が有効
- `NAGOMI_ORCH_HEALTH_PORT`: Orchestrator のヘルスチェックポート（既定 17707）
- `NAGOMI_E2E_STRICT`: `1` のとき前提不足でも fail する（未指定時は一部を skip 扱い）

---

## 実行手順
1) Orchestrator をビルド
```powershell
cargo build -p nagomi-orchestrator
```

2) E2E を実行
```powershell
node apps/orchestrator/e2e/terminal.e2e.js
node apps/orchestrator/e2e/ipc.session.e2e.js
node apps/orchestrator/e2e/terminal.smoke.e2e.js
node apps/orchestrator/e2e/terminal.screenshot.e2e.js
node apps/orchestrator/e2e/terminal.stress.e2e.js
node apps/orchestrator/e2e/codex.hook.e2e.js
node apps/orchestrator/e2e/terminal.tint.e2e.js
node apps/orchestrator/e2e/subworker.matrix.e2e.js
node apps/orchestrator/e2e/subworker.advice.format.e2e.js
node apps/orchestrator/e2e/subworker.judge.dedup.e2e.js
node apps/orchestrator/e2e/codex.prime-minister.e2e.js
node apps/orchestrator/e2e/settings.open-from-terminal.e2e.js
node apps/orchestrator/e2e/settings.character.toggle.stability.e2e.js
node apps/orchestrator/e2e/watcher.frame.e2e.js
node apps/orchestrator/e2e/watcher.debug3d.e2e.js
```

`terminal.tint.e2e.js` は前提不足（例: `msedge` 不在、driver/browser の major 不一致、既存プロセス残存）時に skip を返す。  
CI などで必ず失敗扱いにしたい場合は `NAGOMI_E2E_STRICT=1` を指定する。

```powershell
$env:NAGOMI_E2E_STRICT = "1"
npm run e2e:tint -w apps/orchestrator
```

---

## AI状態判定（色付け）確認
目的は「hook 完了だけで状態が変わること」と「色」が一致していることを確認すること。

- 色マップ（固定）:
  - `idle/success` = 黒
  - `need_input` = オレンジ
  - `failure` = 赤
  - `subworker-running` = 緑オーバーレイ
- 遷移ガード:
  - 入力確定 / tool start / terminal exit では状態を変えない
  - `need_input` / `success` / `failure` は hook 完了時だけ変化する

### 確認観点（P0最小）
1. 入力送信直後は状態が変わらず、hook 完了まで直前状態を維持する
2. `hook-complete(success)` で黒になる
3. `hook-complete(failure)` で赤になる
4. `hook-complete(need_input)` でオレンジになる

### 実施方法
1) `node apps/orchestrator/e2e/terminal.tint.e2e.js` を実行して tint の基本回帰を確認する  
2) nagomi Terminal で手動確認する（AI への入力送信 / hook `success` / hook `need_input` / hook `failure`）  
3) `nagomi debug-tail status --n 80` で遷移イベントを確認し、入力送信や exit では state が変わっていないことを確認する  

---

## サブワーカー機能確認（先行実装）
目的は「稼働可視化（緑）」「表示専用アドバイス」「モード別挙動」が要件どおりであることを確認すること。

### 確認観点（P0最小）
1. サブワーカー稼働中は対象ターミナルに `サブワーカーで処理中` が緑表示される
2. サブワーカー終了時に緑表示が消え、元の状態色（黒/オレンジ/赤）へ戻る
3. アドバイス表示は Terminal 本文に「次に何を入力するか」を1行で追記し、実コマンド入力/PTY 入出力として扱われない
4. `ガンガン`: `success` または `need_input` で入力代行またはアドバイスが実行される
5. `慎重に`: `need_input` のときだけ稼働し、入力代行後の状態は終了判定に追従する
6. `アドバイス`: 任意状態で稼働するが入力代行せず、アドバイス表示時は `need_input` として扱う
7. サブワーカー進行中は緑表示のみで可視化され、完了時は Terminal 本文に 1 行だけ追記される（代行時=入力内容、アドバイス時=次入力）
8. サブワーカー本文出力は `[nagomi-subworker(自信度：xxx　アドバイス/代理入力)] (メッセージ)` 形式で統一される
9. Settings > AI Coding Agent の `サブワーカーON/OFF` / `サブワーカーデバッグON/OFF` / `一時停止` / `今回だけスキップ` が動作する
10. 判断ログ（`mode/confidence/action/result/reason`）が追跡できる
11. 同一 state のまま出力だけ更新されてもサブワーカーが再判定を連打しない
12. アドバイス生成時に `ユーザー最終入力` と `最後の出力` の文脈を使っていることを確認できる

### 実施方法
1) 設定画面で `サブワーカーON/OFF` / `サブワーカーデバッグON/OFF` / サブワーカーモード（`ガンガン` / `慎重に` / `アドバイス`）を切り替える  
2) `自信度閾値` を変更し、入力代行/アドバイス分岐が変わることを確認する  
3) ターミナルで `success` / `need_input` / `failure` を作って、モードごとの稼働条件を確認する  
4) 稼働中の緑表示と、終了後の状態復帰を目視確認する  
5) Settings > AI Coding Agent で `一時停止` / `今回だけスキップ` の挙動を確認する  
6) 端末幅を狭くしてもサブワーカー結果の 1 行表示が読み取れることを確認する  
7) `nagomi debug-tail subworker --n 80` と `nagomi debug-tail status --n 80` で `subworker_status` / `subworker_advice` / `subworker_decision` / state の相関を確認する  

---

## Rust 通知テスト（分離実行）
`notify_flow` は Rust 側単体テストとして分離し、Node 統合テストとは別で実行する。

```powershell
npm run test:rust:notify -w apps/orchestrator
```

---

## Codex フック E2E の注意点
- `apps/orchestrator/e2e/codex.hook.e2e.js` は **nagomi Terminal 上で codex を起動**し、フック検知を確認する
- Windows では npm の shim が PATH にないと `codex` が解決できない
- Terminal セッションは **通常の cmd/PowerShell と同等の環境変数**を目指している
  - `where codex` が通るかを確認する

### 追加シナリオ（現行）
- `apps/orchestrator/e2e/codex.prime-minister.e2e.js`: 実問合せで「入力送信では状態不変、hook で `success`」を確認する
- `apps/orchestrator/e2e/subworker.matrix.e2e.js`: モード別（慎重/ガンガン/アドバイス）の行列ケースを確認する
- `apps/orchestrator/e2e/subworker.advice.format.e2e.js`: アドバイス表示形式と Tab 適用を確認する
- `apps/orchestrator/e2e/subworker.judge.dedup.e2e.js`: `hook-judge`/`judge-result` 連続時の dedup（`llm-start` 重複なし）と非Tabでの ghost 解除を確認する
- `apps/orchestrator/e2e/watcher.frame.e2e.js`: 通常 watcher でキャラクター領域クリック時に frame 選択状態が有効化されることを確認する
- `apps/orchestrator/e2e/watcher.debug3d.e2e.js`: `watcher-debug` で 3Dモデル表示（`is-3d + canvas`）とクリック選択時の frame 有効化を確認する

---

## よくあるトラブルと対策
### 1) codex が cmd で解決できない
- 原因: PATH に `C:\nvm4w\nodejs` など npm の bin が入っていない
- 対策: Terminal 起動時に User/System の環境変数を統合し、PATH を不足分だけ後ろに追加する

### 2) Codex の notify が動かない
- 原因: `config.toml` の notify 設定が不正、またはトップレベルではなくテーブル内に書かれている
- 対策: トップレベルに `notify = ["node", "<script>"]` を置く（Windows の `.cmd` 名解決に依存しない）

### 3) tauri-driver / msedgedriver が見つからない
- `NAGOMI_TAURI_DRIVER` / `NAGOMI_EDGE_DRIVER` を指定する
- `ensureDriversOnPath` が PATH を補完する（`apps/orchestrator/e2e/driver_paths.js`）

---

## ノウハウ: ターミナル入力イベントのデバッグ
### 目的
- codex の開始/終了（`codex` / `/quit`）入力が検知できないときの切り分け
- 全自動 E2E が通らない場合でも、手動＋JSONLログで検証を継続できる

### 手順（開発中のデバッグ手段）
1) Settings > AI Coding Agent で `状態デバッグログ` を ON にする  
2) `nagomi debug-tail status --n 120` で直近イベントを確認する  
3) 必要に応じて `nagomi debug-tail watcher --n 120` / `nagomi debug-tail subworker --n 120` を併用する  
4) 保存先（例）: `C:\\Users\\<user>\\AppData\\Roaming\\com.kitfactory.nagomi\\status_debug_events.jsonl`

### 見るべきポイント
- `event=terminal-line` / `state ... -> ...` が期待順で出ているか
- `judge-start` / `judge-complete` が欠落していないか
- `unified=.../.../...` が実際の表示ステータスと一致しているか

### 典型的な原因と対策
- **line が崩れる / 先頭が二重になる**  
  - key/global/textarea 側の行判定が混ざっている可能性  
  - 対策: 送信キュー由来の行判定に統一する
- **line が空になる**  
  - 入力ストリームの改行判定が取れていない  
  - 対策: `\r` を境に `inputLineBuffer` を確定する
- **修正中のバックスペースが効かない**  
  - `\x7f`/`\b` を無視している  
  - 対策: 行バッファから 1 文字削除する

---

## ノウハウ: AI エージェントの E2E を安定させる
### 基本方針
- **E2E は最小化し、観測性と中間テストを厚くする**
  - E2E は「連結の確認」用途に絞る
  - 入力/出力/判定を unit/integration で担保する

### 実践ポイント
- **観測性のレイヤ分離**: 入力/出力/判定を別レイヤで検証できるようにする
- **半自動ルートの用意**: 失敗時にすぐ情報採取できる導線（`debug-tail` / JSONL 直読）
- **入力系の単一路線化**: onData/送信キューのみに統一し、key/global/textarea の混在を避ける
- **フレーク対策**: 描画/タイミング揺れを減らす（固定フォント/サイズ、アニメ抑制）
- **イベント相関ID**: session_id や tool 名を全イベントに付与して追跡する
- **LLM 依存の切り離し**: 本番相当の E2E と stub/fixture の E2E を分ける
- **判定オラクルの構造化**: JSON/state を基準に判定し、自然言語判定を避ける

### 補助データの活用
- 全自動で通らない場合でも、**手動 + JSONLログ**で前進する
- E2E の「失敗時の情報量」を増やし、再現性を高める

### 実際の運用で効いたこと（実感ベース）
- **観測が先、制御は後**: まず見える化してから制御を入れると試行が速くなる
- **観察コストを下げる仕掛けが効く**: `debug-tail` と JSONL 直読で状況固定が速い
- **入力検知は一本道が正義**: onData/送信キューに一本化すると誤判定が減る
- **E2Eが詰まっても前に進める**: 半自動ルートを用意すると実装もテストも止まらない
- **確実に拾えるイベントを軸にする**: `codex`/`/quit` のようなハードイベントを基準に設計する

---

## 参照
- `apps/orchestrator/e2e/`
- `apps/orchestrator/e2e/driver_paths.js`
- `apps/orchestrator/src-tauri/src/main.rs`（Terminal 起動時の env 統合）
