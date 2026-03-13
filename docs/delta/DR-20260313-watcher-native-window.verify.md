# delta-verify

## Delta ID
- DR-20260313-watcher-native-window

## Requested Verify Profile
- static check: Required
- targeted unit: Not Required
- targeted integration / E2E: Required
- delta-project-validator: Not Required

## Executed Verify
- static check: `cargo build -p nagomi-orchestrator`
- targeted unit: Not Required
- targeted integration / E2E: `npm test -w apps/orchestrator -- --test-reporter=spec`
- delta-project-validator: Not Required

## 検証結果（AC単位）
| AC | 結果(PASS/FAIL) | 根拠 |
|---|---|---|
| AC-01 | PASS | `cargo build -p nagomi-orchestrator` 成功。通常 watcher 生成コードを `decorations(true)` / `resizable(true)` へ更新 |
| AC-02 | PASS | `apps/orchestrator/src/index.html` で通常 watcher の custom frame 制御を debug 専用へ限定し、3D 表示を client area `100%` 追従へ変更 |
| AC-03 | PASS | `npm test -w apps/orchestrator -- --test-reporter=spec` が 74 pass。関連 docs / integration test を native window 前提へ更新 |

## スコープ逸脱チェック
- Out of Scope 変更の有無: No
- 逸脱内容:

## Canonical Sync Check
- mode: direct canonical update
- status: docs 同期済み
- result: PASS

## 不整合/回帰リスク
- R-01: Windows の透明 decorated window における最大化・ドラッグ体験は実機確認がまだ必要

## Review Gate
- required: Yes
- checklist: `docs/delta/REVIEW_CHECKLIST.md`
- layer integrity: PASS
- docs sync: PASS
- data size: NOT CHECKED
- code split health: PASS
- file-size threshold: PASS

## Review Delta Outcome
- pass: Yes
- follow-up delta seeds:
  - main.rs / index.html の肥大化は既存課題として別 delta で分割検討

## 参考所見（合否外）
- O-01: `cargo build -p nagomi-orchestrator` は成功したが、既存の未使用コード warning は継続している

## 判定
- Overall: PASS

## FAIL時の最小修正指示
- Fix-01:
