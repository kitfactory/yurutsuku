# Plan (NOW)

入口は `docs/OVERVIEW.md`。このファイルは **NOW のみ**（完了/履歴は `docs/plan.archive.md`）。

---

## 運用ルール（必須）
- 各項目は **「実装 → すぐテスト（確認） → チェック更新」** の順で進める
- テスト（確認）の種類は最小でよい（P0）
  - docs 変更: 自己レビュー（矛盾/用語/リンク）
  - UI 変更: `cargo build -p yurutsuku-orchestrator` → `target/debug/yuru.exe` で目視確認
  - Rust 変更: `cargo test -p yurutsuku-orchestrator`（可能なら）→ 目視確認

---

## 目的（P0 / Windows）
nagomi（名称検討中）の中核である「複数ターミナル並列作業」を、観測ベースで **分かりやすく・壊れにくく**する。

- `yuru.exe` を起動すると、**ターミナルアプリを開いたのと同じ感覚**で Terminal が 1 枚開く
- Watcher（右下キャラ＋tint）で、状態（Running/NeedInput/Stalled/Success/Fail）が一目で分かる
- Overview（タイル一覧 / Run相当）は起動可能にするが、優先度は下げる

---

## NOW（P0）
対象: REQ-004/005/012 + `docs/spec.md` 2.x / 10.x

### A. 観測（Watcher）: 仕様の確定（最優先）
- [ ] A-1 仕様（docs）: 観測状態モデルを `docs/spec.md` に整理する
- [ ] A-1 テスト: `docs/spec.md` の記述が一意で矛盾しない（自己レビュー）

### B. 観測（Watcher）: 実装の安定化（P0）
- [ ] B-1 実装: `need_input=15s（末尾がプロンプト風のときのみ）` / `stalled=60s` を既定として運用する
- [ ] B-1 テスト: 目視で遷移（Running→Stalled、プロンプト風ならNeedInput、exitでSuccess/Fail）
- [ ] B-2 実装: 観測ロジックをモジュール化してテスト可能にする
  - [ ] `apps/orchestrator/src/terminal_observer.js` に純粋関数として集約する
  - [ ] UI 側（`apps/orchestrator/src/index.html`）はモジュールを呼び出すだけにする
- [ ] B-2 テスト: `npm test -w apps/orchestrator` で `terminal_observer` の unit test が通る

### C. 起動導線（yuru / tray）
- [ ] C-1 仕様（docs）: 2回目以降の `yuru` は **追加で新ターミナルを開く**を正とする（`docs/spec.md` 10.x）
- [ ] C-1 テスト: `target/debug/yuru.exe` を2回起動して Terminal が2枚増える

### D. Overview（タイル一覧 / Run相当） ※優先度低
- [ ] D-1 実装: Orchestrator から Overview を開ける（tray/メニュー/ショートカットのいずれか）
- [ ] D-1 テスト: Overview を開閉しても Terminal は壊れない（入力/表示が継続）
- [ ] D-2 実装: 起動時に Overview を表示する設定（ON/OFF、既定OFF）
- [ ] D-2 テスト: ON/OFF で起動時の挙動が変わる

### E. 設定（参照元の明確化）
- [ ] E-1 実装: 既定値（terminal font/size/scrollback 等）の参照元を `docs/spec.md` から辿れるようにする（実装ファイルへリンク）
- [ ] E-1 テスト: `docs/spec.md` のリンク/記述が最新実装と一致（自己レビュー）

### F. 手動テスト（随時）
- [ ] F-1 IME（変換/確定/キャンセル）
- [ ] F-2 Copy/Paste（許可ダイアログ含む）
- [ ] F-3 Resize
- [ ] F-4 `yuru` 起動で余計な window が勝手に出ない（Chat/Run/Settings が見えない）

---

## 参照
- `docs/concept.md`
- `docs/spec.md`
- `docs/architecture.md`
