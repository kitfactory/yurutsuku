# delta-apply

## Delta ID
- DR-20260313-watcher-native-window

## Delta Type
- REPAIR

## 実行ステータス
- APPLIED

## 確認済み Candidate Files/Artifacts
- docs/delta/DR-20260313-watcher-native-window.md
- apps/orchestrator/src-tauri/src/main.rs
- apps/orchestrator/src/index.html
- apps/orchestrator/integration.test.js
- docs/OVERVIEW.md
- docs/spec.md
- docs/architecture.md
- docs/plan.md

## 変更ファイル/成果物
- docs/delta/DR-20260313-watcher-native-window.md
- docs/delta/DR-20260313-watcher-native-window.apply.md
- apps/orchestrator/src-tauri/src/main.rs
- apps/orchestrator/src/index.html
- apps/orchestrator/integration.test.js
- docs/OVERVIEW.md
- docs/spec.md
- docs/architecture.md
- docs/plan.md

## 適用内容（AC対応）
- AC-01:
  - 変更: 通常 watcher の `WebviewWindowBuilder` を `decorations(true)` / `resizable(true)` に変更した
  - 根拠: OS 標準の titlebar / 枠で移動・最大化・閉じる・サイズ変更を可能にするため
- AC-02:
  - 変更: 通常 watcher 向けの custom frame 選択/リサイズ経路を停止し、3D 表示は client area に `100%` 追従させた
  - 根拠: 3D canvas が前面で custom UI を持つ構成をやめ、OS 枠操作を阻害しないため
- AC-03:
  - 変更: integration test と `docs/OVERVIEW.md` / `docs/spec.md` / `docs/architecture.md` / `docs/plan.md` を native window 前提へ更新した
  - 根拠: 実装と正本文書・回帰検知を一致させるため

## 非対象維持の確認
- Out of Scope への変更なし: Yes
- もし No の場合の理由:

## Canonical Sync
- mode: direct canonical update
- action: 実装変更と同時に watcher 仕様文書を同期
- status: DONE

## コード分割健全性
- 500行超のファイルあり: Yes
- 800行超のファイルあり: Yes
- 1000行超のファイルあり: Yes
- 長大な関数なし: Yes
- 責務過多のモジュールなし: No

## verify 依頼メモ
- request profile:
  - static check: Required
  - targeted unit: Not Required
  - targeted integration / E2E: Required
  - delta-project-validator: Not Required
- 検証してほしい観点: 通常 watcher が native window 前提へ切り替わっているか、custom frame 前提が残っていないか
- review evidence: `npm test -w apps/orchestrator -- --test-reporter=spec` / `cargo build -p nagomi-orchestrator`
