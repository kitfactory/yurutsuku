# ゆるつく（yurutsuku） “AIエディタに追加説明不要” 完全仕様 v1.3

> 目的：この1ファイルだけで **実装に必要な前提・判断・細部・既定値・タスク**が揃い、追加の口頭説明を最小化する。  
> 対象：P0=Windows-only（Orchestrator+Worker）、P1=WSL Worker、P2=Linux/macOS。

---

## 0. プロダクトの一文定義（コピペ用）
**ゆるつく**は、こたつ/囲炉裏みたいな“ゆるい作業場”で、複数の対話セッションやタスクを並べて進め、完了/注意をキャラクターの表情と音で伝え、次の一手まで繋げる常駐型オーケストレーションUI。

---

## 1. スコープと優先順位

### 1.1 P0（必須：Windows-onlyで完成させる）
- Windows Orchestrator（タスクトレイ常駐、UI、通知、音声、設定、判定、後続処理提案）
- Windows Worker（ConPTYでセッション維持、stdio NDJSONでOrchestratorへストリーミング）
- UI：Chatモード（1セッション集中）＋ Runモード（タイル整列）
- Judge：Heuristic（必須）＋ LLM Judge（オプション）
- npm配布（Windows向け）：`npm i -g @kitfactory/yurutsuku` で導入、`yurutsuku`で起動

### 1.2 P1（追加：WSL Worker）
- Orchestratorから `wsl.exe` 経由で Linux Worker を spawn
- 同じNDJSONプロトコルで動作（ネットワークなし）
- `yurutsuku setup --wsl` で導入補助

### 1.3 P2（将来：Linux/macOS単体）
- Orchestrator/Worker同一OS上で動作（トレイはOS差異許容）

---

## 2. アーキテクチャ（Orchestrator / Worker）

### 2.1 Orchestrator（場）責務
- 常駐（トレイ）・ウィンドウ生成（Chat/Run/Settings）
- セッション管理（作成/停止/フォーカス/並び替え）
- Worker管理（P0はローカルのみ、P1でWSL追加）
- UI状態（キャラ、レーン、タイル、バッジ）
- Judge実行（標準：Orchestrator側）
- 通知（OSトースト）＋ 音声（ファイル/TTS）
- 後続処理（提案の表示、実行ボタン、P1で自動実行）
- 設定永続化（JSON）

### 2.2 Worker（手）責務
- PTY/ConPTYでプロセスを起動し入出力を維持
- 出力をchunk化してOrchestratorへ送信
- resize対応
- stop/cleanup（子プロセスを確実に終了）
- **判定は原則しない**（ただしphase推定は送ってよい）

### 2.3 通信方針（P0/P1）
- OrchestratorがWorkerをspawnし、**stdin/stdoutでNDJSON**（1行1JSON）を送受信
- 理由：Windows/WSLで確実、Firewall/port問題回避、実装簡素

---

## 3. ADR（設計判断ログ：AIが迷わないための理由）

### ADR-001：Tauri採用（Electron不採用）
- **採用**：Tauri（UIはTS、ネイティブはRust）
- 理由：起動が速くメモリが小さい／トレイ常駐が現実的／配布バイナリ化しやすい
- 代替：Electron（却下：常駐時のメモリ増と配布サイズが大きい）

### ADR-002：WorkerをRustにする
- **採用**：WorkerはRust（PTY/ConPTY/プロセス管理）
- 理由：WindowsのPTYは落とし穴が多い。長時間常駐で堅牢性を優先
- 代替：node-pty（却下：運用でハマりやすい領域が増える）

### ADR-003：NDJSON over stdio
- **採用**：NDJSON（stdio）
- 理由：単純でデバッグ容易、WSLも同形、疎通が安定
- 代替：WebSocket/HTTP（却下：初期にport/権限/Firewallを踏みやすい）

### ADR-004：判定（Judge）はOrchestrator側を標準
- **採用**：JudgeはOrchestrator
- 理由：UI演出と一体化、Worker差し替えに強い、LLM利用ポリシーも集中管理
- 代替：Worker側判定（却下：分散して仕様が割れる）

---

## 4. UI/UX 仕様（数値既定値つき）

### 4.1 共通：用語（UI表示名）
- セッション：**つくり**
- Runモード：**みんなの様子**
- Chatモード：**おはなし**
- Worker：**手**
- Orchestrator：**場**（実装名はOrchestrator）

