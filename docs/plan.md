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
対象: future の 6-9（選択切替 / アニメ高速化 / タイトル表示改善 / `:ng` 内蔵コマンド）

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
- [ ] N-8.1 文書: タイトル表示ルール（通常は末尾フォルダ名、`src` / `docs` / `tests` 等は2階層表示）を `docs/spec.md` / `docs/architecture.md` に反映する
- [ ] N-8.1 テスト: docs の記述が一意で矛盾しない（自己レビュー）
- [ ] N-8.2 実装: ターミナルウィンドウタイトルを CWD ベースで更新し、汎用名ディレクトリは `project/src` 形式で表示する
- [ ] N-8.2 テスト: CWD 変化に追従してタイトルが更新され、汎用名ルールが適用される（`cargo test -p nagomi-orchestrator` / `npm test -w apps/orchestrator -- --test-reporter=spec`）

### N-9 内蔵特殊コマンド（`:ng`）
- [x] N-9.1 文書: `:ng` を **UI 内蔵コマンド層**で扱う I/F（文法、PTY非送信、ローカル表示、エラー応答、権限境界）とロールバックポイントを `docs/spec.md` / `docs/architecture.md` / `docs/OVERVIEW.md` に反映する
- [x] N-9.1 テスト: docs の記述が一意で矛盾しない（自己レビュー）
- [x] N-9.2 実装: `apps/orchestrator/src/index.html` に `:ng` の Frontend Internal Command Layer を実装する（入力中表示/Enter実行/`ping` 応答）
- [x] N-9.2 テスト: `:ng` を打ち始めた時点で文字が見え、` :ng ping ` が即時 `pong` を返すことを確認する（PTY漏れなし）
- [x] N-9.3 実装: ロールバックポイント RP-1/RP-2 を実装する（内蔵層の無効化で全面パススルーへ戻せる）
- [x] N-9.3 テスト: ロールバック有効時に `:ng` が通常シェル入力として動作し、入力不能/重複入力が再発しないことを確認する
- [x] N-9.4 実装: Rust 側の `:ng` 専用インターセプトを撤去し、`terminal_send_input` を通常パススルー中心へ整理する
- [x] N-9.4 テスト: `cargo test -p nagomi-orchestrator` / `npm test -w apps/orchestrator -- --test-reporter=spec` と目視確認で回帰がないことを確認する

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
