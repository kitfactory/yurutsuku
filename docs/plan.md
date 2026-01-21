# Plan (NOW)

## 今回（P0 / Windows Terminal 体験）
- [ ] Terminal: 入力/表示の体感改善（A/B）
  - [x] B: 送受信の coalesce / single-flight / 送出頻度の適応
  - [x] A: xterm WebGL renderer addon（失敗時は自動フォールバック）
  - [x] scrollback デフォルト 5000
  - [x] terminal-output-broadcast は既定 OFF（必要時のみ `YURUTSUKU_ENABLE_TERMINAL_OUTPUT_BROADCAST=1`）
- [ ] 現物テスト
  - [ ] Backspace 連打 / 行編集 / IME 変換 / Copy&Paste / Resize
  - [ ] E2E: `npm run e2e -w apps/orchestrator`
- [ ] リリースビルド確認
  - [ ] `cargo build -p yurutsuku-orchestrator --release`（または `cargo tauri build`）
- [ ] Git
  - [ ] 変更をコミット
  - [ ] origin/main に push

## 参照
- `docs/OVERVIEW.md`
- `docs/spec.md`
- `docs/architecture.md`
