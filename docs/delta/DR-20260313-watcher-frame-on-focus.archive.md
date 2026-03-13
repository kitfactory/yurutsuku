# delta-archive

## Delta ID
- DR-20260313-watcher-frame-on-focus

## Archive Status
- CLOSED

## Summary
- 通常 watcher の native frame を常時表示から focus 時のみ表示へ戻した
- 非選択時は枠なしへ戻しつつ、選択時の native close / maximize / resize / move 操作は維持した
- 実装、統合テスト、正本文書を同じ前提へ同期した

## Verify Result
- PASS

## Canonical Sync
- direct canonical update: DONE

## Evidence
- `npm test -w apps/orchestrator -- --test-reporter=spec`
- `cargo check -p nagomi-orchestrator`

## Notes
- `cargo build -p nagomi-orchestrator` は実行中 exe ロックで失敗したため、今回は `cargo check` を静的検証として採用