### 4.2 Chatモード（おはなし）
- 左：対話レーン（コンソール風）
- 右下：キャラクター（表情＋吹き出し任意）
- 入力欄：下部固定、Enter送信、Shift+Enter改行（既定）
- スクロール：
  - 末尾追従ONが既定
  - ユーザーが上へスクロールしたら追従OFF
  - 「末尾へ」ボタンで追従ONに戻す
- 表示保持：レーンは **最大 20,000 行**（超過は先頭から破棄）
- 文字処理：ANSI/VT100エスケープをレンダリング（xterm.js等）

### 4.3 Runモード（みんなの様子）
- タイル整列：既定 2列（ウィンドウ幅により自動で2〜4列）
- クリック：フォーカス拡大（倍率 1.8x）
- ダブルクリック：再整列（フォーカス解除）
- タイルヘッダ：
  - つくり名（セッション名）
  - 状態バッジ
  - 経過時間（mm:ss）
- 右上に「新しいつくり」＋「設定」

### 4.4 キャラクター演出（優先順位と保持時間）
- 状態（phase）優先順位：
  1. attention（呼びかけ）
  2. error（失敗/異常）
  3. success（完了）
  4. running（作業中）
  5. thinking（考え中）
  6. listening（入力中）
  7. idle（待機）
- success/error/attention の表情保持：既定 4秒（その後 idle/thinking に戻す）
- 音声再生中は speaking フラグを立てて口パク（P0は任意、P1以降でも可）

---

## 5. 通知仕様（OS通知＋音声）

### 5.1 OS通知（トースト）
- トリガ：turn_completed（success/failure/attention）
- 既定：failure/attentionのみ通知ON、successはOFF（うるささ回避）
- 通知本文：
  - タイトル：`ゆるつく：{つくり名}`
  - 本文：Judge summary（最大 120文字、超過は省略）

### 5.2 音声通知（必須）
- トリガ：turn_completed（success/failure/attention）
- 既定：failure/attentionのみON、successはOFF
- 種別：sound_file / tts
- クールダウン：既定 1500ms（同種イベント連打防止）
- 音量：0.0〜1.0（既定 0.8）
- テスト再生ボタン：Settingsに必須

---

## 6. セッション仕様（継続前提）

### 6.1 つくり（Session）データモデル
- session_id（UUID v4）
- name（UI表示名、既定：`つくり-{短ID}`）
- worker_id（P0は `local`）
- cmd（起動コマンド）
- cwd（任意）
- env（任意）
- character_id（キャラ割当）
- judge_profile（判定プロファイル名）
- created_at / started_at / last_output_at
- stats：
  - exit_status（最後のturn_completedのstatus）
  - duration_ms
  - last_summary

### 6.2 ターン（turn）概念
- “ターン”＝ユーザーが送信した入力に対する一連の反応のまとまり
- P0では厳密な境界は不要。以下で判定：
  - 入力送信 → thinking へ
  - 出力が一定時間止まる（沈黙）→ turn_completed候補
  - exitコードが確定 → turn_completed確定
- 沈黙タイムアウト：既定 3.5秒（ユーザーが調整可能）

---

## 7. Judge仕様（実装の決め打ち）

### 7.1 Heuristic Judge（P0必須）
入力：
- exit_code（もし分かれば）
- stderr有無
- 末尾ログ（tail_lines：既定 80行）
- 正規表現ヒット（下記）
- 沈黙時間

判定ルール（既定）：
- exit_code == 0 → success
- exit_code != 0 → failure
- exit_code未知で以下に該当 → attention
  - `(?i)error|failed|exception|panic|traceback|permission denied|cannot|timeout|timed out|segmentation fault`
- それ以外で沈黙タイムアウト到達 → unknown（ただしUI上はthinking→idleに戻す）

summary生成（既定）：
- failure/attention の場合：末尾ログから “最もそれっぽい1〜2行” を抽出（正規表現ヒット行を優先）
- success の場合：`完了しました`（または短い固定文）

### 7.2 LLM Judge（P0オプション、P1以降強化）
- 目的：Heuristicで不十分なときの要約、次アクション提案
- 呼び出し条件（既定）：
  - failure/attention のときのみ
  - unknownでユーザーが明示的に「判定して」したとき
