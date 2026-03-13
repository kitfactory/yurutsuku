# delta-apply

## Delta ID
- DR-20260313-watcher-frame-on-focus

## Delta Type
- REPAIR

## 実行ステータス
- APPLIED

## 確認済み Candidate Files/Artifacts
- docs/delta/DR-20260313-watcher-frame-on-focus.md
- apps/orchestrator/src-tauri/src/main.rs
- apps/orchestrator/src/index.html
- apps/orchestrator/integration.test.js
- docs/OVERVIEW.md
- docs/spec.md
- docs/architecture.md

## 変更ファイル/成果物
- docs/delta/DR-20260313-watcher-frame-on-focus.md
- docs/delta/DR-20260313-watcher-frame-on-focus.apply.md
- apps/orchestrator/src-tauri/src/main.rs
- apps/orchestrator/src/index.html
- apps/orchestrator/integration.test.js
- docs/OVERVIEW.md
- docs/spec.md
- docs/architecture.md
- docs/plan.md

## 適用内容（AC対応）
- AC-01:
  - 変更: 通常 watcher の初期生成を `decorations(false)` / `resizable(false)` に戻し、`set_watcher_window_framed` で focus 時のみ framed へ切替えるようにした
  - 根拠: 非選択時は枠なし、選択時だけ通常 window として扱うため
- AC-02:
  - 変更: frontend の frame 同期を通常 watcher でも有効化しつつ、通常 watcher の framed 判定は focus のみに限定した
  - 根拠: pointer inside だけで枠が出ないようにするため
- AC-03:
  - 変更: docs / integration test を「通常 watcher は focus 時のみ native frame」前提へ更新した
  - 根拠: 実装と正本・回帰検知を一致させるため

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
- 検証してほしい観点: 通常 watcher が focus 時のみ native frame を表示する前提へ戻っているか
- review evidence: `npm test -w apps/orchestrator -- --test-reporter=spec` / `cargo check -p nagomi-orchestrator`
