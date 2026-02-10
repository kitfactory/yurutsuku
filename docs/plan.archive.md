# Plan Archive

`docs/plan.md` は current / future のみ。完了した plan はここに移す。

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

---

## 2026-02-10: P0 current（H〜M）を plan.md から archive へ移管

- [x] H. 外部ツールフック（仕様/実装/テスト）
- [x] J. 環境同期（Terminal）
- [x] K. ストリーム+フック統合 / LLM Judge
- [x] A. 観測（Watcher）: 仕様の確定
- [x] B. 観測（Watcher）: 実装の安定化
- [x] I. 終了検知の部品化（部品→単体テスト→統合）
- [x] C. 起動導線（nagomi / tray）
- [x] E. 設定（参照元の明確化）
- [x] G. 体験: フォーカス切替アニメーション
- [x] L. 状態UX（idle/success/need_input/failure）
- [x] M. UX拡張（Palette / Settings / Double Click）

備考:
- 以降の `current` は future 6-9 を再展開した N-6〜N-9（文書→テスト→実装→テスト）を対象とする。