- 入力に含めるのは **マスク済み** の末尾ログ（既定 120行）＋環境情報（cmd/cwd/OS）
- 出力は 7.3 の共通フォーマットに適合させる（JSONで）
- 失敗時はHeuristic結果にフォールバック

### 7.3 Judge 共通出力（固定）
```json
{
  "state": "success | failure | attention | running | thinking | unknown",
  "confidence": 0.0,
  "summary": "短い要約（最大120文字推奨）",
  "evidence": ["根拠ログ（最大3行）"],
  "next_actions": [
    { "title": "次の手", "command": "…", "risk": "low|mid|high" }
  ]
}
```

---

## 8. セキュリティ（ログマスク規則：AIに追加説明不要）

### 8.1 マスク対象（既定：送信/保存の両方に適用）
- `-----BEGIN (RSA |EC |OPENSSH )?PRIVATE KEY-----` 以降のブロック
- JWTっぽい：`[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+`
- OpenAI/各種APIキーっぽい：`(?i)(api[_-]?key|token|secret)\s*[:=]\s*\S+`
- `Authorization: Bearer ...`
- 16文字以上のランダム英数列（誤検知を避けるため周辺語がある場合のみ）

### 8.2 マスク方法
- 検出した値は `***REDACTED***` に置換
- 置換後も行構造は維持（デバッグのため）

### 8.3 外部送信ポリシー
- LLM Judgeを使う場合のみ外部送信（P0ではOFFが既定）
- Settingsで明示ON（同意）しない限り送らない

---

## 9. Orchestrator ⇄ Worker NDJSON プロトコル（厳密仕様）

### 9.1 形式
- UTF-8
- 1行1JSON（末尾 `\n`）
- `type` は必須
- 未知の `type` は無視（将来拡張）

### 9.2 Orchestrator → Worker
#### start_session
```json
{
  "type": "start_session",
  "session_id": "uuid",
  "cmd": "string",
  "cwd": "string|null",
  "env": {"KEY":"VALUE"},
  "cols": 120,
  "rows": 30
}
```
#### send_input
```json
{"type":"send_input","session_id":"uuid","text":"string"}
```
#### resize
```json
{"type":"resize","session_id":"uuid","cols":120,"rows":40}
```
#### stop_session
```json
{"type":"stop_session","session_id":"uuid"}
```
#### ping
```json
{"type":"ping"}
```

### 9.3 Worker → Orchestrator
#### output
- chunkは **最大 4096 bytes** 目安で分割
```json
{"type":"output","session_id":"uuid","stream":"stdout","chunk":"...raw..."} 
```
#### phase
```json
{"type":"phase","session_id":"uuid","phase":"thinking","detail":"optional"}
```
#### exit（プロセス終了）
```json
{"type":"exit","session_id":"uuid","exit_code":0}
```
#### error
```json
{"type":"error","session_id":"uuid","message":"...","recoverable":true}
```

---

## 10. モノレポ構成（決め打ち）

### 10.1 ディレクトリ
```
repo/
  package.json
  pnpm-workspace.yaml            # 推奨（npm workspacesでも可）
  Cargo.toml                     # Rust workspace
  apps/
    orchestrator/                # Tauri v2 app
      src/                       # TS UI
      src-tauri/                 # Rust（薄い：トレイ/ウィンドウ/設定）
  crates/
    worker/                      # Rust worker (pty/process, ndjson)
    protocol/                    # Rust protocol types (serde)
  packages/
    cli/                         # yurutsuku CLI (node)
    protocol/                    # TS protocol types (zod等は任意)
    assets/                      # Character packs
  tooling/
    scripts/                     # release helpers
```

### 10.2 主要コマンド（AIがそのまま実装する前提のI/F）
- `pnpm dev`：Orchestrator dev起動（Tauri）
- `pnpm build`：Windows release build
- `pnpm lint`：TS lint
- `pnpm test`：最小のプロトコルテスト
- `cargo build -p yurutsuku-worker`：worker build

---

## 11. 初期ファイル（テンプレ：AIがそのまま生成する）

> 注：ここでは「生成物の形」を明示する。実ファイル内容はAIエディタがこの仕様に従って作成する。

### 11.1 ルート package.json（例：pnpm）
- workspace利用
- `dev/build/lint/test` スクリプト
- `yurutsuku` CLIパッケージへの参照

### 11.2 Cargo workspace
- members: `crates/worker`, `crates/protocol`, `apps/orchestrator/src-tauri`（必要なら）

