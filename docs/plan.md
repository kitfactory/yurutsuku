# Plan (NOW)

入口は `docs/OVERVIEW.md`。このファイルは **NOW のみ**（完了/履歴は `docs/plan.archive.md`）。

---

## 運用ルール（必須）
- 各項目は **「実装 → すぐテスト（確認） → チェック更新」** の順で進める
- テスト（確認）の種類は最小でよい（P0）
  - docs 変更: 自己レビュー（矛盾/用語/リンク）
  - UI 変更: `cargo build -p nagomi-orchestrator` → `node apps/orchestrator/e2e/terminal.tint.e2e.js` などの E2E を優先
  - Rust 変更: `cargo test -p nagomi-orchestrator`（可能なら）

---

## 目的（P0 / Windows）
nagomi の中核である「複数ターミナル並列作業」を、観測ベースで **分かりやすく・壊れにくく**する。

- `nagomi.exe` を起動すると、**ターミナルアプリを開いたのと同じ感覚**で Terminal が 1 枚開く
- Watcher（右下キャラ＋tint）で、状態（Running/NeedInput/Success/Fail）が一目で分かる
- Overview（タイル一覧 / Run相当）は起動可能にするが、優先度は下げる

---

## NOW（P0）
対象: REQ-004/005/012 + `docs/spec.md` 3.x / 7.x / 11.x

### H. 外部ツールフック（最優先）
- [x] H-1 仕様（docs）: フックで「完了/入力待ち」を検知し、完了後に Judge で再判定する流れを `docs/spec.md` に追記する
- [x] H-1 テスト: `docs/spec.md` の記述が矛盾しない（自己レビュー）
- [x] H-2 仕様（docs）: フック設定の導線/最小手順（貼り付け用例）を Settings に追記する
- [x] H-2 テスト: `docs/spec.md` の記述が矛盾しない（自己レビュー）
- [x] H-3 仕様（docs）: ツール別の貼り付け用最小設定例（codex/claude/opencode）を `docs/spec.md` に追記する
- [x] H-3 テスト: `docs/spec.md` の記述が矛盾しない（自己レビュー）
- [x] H-4 仕様（docs）: CompletionHook 抽象とツール別実装（Codex/Claude/OpenCode）を `docs/spec.md` に追記する
- [x] H-4 テスト: `docs/spec.md` の記述が矛盾しない（自己レビュー）
- [x] H-5 仕様（docs）: ツール選択UIの説明文（完了検知/判定に使う）を `docs/spec.md` に追記する
- [x] H-5 テスト: `docs/spec.md` の記述が矛盾しない（自己レビュー）
- [x] H-6 仕様（docs）: CompletionHook I/F（start/stop/正規化）を `docs/spec.md` に追記する
- [x] H-6 テスト: `docs/spec.md` の記述が矛盾しない（自己レビュー）
- [x] H-7 仕様（docs）: CompletionHook の実装方針（Manager/切替/判定フロー）を `docs/spec.md` に追記する
- [x] H-7 テスト: `docs/spec.md` の記述が矛盾しない（自己レビュー）
- [x] H-8 実装: CompletionHook 抽象/Manager を実装し、選択ツールで start/stop 切替できるようにする
- [x] H-9 実装: Codex/ClaudeCode/OpenCode の CompletionHook を実装し、最小イベントを hook_event に正規化する
- [x] H-9 テスト: codex の代表イベント正規化が期待通り（簡易テスト）
- [x] H-10 実装: completed/error は Judge を起動し state を更新、need_input は判定しない

### J. 環境同期（Terminal）
- [x] J-1 仕様（docs）: Terminal の環境変数同期方針を `docs/spec.md` に追記する
- [x] J-1 テスト: `docs/spec.md` の記述が矛盾しない（自己レビュー）
- [x] J-2 実装: Windows で User/System 環境変数を統合し PATH を補完して PTY に渡す
- [x] J-2 テスト: nagomi Terminal でユーザー環境の CLI が解決できる（e2e: codex 起動/入力/フック検知）

### K. ストリーム+フック統合 / LLM Judge
- [x] K-1 仕様（docs）: 終了候補イベント/判定フロー/出力末尾 1500字+50行/need_input 統一を `docs/spec.md` に反映
- [x] K-2 仕様（docs）: `docs/OVERVIEW.md` のスコープ/非ゴールを更新
- [x] K-3 実装: `NAGOMI_SESSION_ID` を PTY へ付与し hook に `source_session_id` を伝播する
- [x] K-4 実装: `tool_judge`（codex JSON 出力 + fallback）を追加する
- [x] K-5 実装: Terminal 出力末尾の収集/30s idle 検知/Hook 判定/全体 tint を統合する
- [x] K-7 実装: 色変更を E2E で確認できるテスト（terminal.tint.e2e.js）を追加する
- [ ] K-7 テスト: `node apps/orchestrator/e2e/terminal.tint.e2e.js` が通る

