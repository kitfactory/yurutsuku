# コンセプト

入口は `docs/OVERVIEW.md`。ここは最小の方針と用語だけを記載する。

## 目的
- Windows P0 で Orchestrator + Worker + PTY の最小ターミナル体験を完成させる
- Terminal 画面は一般的なターミナルアプリとして動作し、PTY 出力のみを表示する
- IPC通信セッションを分離し、E2E でハンドシェイクを検証できる状態にする

## フェーズ
- P0: Windows-only (Orchestrator + Windows Worker)
- P1: WSL Worker
- P2: Linux/macOS

## 用語 / UI
- セッション: PTY/Worker と接続された単位
- Chat モード: 対話レーン + キャラクター表示
- Run モード: セッション一覧とウィンドウ整列 UI
- Terminal 画面: PTY 出力のみを表示するターミナル UI
- Worker: PTY を起動し入出力を扱うプロセス
- Orchestrator: UI と Worker をつなぎ、IPC/設定/セッション管理を行う

## Spec ID
- REQ-001: モデル基盤
- REQ-002: Protocol (JS/Rust)
- REQ-003: Worker (Rust)
- REQ-004: Orchestrator (Tauri)
- REQ-005: Orchestrator ↔ Worker 接続
- REQ-006: Chat モード UI
- REQ-007: キャラクター UI
- REQ-008: Run モード UI
- REQ-009: Heuristic Judge
- REQ-010: 通知 (OS + 音声)
- REQ-011: ログ/マスク/運用
- REQ-012: Settings
- REQ-013: P1: WSL Worker
