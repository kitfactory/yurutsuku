# アーキテクチャ

入口は `docs/OVERVIEW.md`。レイヤー責務・依存方向・主要I/Fを明文化する。

## レイヤー構成
- UI レイヤー: `apps/orchestrator/src`（TS UI）
- Orchestrator レイヤー: `apps/orchestrator/src-tauri`（Tauri/Rust）
- Worker レイヤー: `crates/worker`（Rust）
- Protocol レイヤー: `packages/protocol`（TS）/`crates/protocol`（Rust）

## 依存方向
- UI → Orchestrator → Worker
- UI → Protocol / Orchestrator → Protocol / Worker → Protocol
- 逆流禁止（Worker が UI/Orchestrator を参照しない）

## Orchestrator（場）責務
- トレイ常駐、ウィンドウ生成（Chat/Run/Settings）
- セッション管理（作成/停止/フォーカス/並び替え）
- Worker 管理（P0 はローカルのみ）
- UI 状態（キャラ、レーン、タイル、バッジ）
- Judge 実行（標準: Orchestrator 側）
- 通知（OS トースト + 音声）
- 後続処理（提案の表示/実行）
- 設定永続化（JSON）

## Worker（手）責務
- PTY/ConPTY でプロセスを起動し入出力を維持
- 出力を chunk 化して Orchestrator へ送信
- resize 対応
- stop/cleanup（子プロセスを確実に終了）
- 判定は原則しない（phase 推定は可）

## Orchestrator ⇄ Worker I/F（P0）
- stdio の NDJSON（1行1JSON）
- Orchestrator が Worker を spawn し、stdin/stdout で送受信
- 詳細は `docs/spec.md` のプロトコル章に準拠
