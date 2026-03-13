# delta-request

## Delta ID
- DR-20260313-watcher-native-window

## Delta Type
- REPAIR

## 目的
- 通常 watcher の選択時操作を custom frame overlay から OS 標準のネイティブウィンドウ操作へ戻す。
- 3D キャラクター表示が close / maximize / resize などの window 操作を阻害しない状態にする。

## 変更対象（In Scope）
- 対象1: 通常 watcher の window 作成設定を native decorations/resizable 前提へ変更する
- 対象2: 通常 watcher の custom frame overlay と専用 resize IPC 依存を停止する
- 対象3: watcher 仕様文書を新挙動へ同期する

## 非対象（Out of Scope）
- 非対象1: `watcher-debug` の開発用ウィンドウ挙動変更
- 非対象2: 3D レンダラ自体のモデル読込/モーション/表示品質改善
- 非対象3: tray / settings / character pack の機能追加

## Candidate Files/Artifacts
- docs/delta/DR-20260313-watcher-native-window.md
- apps/orchestrator/src-tauri/src/main.rs
- apps/orchestrator/src/index.html
- apps/orchestrator/integration.test.js
- docs/OVERVIEW.md
- docs/spec.md
- docs/architecture.md
- docs/plan.md

## 差分仕様
- DS-01:
  - Given: 通常 watcher を開いている
  - When: watcher window を選択して移動/サイズ変更/最大化/閉じるを行う
  - Then: custom frame overlay ではなく OS 標準の window frame で操作できる
- DS-02:
  - Given: 通常 watcher が 3D 表示中である
  - When: watcher window を操作する
  - Then: 3D 表示は client area 内に収まり、titlebar / frame 操作を阻害しない
- DS-03:
  - Given: watcher 関連 docs とテストが存在する
  - When: 今回の修正を適用する
  - Then: custom frame 前提の記述/検証は通常 watcher の native window 前提へ更新される

## 受入条件（Acceptance Criteria）
- AC-01: 通常 watcher は Rust 側で decorated/resizable な native window として生成される
- AC-02: 通常 watcher の custom close button / resize handle と、それに依存する frontend 操作導線が表示されない
- AC-03: docs と統合テストが「通常 watcher は native titlebar / OS resize を使う」前提へ一致する

## Verify Profile
- static check: Required
- targeted unit: Not Required
- targeted integration / E2E: Required
- delta-project-validator: Not Required

## Canonical Sync Mode
- mode: direct canonical update
- reason: 実装と同時に watcher 仕様の正本同期が必要なため

## 制約
- 制約1: 既存の dirty worktree を巻き込まない
- 制約2: `watcher-debug` の既存操作系は壊さない

## Review Gate
- required: Yes
- reason: Rust window 設定、frontend UI、正本文書を跨ぐ挙動変更のため

## Review Focus（REVIEW または review gate required の場合）
- checklist: `docs/delta/REVIEW_CHECKLIST.md`
- target area: 通常 watcher の window frame 制御、3D pointer 挙動、docs 同期

## 未確定事項
- Q-01: Windows の透明 decorated window で最大化ボタンの実利用感が十分かは実機確認が必要
