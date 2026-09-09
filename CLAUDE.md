# ai-character-3d

AI キャラクター生成の 3D ワークフロー。ComfyUI（キャラデザ / 多視点）→ Tripo AI（3D 化・リグ・アニメ）→ Blender（手直し・8 方向スプライトレンダ）。研究目的。

設計・調査は `docs/`。実装は `src/`、Blender スクリプトは `scripts/blender/`。

## コマンド

```bash
bun run c3d concept <char>            # ComfyUI: 正面 A-pose 候補
bun run c3d views   <char>            # ComfyUI: back/left/right 派生 → Tripo 用 4 面
bun run c3d model   <char> --faces 20000 --low-poly  # Tripo: 4 面 → model.glb（50 credits）
bun run c3d retarget <char>           # Blender headless: ARP Remap で motions/ を anim.blend に焼く
bun run c3d render  <char>            # Blender headless: 8 方向 × フレーム PNG（color + normal）
bun run c3d sheet   <char> --size 128 # スプライトシート PNG + JSON
bun run c3d export  <char>            # Blender headless: ARP Export → Godot 4 向け .glb（全アニメ入り）
bun run c3d export  <char> --anim-only # 同上、メッシュ抜き（1 三角形）→ Godot の AnimationLibrary 用
```

`chars/<name>.yaml` がキャラ定義。生成物は `out/chars/<name>/` 配下（gitignore）。
モーション素材は `motions/mixamo/` `motions/quaternius/`（FBX は gitignore、README のみ）。
`export` はゲームエンジン向けの枝で、`render` とは独立に `anim.blend` を読む。Godot humanoid のボーン名にリネームし、アクション 1 本 = glTF アニメ 1 本で書き出す。
`--anim-only` は共有スケルトン運用向け。アニメは 1 ファイル（AnimationLibrary）にまとめ、キャラ側はメッシュ + スケルトンだけ持つ構成にできる。
`retarget` は `out/chars/<name>/rig.blend`（ARP でリグ・スキニング済み、手作業）を要求する。手順は `docs/research/blender-arp-retarget.md`。

## コード編集後

`src/` を触ったら必ず:

```bash
bun run check   # format -> lint -> typecheck
bun test
```

`src/types/nodes.ts` は `bun run codegen` の生成物（ComfyUI 起動中に実行）。手で編集しない。

## 外部ツール

- ComfyUI Desktop `http://127.0.0.1:8188`（RTX 4080 16GB）。MCP `comfyui` で状態確認・モデル DL。
- Tripo API v3（`@vastai/tripo-sdk`）。`.env` の `TRIPO_API_KEY`。v2 API は 2026-11-01 停止。課金は `docs/research/tripo-ai.md` §2。**Tripo に投げるのはメッシュ生成のみ**（1 キャラ 50 credits）。リグ・アニメは Blender + Auto-Rig Pro。
- Blender 5.2 LTS `C:\Program Files\Blender Foundation\Blender 5.2\blender.exe`。バッチは `src/lib/blender.ts` 経由の headless、対話的な確認・手直しは MCP `blender`（`.mcp.json`）。MCP はアドオン側で "Start MCP Server" が押されている必要がある（port 9876）。

## 落とし穴

- Bash tool は `cd` 後に PATH を失うことがある。PowerShell tool を使う。
- Blender は未捕捉例外でも exit 0 → `render_sprites.py` は try/except で 1 を返す。
- `c3d export` 中の `gather_actions_hook fails ... 'ActionsData' object has no attribute 'blender_tracks'` は無害。ARP の NLA 名付けフックが Blender 5.2 の glTF エクスポータ API に追従してないだけで、アニメ本体は ARP 側の bake で出ている（キー数・尺をキャラ glb と突合済み）。
- Tripo の出力 URL は成功後 5 分で失効。`tasks.json` に task_id を残してあるので、失効したら `tripo task get <id>` で取り直す。
- glTF は Blender で -Y 向き、Quaternius/UE 系 FBX は +Y 向き。`c3d render --facing` で切替。
- Tripo の出力は +X 正面・身長 1.0 単位に正規化。リグを組む前に `scripts/blender/orient_model.py` で -Y 正面・実寸・接地に直す。
