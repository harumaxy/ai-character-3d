# ai-character-3d

AI でゲームキャラクターを **3D 経由**で作り、トップビュー 8 方向スプライトに落とすワークフロー。研究目的。

```
ComfyUI (ローカル)                 Tripo AI (API v3)              Blender 5.2 (headless / MCP)
 concept: 正面 A-pose 候補   →   model: multiview → 3D      →   render: 8 方向 × フレーム PNG
 views:   back/left/right 派生     rig / retarget (preset)        sheet:  スプライトシート + JSON
```

背景: `../pixel-2d-game-art` の SD1.5 + AnimateDiff 直接生成は walk/run 以外で破綻した。3D 化してからレンダーすれば、姿勢・方向・フレーム間の一貫性は幾何で担保される（Donkey Kong Country / Dead Cells 方式）。調査は `docs/research/`:

- [`tripo-ai.md`](docs/research/tripo-ai.md) — 料金・API v3・SDK・利用規約
- [`tripo-quality-tips.md`](docs/research/tripo-quality-tips.md) — 入力画像とパラメータのコツ、Blender 後処理
- [`comfyui-charsheet.md`](docs/research/comfyui-charsheet.md) — 正面画とマルチビューの作り方
- [`blender-mcp-and-sprite-render.md`](docs/research/blender-mcp-and-sprite-render.md) — Blender MCP と 8 方向レンダの設計

## 必要なもの

- [Bun](https://bun.sh)（`mise install`）
- ComfyUI 起動中（既定 `http://127.0.0.1:8188`、`COMFY_URL` で変更）。モデル: FLUX.2 klein 9B fp8 / Anima / Qwen-Image-Edit 2511 GGUF Q5_0 + Lightning 4step LoRA / RMBG-2.0。任意で fal Multiple-Angles LoRA（`loras/qwen/`、`views` が自動検出）
- Tripo API キー（`.env` の `TRIPO_API_KEY`、https://platform.tripo3d.ai/api-keys）。API は従量制、1 credit = $0.01、1 キャラ（3D + リグ + 3 アニメ）でおよそ 100〜130 credits
- Blender 5.2 LTS（通常インストール版。`BLENDER` 環境変数か `--blender` で指定可）
- Coding Agent から Blender を触るなら [blender-mcp](https://github.com/ahujasid/blender-mcp) アドオン（`uvx blender-mcp install-addon` → Blender で有効化 → N パネル "MCP for Blender" → Connect）。`.mcp.json` に設定済み

## セットアップ

```bash
bun install
cp .env.example .env    # TRIPO_API_KEY を入れる
bun run codegen         # ComfyUI 起動中に。src/types/nodes.ts を生成
bun test
```

## 使い方

```bash
bun run c3d concept example                     # 候補 4 枚 → out/chars/example/concept/
bun run c3d concept example --model anima       # アニメ調（タグプロンプト）
bun run c3d views   example                     # 最新の候補から back/left/right → out/chars/example/views/
bun run c3d views   example --hero out/chars/example/concept/example_00002_.png --seed 1
bun run c3d model   example --balance           # Tripo: multiview → model.glb（残高表示付き）
bun run c3d model   example --animate           # + rig-check → rig → idle/walk/run の GLB
bun run c3d model   example --fbx               # + Blender 手直し用 FBX
bun run c3d render  example [--only walk] [--elev 30] [--size 512] [--dirs 8|5] [--light camera|world]
bun run c3d sheet   example --size 128          # out/chars/example/sheet/example.png + .json
bun run c3d sheet   example --pass normal       # 法線マップ版シート（2D エンジンの動的ライティング用）
```

すべて `--dry` でグラフ / 引数だけ表示（ComfyUI ステージ）。各ステージは前ステージの `out/` を読み、単体で再実行できる。

### キャラ定義 `chars/<name>.yaml`

```yaml
name: example
positive: |            # デザイン。構図（全身・A-pose・白背景）は concept が付ける
  a young wasteland scavenger, goggles on the forehead, olive jacket, ...
negative: blurry, text, weapon
style: stylized 3D game character, clean cel shading, flat colours
height: 1.7            # m。Blender のカメラ枠に使う
tripo: {}              # Tripo パラメータの上書き（face_limit, quad, texture_quality ...）
```

### 出力

```
out/chars/<name>/
  concept/*.png              候補
  views/{front,back,left,right}.png   1024² 白背景、Tripo 入力
  model/model.glb            Tripo 生成物（preview.webp, rigged.glb, model.fbx, tasks.json）
  model/anim/<motion>.glb    プリセットアニメ付きモデル（render の入力）
  render/<motion>/<dir>/<k>.png, <k>.normal.png, meta.json
  sheet/<name>.png, <name>.json
```

## 手直し（Blender）

Tripo → Blender の手作業（リトポ、UV、ウェイト修正、Rigify/Auto-Rig Pro での組み直し）は `docs/research/tripo-quality-tips.md` §5 の手順。MCP 経由でエージェントに頼む場合は Blender GUI を起動してアドオンの Connect を押してから。バッチ処理は `scripts/blender/*.py` を `src/lib/blender.ts` から headless 実行する（再現性のため）。

手直し後のモデルを再度 Tripo に通す必要はない。`out/chars/<name>/model/anim/<motion>.glb` を差し替えれば `c3d render` はそれをそのまま描く（Blender で Mixamo/Quaternius のクリップをリターゲットして GLB で書き出しても同じ）。

## 開発

```bash
bun run check   # oxfmt → oxlint → tsc
bun test
```

構成:

```
src/
  c3d.ts             サブコマンド dispatcher
  motions.ts         モーション一覧（Tripo preset 名、フレーム数、fps）
  lib/
    cli.ts           argv ヘルパ
    comfy.ts         ComfyUI 接続・実行・出力回収（@saintno/comfyui-sdk）
    qwen-edit.ts     Qwen-Image-Edit 2511 グラフ + RMBG マット
    tripo.ts         Tripo API v3 薄いラッパ（@vastai/tripo-sdk）
    blender.ts       Blender headless 起動
    chars.ts         chars/*.yaml
    paths.ts         out/ の規約
  stages/            concept / views / model / render / sheet
  types/nodes.ts     codegen 生成物
scripts/blender/render_sprites.py   8 方向レンダ（EEVEE、color + camera-space normal）
chars/               キャラ定義
docs/research/       調査
```
