# delta-archive

## Delta ID
- DR-20260313-watcher-native-window

## Archive Status
- CLOSED

## Summary
- 通常 watcher を custom frame overlay 前提から Windows の native titlebar / 枠を使う通常ウィンドウへ戻した
- 3D 表示は client area に追従させ、OS の close / maximize / resize / move 操作を阻害しない前提へ整理した
- 実装、統合テスト、正本文書を同一方針へ同期した

## Verify Result
- PASS

## Canonical Sync
- direct canonical update: DONE

## Evidence
- `npm test -w apps/orchestrator -- --test-reporter=spec`
- `cargo build -p nagomi-orchestrator`

## Notes
- 大型ファイルの分割は今回の Out of Scope とし、必要なら follow-up delta で扱う