### A. 観測（Watcher）: 仕様の確定
- [x] A-1 仕様（docs）: 観測状態モデルを `docs/spec.md` に整理する
- [x] A-1 テスト: `docs/spec.md` の記述が一意で矛盾しない（自己レビュー）

### B. 観測（Watcher）: 実装の安定化（P0）
- [x] B-1 実装: 無出力では状態を変えず `running` を維持し、末尾がプロンプト風のときのみ `need_input` に遷移する
- [x] B-2 実装: 観測ロジックをモジュール化してテスト可能にする
  - [x] `apps/orchestrator/src/terminal_observer.js` に純粋関数として集約する
  - [x] UI 側（`apps/orchestrator/src/index.html`）はモジュールを呼び出すだけにする
- [x] B-2 テスト: `npm test -w apps/orchestrator` で `terminal_observer` の unit test が通る
- [x] B-3 実装: Watcher アイコン表示を 96px にする

### I. 終了検知の部品化（部品→単体テスト→統合）
- [x] I-1 仕様（docs）: 「Terminal 状況検知」と「AIツールイベント監視」を機能ブロックとして `docs/concept.md` / `docs/spec.md` / `docs/architecture.md` に反映する
- [x] I-1 テスト: docs の記述が一意で矛盾しない（自己レビュー）
- [x] I-2 実装: Terminal 状況検知コンポーネント（TerminalStateDetector）を純粋関数として分離する
- [x] I-2 テスト: TerminalStateDetector の unit test が通る
- [x] I-3 実装: AIツールイベント監視コンポーネント（AgentEventObserver）を分離する
- [x] I-3 テスト: AgentEventObserver の unit test が通る
- [x] I-4 実装: 状態統合コンポーネント（StateIntegrator）を分離する
- [x] I-4 テスト: StateIntegrator の unit test が通る
- [x] I-5 実装: 既存フローに統合し UI に反映する
- [x] I-5 テスト: ターミナル/AIイベントの両経路で状態遷移が期待通り

### C. 起動導線（nagomi / tray）
- [x] C-1 仕様（docs）: 2回目以降の `nagomi` は **追加で新ターミナルを開く**を正とする（`docs/spec.md` 10.x）
- [x] C-1 テスト: `target/debug/nagomi.exe` を2回起動して Terminal が2枚増える

### D. Overview（タイル一覧 / Run相当） ※優先度低
- [ ] D-1 実装: Orchestrator から Overview を開ける（tray/メニュー/ショートカットのいずれか）
- [ ] D-1 テスト: Overview を開閉しても Terminal は壊れない（入力/表示が継続）
- [ ] D-2 実装: 起動時に Overview を表示する設定（ON/OFF、既定OFF）
- [ ] D-2 テスト: ON/OFF で起動時の挙動が変わる

### E. 設定（参照元の明確化）
- [x] E-1 実装: 既定値（terminal font/size/scrollback 等）の参照元を `docs/spec.md` から辿れるようにする（実装ファイルへリンク）
- [x] E-1 テスト: `docs/spec.md` のリンク/記述が最新実装と一致（自己レビュー）
- [x] E-2 実装: トレイから `Settings` を開いたときに `view=settings` が表示されるようにする
- [x] E-2 テスト: トレイの `Open Settings` から設定画面が表示される（目視確認）
- [x] E-3 仕様/設計: AI Coding Agent/AI判定の表記と動作ルール、設定画面のdark/lightテイスト方針を `docs/spec.md` に反映する
- [x] E-3 実装: 設定画面の文言とテーマ（dark/light）を反映する


### G. 体験（任意 / A寄り）: フォーカス切替アニメーション
- [x] G-1 実装: フォーカス移動（pickup/next/prev）時に「縮小→拡大」のウィンドウ移動・リサイズを段階的に行い、アニメっぽく見せる

### L. 状態UX（idle/success/need_input/failure）: 仕様・設計
- [x] L-1 仕様（docs）: 起動/コマンド/AIツール（codex）ごとの状態遷移と表示色（黒=idle/success、青=running、赤=need_input/failure）を `docs/spec.md` に明記する
- [x] L-1 テスト: `docs/spec.md` の記述が矛盾しない（自己レビュー）
- [x] L-2 設計（docs）: `idle` と `success` を同色で表示しつつ**処理ルートは分ける**（アイコン/通知/音など）方針を `docs/architecture.md` に反映する
- [x] L-2 テスト: `docs/architecture.md` の記述が矛盾しない（自己レビュー）

