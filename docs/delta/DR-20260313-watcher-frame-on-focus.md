# delta-request

## Delta ID
- DR-20260313-watcher-frame-on-focus

## Delta Type
- REPAIR

## 目的
- 通常 watcher の native frame を常時表示ではなく、選択時（focus 時）のみ表示へ戻す。
- 前回戻した native close / maximize / resize / move 操作は維持する。

## 変更対象（In Scope）
- 対象1: 通常 watcher の native frame 切替を focus/blur 連動へ変更する
- 対象2: 関連テストと watcher 仕様文書を表示条件へ同期する

## 非対象（Out of Scope）
- 非対象1: `watcher-debug` の既存挙動変更
- 非対象2: 3D レンダラ自体の読込/モーション改善
- 非対象3: tray / settings / pack 管理の変更

## Candidate Files/Artifacts
- docs/delta/DR-20260313-watcher-frame-on-focus.md
- apps/orchestrator/src-tauri/src/main.rs
- apps/orchestrator/src/index.html
- apps/orchestrator/integration.test.js
- docs/OVERVIEW.md
- docs/spec.md
- docs/architecture.md

## 差分仕様
- DS-01:
  - Given: 通常 watcher が非選択で表示されている
  - When: focus していない
  - Then: native titlebar / frame は非表示である
- DS-02:
  - Given: 通常 watcher をクリックして選択する
  - When: focus が入る
  - Then: native titlebar / frame が表示され、close / maximize / resize / move を OS 標準操作で行える
- DS-03:
  - Given: 通常 watcher が選択されている
  - When: blur する
  - Then: native titlebar / frame は再び非表示になる

## 受入条件（Acceptance Criteria）
- AC-01: 通常 watcher は初期状態で `decorations=false` / `resizable=false` で開き、focus 時のみ framed 状態へ切り替わる
- AC-02: 通常 watcher の frame 切替は focus/blur ベースで動作し、pointer inside だけでは表示しない
- AC-03: docs と統合テストが「通常 watcher は選択時のみ native frame」を前提に一致する

## Verify Profile
- static check: Required
- targeted unit: Not Required
- targeted integration / E2E: Required
- delta-project-validator: Not Required

## Canonical Sync Mode
- mode: direct canonical update
- reason: 実装と watcher 仕様の整合を同時に戻す必要があるため

## 制約
- 制約1: 既存の dirty worktree を巻き込まない
- 制約2: 前回戻した native close / maximize / resize / move の経路は壊さない

## Review Gate
- required: Yes
- reason: Rust window 設定、frontend focus 制御、文書同期を跨ぐため

## Review Focus（REVIEW または review gate required の場合）
- checklist: `docs/delta/REVIEW_CHECKLIST.md`
- target area: 通常 watcher の focus/blur frame 制御

## 未確定事項
- Q-01: 透明 watcher window で focus 通知が遅延する環境では pointerdown 後の再同期がどこまで必要かは実機確認が必要
