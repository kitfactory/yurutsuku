# delta-verify

## Delta ID
- DR-20260313-watcher-frame-on-focus

## Requested Verify Profile
- static check: Required
- targeted unit: Not Required
- targeted integration / E2E: Required
- delta-project-validator: Not Required

## Executed Verify
- static check: `cargo check -p nagomi-orchestrator`
- targeted unit: Not Required
- targeted integration / E2E: `npm test -w apps/orchestrator -- --test-reporter=spec`
- delta-project-validator: Not Required

## 検証結果（AC単位）
| AC | 結果(PASS/FAIL) | 根拠 |
|---|---|---|
| AC-01 | PASS | 通常 watcher の初期生成を `decorations(false)` / `resizable(false)` に戻し、`set_watcher_window_framed` で切替える実装へ更新 |
| AC-02 | PASS | `apps/orchestrator/src/index.html` で通常 watcher の framed 判定を `focused` のみにし、pointer inside は `watcher-debug` に限定 |
| AC-03 | PASS | `npm test -w apps/orchestrator -- --test-reporter=spec` が 74 pass。docs / integration test を focus 時のみ frame 前提へ更新 |

## スコープ逸脱チェック
- Out of Scope 変更の有無: No
- 逸脱内容:

## Canonical Sync Check
- mode: direct canonical update
- status: docs 同期済み
- result: PASS

## 不整合/回帰リスク
- R-01: `cargo build -p nagomi-orchestrator` は実行中の `target\\debug\\nagomi-orchestrator.exe` ロックで失敗しうるため、今回の static check は `cargo check` で代替した

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
  - 実機で focus 通知が遅延する場合の pointerdown fallback 調整

## 参考所見（合否外）
- O-01: Rust 側の既存未使用コード warning は継続している

## 判定
- Overall: PASS

## FAIL時の最小修正指示
- Fix-01:
