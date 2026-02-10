# docs/OVERVIEW.md（入口 / 運用の正本）

この文書は **プロジェクト運用の正本**です。`AGENTS.md` は最小ルールのみで、詳細はここに集約します。

---

## 現在地（必ず更新）
- 現在フェーズ: P0
- 今回スコープ（1〜5行）:
  - 起動導線（`nagomi.exe`）を軸に、Orchestrator/Terminal を「必要時だけ開く」体験を固める
  - nagomi: ターミナル並列作業の「俯瞰（Overview）＋順番フォーカス＋観測ベース状態表示」を中核に据える
  - Terminal の環境変数をユーザー環境に同期し、PATH 等の差分をなくす
  - Windows 設定画面に `Windows` カテゴリを追加し、terminal 起動方式（CMD / PowerShell / WSL）と WSL distro 選択を分離する
  - テーマは 6 種類（light-sand / light-sage / light-sky / dark-ink / dark-ocean / dark-ember）を 1 つの選択UIで提供する
  - Terminal ストリームと AI フックの統合で終了候補を作り、AI判定（JSON 出力）で状態を確定する
  - 既定値（フォント/サイズ/scrollback 等）の参照元を docs→実装まで辿れる状態にする（値は当面ハードコードでOK）
  - トレイから設定画面を開ける導線を整える
  - docs（正本）を実装に追従させ、将来の改修が迷子にならない状態にする
- 非ゴール（やらないこと）:
  - P1 (WSL Worker) の実装
  - P2 (Linux/macOS) の対応
  - ターミナルのタブ/分割/検索などの拡張操作
- 重要リンク:
  - concept: `./concept.md`
  - spec: `./spec.md`
  - usage: `./usage.md`
  - architecture: `./architecture.md`
  - plan (NOW): `./plan.md`
  - plan (archive): `./plan.archive.md`
  - tauri-driver E2E: `./tauri-driver-e2e.md`
  - complete spec: `../nagomi_complete_spec_v1.3.md`

---

## レビューゲート（必ず止まる）
共通原則：**自己レビュー → 完成と判断できたらユーザー確認 → 合意で次へ**

---

## 更新の安全ルール（判断用）
### 合意不要
- 誤字修正、リンク更新、意味を変えない追記
- plan のチェック更新
- 小さな明確化（既存方針に沿う）

### 提案→合意→適用（必須）
- 大量削除、章構成変更、移動/リネーム
- Spec ID / Error ID の変更
- API/データモデルの形を変える設計変更
- セキュリティ/重大バグ修正で挙動が変わるもの
