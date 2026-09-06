# ai-character-3d

AI キャラクター生成の 3D ワークフロー。ComfyUI（キャラデザ / 多視点）→ Tripo AI（3D 化・リグ・アニメ）→ Blender（手直し・8 方向スプライトレンダ）。研究目的。

設計・調査は `docs/`。実装は `src/`、Blender スクリプトは `scripts/blender/`。

## コマンド

```bash
bun run c3d concept <char>            # ComfyUI: 正面 A-pose 候補
bun run c3d views   <char>            # ComfyUI: back/left/right 派生 → Tripo 用 4 面
bun run c3d model   <char> --animate  # Tripo: 3D 化 → リグ → プリセットアニメ GLB
bun run c3d render  <char>            # Blender headless: 8 方向 × フレーム PNG（color + normal）
bun run c3d sheet   <char> --size 128 # スプライトシート PNG + JSON
```

`chars/<name>.yaml` がキャラ定義。生成物は `out/chars/<name>/` 配下（gitignore）。

## コード編集後

`src/` を触ったら必ず:

```bash
bun run check   # format -> lint -> typecheck
bun test
```

`src/types/nodes.ts` は `bun run codegen` の生成物（ComfyUI 起動中に実行）。手で編集しない。

## 外部ツール

- ComfyUI Desktop `http://127.0.0.1:8188`（RTX 4080 16GB）。MCP `comfyui` で状態確認・モデル DL。
- Tripo API v3（`@vastai/tripo-sdk`）。`.env` の `TRIPO_API_KEY`。v2 API は 2026-11-01 停止。課金は `docs/research/tripo-ai.md` §2。
- Blender 5.2 LTS `C:\Program Files\Blender Foundation\Blender 5.2\blender.exe`。バッチは `src/lib/blender.ts` 経由の headless、対話的な確認・手直しは MCP `blender`（`.mcp.json`）。MCP はアドオン側で "Start MCP Server" が押されている必要がある（port 9876）。

## 落とし穴

- Bash tool は `cd` 後に PATH を失うことがある。PowerShell tool を使う。
- Blender は未捕捉例外でも exit 0 → `render_sprites.py` は try/except で 1 を返す。
- Tripo の出力 URL は成功後 5 分で失効。`tasks.json` に task_id を残して再ダウンロード可能にしてある。
- Tripo でメッシュ編集（decimate / segment）するとリグが消える。リグは最後。
- glTF は Blender で -Y 向き、Quaternius/UE 系 FBX は +Y 向き。`c3d render --facing` で切替。
