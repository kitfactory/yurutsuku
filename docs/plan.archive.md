# Plan Archive

`docs/plan.md` は NOW のみ。完了した plan はここに移す。

---

## 2026-01-21: P0 / Windows Terminal（正しさ + 体感）

- 入力/出力の詰まり（Backspace 連打など）を改善（single-flight / coalesce / backpressure）
- IME（変換/キャンセル含む）を OS 任せで動作させる（独自の変換処理を持たない）
- Copy/Paste を OS クリップボードで扱えるようにする（許可ダイアログを出さない経路に寄せる）
- Resize を安定させる
- 既定 scrollback を 5,000 行にする
- terminal-output-broadcast は既定 OFF（env で ON）
- Terminal の既定フォントを等幅にし、font size を 18 にする
- E2E: WebGL renderer 有無で壊れないように調整、stress を追加

---

## 2026-01-21: `yuru.exe`（launcher）で Orchestrator + Terminal を起動する
対象: REQ-004/005 + `docs/spec.md` 10.x

- [x] 起動時に不要なウィンドウが立ち上がらない（tray 常駐、必要時のみ window を開く）
- [x] Orchestrator: ヘルスチェックに加えて `/open-terminal` を提供する
- [x] `yuru.exe`: Orchestrator を起動し、Terminal window を開く
- [x] 動作確認
  - [x] `yuru` で Terminal window が1つ開く（Chat/Run/Settings が勝手に開かない）
  - [x] 2回目の `yuru` で Terminal window が追加で開く（または既存をフォーカスする）