### 11.3 CLI（packages/cli）仕様
- `yurutsuku` コマンドを提供
- `yurutsuku`：Orchestratorを起動（既存起動なら前面化）
- `yurutsuku setup --wsl`：P1でWSL worker導入
- `yurutsuku doctor`：依存確認（WebView2/権限/WSL存在）

---

## 12. 配布（npm）仕様（P0：Windowsのみ）

### 12.1 方針
- npmに **事前ビルド済みバイナリ** を同梱/選択して提供する
- CLIは環境に応じて Orchestrator/Worker バイナリを解決して起動

### 12.2 パッケージ（案）
- `@kitfactory/yurutsuku`（CLI）
- `@kitfactory/yurutsuku-orchestrator-win32-x64-msvc`
- `@kitfactory/yurutsuku-worker-win32-x64-msvc`
- （P1）`@kitfactory/yurutsuku-worker-linux-x64-gnu`

---

## 13. 実装タスク（REQ-ID：AIが迷わない粒度）

### REQ-001 モノレポ初期化
- workspace + cargo workspace作成
- 最小ビルドが通る

### REQ-002 Protocol定義（TS/Rust同型）
- `type` union/enum
- JSONシリアライズ/パース
- 互換テスト（golden）

### REQ-003 Worker（Rust）
- ConPTYでプロセス起動
- stdinへの入力送信
- stdout/stderr読み取り
- chunk化してNDJSON output送信
- resize対応
- stopでクリーン終了
- exitイベント送信

### REQ-004 Orchestrator（Tauri）骨格
- トレイ常駐
- Run/Chat/Settingsウィンドウ生成
- 設定保存（JSON）

### REQ-005 Orchestrator ⇄ Worker 接続
- spawn worker（stdio）
- NDJSON send/receive
- セッションstart/stop

### REQ-006 ChatモードUI
- レーン表示（xterm.js等）
- 入力欄（Enter送信/Shift+Enter）
- 自動スクロールと解除
- レーン最大行数の制限

### REQ-007 キャラクターUI
- 右下表示（画像）
- phase→表情マッピング（優先順位、保持時間）
- セッションごとのキャラ割当

### REQ-008 RunモードUI
- タイル整列（2〜4列）
- クリックでフォーカス拡大（1.8x）
- ダブルクリックで再整列
- バッジ/経過時間

### REQ-009 Heuristic Judge（必須）
- regex/exit_code/沈黙でturn_completed生成
- summary生成

### REQ-010 通知（OS＋音声）
- トースト（既定はfailure/attentionのみ）
- 音声（ファイル、クールダウン、テスト再生）

### REQ-011 後続処理（提案）
- next_actionsをUI表示
- 実行ボタン（P0は手動）

### REQ-012 Settings
- 通知ON/OFF
- 音量、音源、テスト
- 沈黙タイムアウト
- LLM Judge ON/OFF（P0既定OFF）
- キャラ割当
- ログ保持行数

### REQ-013 P1: WSL Worker
- `wsl.exe -d <distro> -- yurutsuku-worker --stdio`
- setupコマンド
- Orchestratorでworker選択

---

## 14. 受け入れ基準（P0：Windows-only）
1. OrchestratorがWindowsトレイ常駐できる  
2. Chatモードで「左：レーン」「右下：キャラ」が表示される  
3. 継続セッションで入力→出力が流れる  
4. phase（thinking/running/success/error/attention）がUIに反映される  
5. failure/attentionでOS通知＋音声通知が鳴る（テスト再生あり）  
6. Runモード整列＋クリック拡大＋ダブルクリック再整列が動く  
7. Heuristic Judgeでturn_completedが発火し、summaryが表示される  
8. next_actions（提案）が表示され、手動実行できる  

---

## 15. 受け入れ基準（P1：WSL Worker）
- OrchestratorからWSL Workerを選択し、同じUI/通知/表情で動く  
- stdio NDJSONプロトコルが同形で通る  

---

## 16. “ゆるつく”らしさチェック（プロダクト判断軸）
- 成功通知は静かで良い（デフォルトOFFでもOK）
- 失敗/注意は「責めずに呼ぶ」
- UIは監視ではなく“場の空気”を作る（赤だらけにしない）
- 迷ったら「止まらない」「邪魔しない」「あとで取り返せる」

---
