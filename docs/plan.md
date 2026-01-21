# Plan (NOW)

入口は `docs/OVERVIEW.md`。このファイルは **NOW のみ**（完了/履歴は `docs/plan.archive.md`）。

---

## 目的（P0 / Windows）
nagomi（名称検討中）の中核である「複数ターミナル並列作業」を、観測ベースで **分かりやすく・壊れにくく**する。

- ユーザー体験（最優先）: `yuru.exe` を起動すると **ターミナルアプリを開いたのと同じ感覚**で 1 枚の Terminal が開く
- Orchestrator の役割: タスクトレイ常駐で Terminal を管理し、観測結果を UI に反映する
- Overview（タイル一覧）は起動可能にするが、優先度は下げる（まずは観測の確度と表示）

---

## 今回スコープ（P0）
対象: REQ-004/005/012 + `docs/spec.md` 2.x / 10.x

### A. 観測（Watcher）を仕様化して安定させる（最優先）
- [ ] 観測状態モデルを `docs/spec.md` に追記する（観測ベースのみ）
  - [ ] state: `running | need_input | stalled | success | fail`
  - [ ] 判定根拠: exit_code / 無出力時間 / 末尾プロンプト風（誤爆回避優先）
  - [ ] しきい値（秒）と抑制（同じ状態の連投禁止）を定義する
    - [ ] P0 既定: `need_input` は 15s（末尾がプロンプト風のときのみ）、`stalled` は 60s（プロセス生存かつ無出力）
- [ ] Terminal window の Watcher 表示を “仕様として固定” する
  - [ ] 右下レイヤーにキャラ（nagomisan）を表示
  - [ ] 状態に応じて terminal の色を薄く変える（tint、背景に対して半透明・トーン統一）
  - [ ] 状態遷移の最小テスト観点（手動）を定義（Running→Stalled→NeedInput / exitでSuccess/Fail）

### B. Orchestrator が観測データを保持できるようにする
- [ ] （後回し）Orchestrator 側で session ごとに観測用メタ情報を保持する
  - [ ] P0 は UI（Terminal window）内だけの観測でも運用する（Overview/タイルの本格対応前）
  - [ ] 後続で last_output_at / tail / exit_code / alive を Orchestrator 正本に寄せる

### C. 起動導線（yuru / tray）を確定する
- [ ] 2回目以降の `yuru` の期待動作を確定する
  - [ ] 追加で Terminal を開く or 既存をフォーカス（session_id の扱い含む）
- [ ] Overview（Run相当）を Orchestrator から開けるようにする（優先度低）
  - [ ] tray/メニュー/ショートカットのどれを採用するか決める
  - [ ] 起動時に Overview を自動表示する設定（ON/OFF）を設計（既定OFF）

### D. 設定（参照元の明確化）
- [ ] 既定値（terminal font/size/scrollback 等）の参照元を `docs/spec.md` から辿れるようにする（実装ファイルへのリンク）
- [ ] 既定値の責務を整理する（UI 既定 / Rust Settings::default / .env 既定）

### E. 動作確認（手動）
- [ ] IME / Copy&Paste / Resize が引き続き動く
- [ ] Watcher が状態に応じて変わる（Running/NeedInput/Stalled/Success/Fail）
- [ ] `yuru` 起動で余計な window が勝手に出ない（Chat/Run/Settings が見えない）

---

## 参照
- `docs/concept.md`
- `docs/spec.md`
- `docs/architecture.md`
