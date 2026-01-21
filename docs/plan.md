# Plan (NOW)

入口は `docs/OVERVIEW.md`。このファイルは **NOW のみ**（完了/履歴は `docs/plan.archive.md`）。

---

## 今回: 次の作業（P0）: 起動導線と設定の地ならし
対象: REQ-004/005/012 + `docs/spec.md` 2.x / 7.x / 10.x

- [ ] 起動導線を整理する（「不要な画面が勝手に増える」を根絶する）
  - [ ] Terminal/Chat/Run/Settings を「必要時にだけ開く」導線を確定する（tray/yuru/内部API）
  - [x] `yuru` 多重起動でも Terminal が壊れない（session 重複で `[error session already exists]` にならない）
  - [x] 複数 Terminal window で入力/出力が混ざらない（各 window は独立セッション）
  - [ ] 2回目以降の `yuru` の期待動作を確定する（追加で開く or 既存フォーカス）
- [ ] 設定値の参照元を明確化する（ハードコードは現状維持でOK）
  - [ ] 既定値（terminal font/size/scrollback 等）の参照元を `docs/spec.md` から辿れるようにする（実装ファイルへのリンク）
  - [ ] 既定値の責務を整理する（UI 既定 / Rust Settings::default / .env 既定）
- [ ] Terminal 設定 UI を「将来の拡張前提」で整える（まだUIの作り込みはしない）
  - [ ] font family / font size の入力バリデーション方針を決める
  - [ ] 設定の反映タイミング（即時/保存時）を明文化する
- [ ] 動作確認（手動）
  - [ ] IME / Copy&Paste / Resize が引き続き動く
  - [ ] `yuru` 起動で余計な window が勝手に出ない
  - [ ] 全 terminal window を閉じたら Orchestrator も終了する（`yuru` 起動時 / `--exit-on-last-terminal`）

## 参照
- `docs/spec.md`
- `docs/concept.md`
- `docs/architecture.md`