---

## FUTURE
- グループごとの整列（Workspace / Task Group 単位でタイル配置、グループ内は pane 順で並べる）
- macOS のショートカット作成（.command / Automator などの起動導線）
- ターミナル入力補助の拡充（履歴/補完/スニペット/貼り付け支援）
- ターミナル表示の拡充（検索/ハイライト/スクロール補助）
- CompletionHook の正規化テスト（claudecode / opencode）

---

## Legacy（root plan.md 移管 / 2026-01-30）
ルート `plan.md` の内容を漏れなく移管した。以後の正本は `docs/plan.md` とする。

### 0. 事前準備
- [ ] 仕様の前提 (Windows-only / NDJSON / ConPTY / Tauri v2) を再確認する  
      完了条件: 重要前提を1ページに要約し、抜けがないことを確認する
- [ ] レイヤー構造 (UI / Orchestrator / Worker / Protocol / CLI) の責務を明文化する  
      完了条件: 各レイヤーの入出力/責務/禁止事項が明文化されている

### 1. リポジトリ骨格
- [ ] Rust workspace / pnpm workspace を整備する  
      完了条件: `pnpm -v` / `cargo -V` が通り、workspace 設定が読み込める
- [ ] `crates/worker` / `crates/protocol` / `apps/orchestrator` / `packages/*` の構成を確認する  
      完了条件: 既定ディレクトリが揃っていることを確認できる

### 2. Protocol (NDJSON)
- [ ] Rust 側の protocol 型 (serde) を定義する  
      完了条件: `cargo test -p yurutsuku-protocol` が通る
- [ ] TS 側の protocol 型 (zod 等) を定義する  
      完了条件: `pnpm -C packages/protocol test` が通る
- [ ] NDJSON の入出力仕様 (type/1行JSON) を満たすことを確認する  
      完了条件: 仕様例を最小ケースで通すテストが追加される

### 3. Worker (Rust)
- [ ] ConPTY/PTY でプロセス起動・stdin/out/err を扱う  
      完了条件: `cargo test -p yurutsuku-worker` が通る
- [ ] chunk (max 4096 bytes) で output を送信する  
      完了条件: chunk サイズを検証するテストが通る
- [ ] resize / stop / exit / error を実装する  
      完了条件: 各コマンドのテストケースが通る
- [ ] 単体で動作テストする  
      完了条件: `cargo run -p yurutsuku-worker -- --stdio` の疎通が確認できる

### 4. Orchestrator (Tauri v2)
- [ ] Worker を stdio で spawn する  
      完了条件: `pnpm -C apps/orchestrator test` が通る
- [ ] NDJSON の send/receive を実装する  
      完了条件: 最小 send/receive のユニットテストが通る
- [ ] Session 管理 (start/stop/phase/exit) を実装する  
      完了条件: セッション遷移テストが通る
- [ ] UI (Chat / Run / Settings / キャラ表示) を実装する  
      完了条件: 画面操作のスモーク確認ができる
- [ ] 画面内の段階的テストを行う  
      完了条件: Chat/Run/Settings の主要導線が動作する

### 5. Judge / Notification / Settings
- [ ] Heuristic Judge の実装と summary 生成を確認する  
      完了条件: `pnpm test` で該当テストが通る
- [ ] LLM Judge ON/OFF の設定を追加する  
      完了条件: 設定切替のユニットテストが通る
- [ ] OS 通知 / 音声通知 の挙動を確認する  
      完了条件: 成功/失敗/attention で通知が出る
- [ ] phase 表示 (thinking/running/success/error/attention) を確認する  
      完了条件: 各 phase の表示が UI で確認できる

### 6. CLI / 配布
- [ ] `packages/cli` の `yurutsuku` コマンドを整備する  
      完了条件: `pnpm -C packages/cli test` が通る
- [ ] Windows 向け配布パッケージ構成を確認する  
      完了条件: `pnpm build` が通る
- [ ] `yurutsuku setup --wsl` の導線を整備する  
      完了条件: `yurutsuku setup --wsl` の動線が確認できる

### 7. 結合テスト
- [ ] 代表的なユースケースで end-to-end を確認する  
      完了条件: `pnpm test` + シナリオが完了する
- [ ] 仕様との差分がないかチェックする  
      完了条件: 仕様項目の差分が 0 か、差分理由が明文化されている

---

## 参照
- `docs/concept.md`
- `docs/spec.md`
- `docs/architecture.md`






