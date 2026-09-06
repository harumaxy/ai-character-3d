# ai-character-3d

AI でゲームキャラクターを **3D 経由**で作り、トップビュー 8 方向スプライトに落とすワークフロー。研究目的。

```
ComfyUI (ローカル)             Tripo AI (API v3)      Blender 5.2 + Auto-Rig Pro
 concept: 正面 A-pose 候補  →  model: multiview → 3D  →  リグ・スキニング（手作業）
 views:   back/left/right 派生                           retarget: motions/ を焼く
                                                         render:   8 方向 × フレーム PNG
                                                         sheet:    スプライトシート + JSON
```

Tripo に投げるのは**メッシュ生成だけ**。リグとアニメは Blender + Auto-Rig Pro でやる（理由は
[`blender-arp-retarget.md`](docs/research/blender-arp-retarget.md) §6）。入力の 4 面図もローカル
ComfyUI で作るので、Tripo の image-to-multiview は使わない。

背景: `../pixel-2d-game-art` の SD1.5 + AnimateDiff 直接生成は walk/run 以外で破綻した。3D 化してからレンダーすれば、姿勢・方向・フレーム間の一貫性は幾何で担保される（Donkey Kong Country / Dead Cells 方式）。調査は `docs/research/`:

- [`tripo-ai.md`](docs/research/tripo-ai.md) — 料金・API v3・SDK・利用規約
- [`tripo-quality-tips.md`](docs/research/tripo-quality-tips.md) — 入力画像とパラメータのコツ、Blender 後処理
- [`comfyui-charsheet.md`](docs/research/comfyui-charsheet.md) — 正面画とマルチビューの作り方
- [`blender-mcp-and-sprite-render.md`](docs/research/blender-mcp-and-sprite-render.md) — Blender MCP と 8 方向レンダの設計
- [`blender-arp-retarget.md`](docs/research/blender-arp-retarget.md) — Auto-Rig Pro でのリグとリターゲット

## 必要なもの

- [Bun](https://bun.sh)（`mise install`）
- ComfyUI 起動中（既定 `http://127.0.0.1:8188`、`COMFY_URL` で変更）。モデル: FLUX.2 klein 9B fp8 / Anima / Qwen-Image-Edit 2511 GGUF Q5_0 + Lightning 4step LoRA / RMBG-2.0。任意で fal Multiple-Angles LoRA（`loras/qwen/`、`views` が自動検出）
- Tripo API キー（`.env` の `TRIPO_API_KEY`、https://platform.tripo3d.ai/api-keys）。API は従量制、1 credit = $0.01、**1 キャラ 50 credits**（multiview 40 + `--low-poly` 10）。リグとアニメを Tripo に投げないので、以前の 100〜130 credits から下がった
- Blender 5.2 LTS（通常インストール版。`BLENDER` 環境変数か `--blender` で指定可）
- [Auto-Rig Pro](https://superhivemarket.com/products/auto-rig-pro)（有償）。Smart でリグ生成、Bind でスキニング、**Remap でリターゲット**。`c3d retarget` が Remap の operator を叩く
- 任意: [Voxel Heat Diffuse Skinning](https://superhivemarket.com/products/voxel-heat-diffuse-skinning)（有償）。ARP の Bind でウェイトが破綻する箇所の代替
- モーション素材を `motions/mixamo/` `motions/quaternius/` に置く。FBX は gitignore なので入手手順は各ディレクトリの README
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
bun run c3d model   example --faces 20000 --low-poly   # Tripo: multiview → model.glb（50 credits）
#                                                 ここで Blender + Auto-Rig Pro の手作業（下の節）
bun run c3d retarget example --dry-run          # ボーン対応だけ作って、外れたボーンを報告
bun run c3d retarget example [--only walk]      # motions/ のクリップを焼いて model/anim/<id>.glb
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
  model/model.glb            Tripo 生成物（preview.webp, tasks.json）
  rig.blend                  ARP でリグ・スキニング済み（手作業、retarget の入力）
  model/anim/<motion>.glb    リターゲット済みモデル（render の入力）
  render/<motion>/<dir>/<k>.png, <k>.normal.png, meta.json
  sheet/<name>.png, <name>.json
```

## リグとリターゲット（Blender + Auto-Rig Pro）

Tripo が出すのはメッシュだけ。ここから先はローカルで完結する。

**なぜ Tripo のリグを使わないか。** rig `v2.5-20260210` は体型非依存の汎用スケルトンで、ボーン名が
`tripo::0_Right_Limb_0` のような「N 番目の肢」になる。`spec: "mixamo"` を送ってもサーバは受理するだけで
命名は変わらない。そもそも最終出力がスプライト PNG なので、Blender の中でリターゲットが通れば
ボーン命名規約は無関係。詳細は [`blender-arp-retarget.md`](docs/research/blender-arp-retarget.md) §6。

### 手作業（キャラ 1 体につき 1 回）

1. `out/chars/<name>/model/model.glb` を Blender に import（GLB のままでいい。FBX 変換は不要）
2. **Z 軸で回して -Y 正面にし、`Object > Apply > Rotation`。** Tripo の出力は +X 正面。ここで直して
   おかないと後段が全部デフォルト設定から外れる
3. ARP `Smart` → マーカー配置 → `Match to Rig`。フードやヘルメットのあるキャラは顎・首の自動検出が
   外れやすいので目視で直す
4. メッシュ → リグの順に選択して `Bind`。ARP の Voxelize で足りなければ Voxel Heat Diffuse Skinning。
   腕を上げて脇のウェイトが胴に滲んでいないか確認する
5. `out/chars/<name>/rig.blend` として保存

MCP 経由でエージェントに触らせる場合は Blender GUI を起動してアドオンの Connect を押してから。
`execute_blender_code` から `bpy.ops.arp.*` を呼べるが、ダイアログを開く operator には
`'EXEC_DEFAULT'` が要る（同 §5）。

### 自動

```bash
bun run c3d retarget <name> --dry-run   # 先にこれ。対応の取れていないボーンを報告する
bun run c3d retarget <name>             # ベイクして model/anim/<id>.glb を書く
```

対象は `src/motions.ts` の `MOTIONS` のうち `fbx` / `preset` を持つエントリ。Mixamo は ARP 同梱の
`mixamo_fk`、Quaternius UAL は `unreal_mannequin_remap` を出発点にする。プレフィックス
（`mixamorig:`）は ARP がソースアーマチュアから自動検出するので手で書く必要はないが、
大文字小文字は区別される。ズレた分は ARP の Remap パネルで直して `.bmap` に書き出し、
`MOTIONS` の `preset` をそのパスに向ける。

リターゲットを自前でやるなら `model/anim/<motion>.glb` を差し替えるだけでいい。`c3d render` は
「メッシュ + アーマチュア + 1 クリップ」のファイルなら中身の出所を問わない。

## 開発

```bash
bun run check   # oxfmt → oxlint → tsc
bun test
```

構成:

```
src/
  c3d.ts             サブコマンド dispatcher
  motions.ts         モーション一覧（ソース FBX / アクション / ARP プリセット、フレーム数、fps）
  lib/
    cli.ts           argv ヘルパ
    comfy.ts         ComfyUI 接続・実行・出力回収（@saintno/comfyui-sdk）
    qwen-edit.ts     Qwen-Image-Edit 2511 グラフ + RMBG マット
    tripo.ts         Tripo API v3 薄いラッパ（@vastai/tripo-sdk）
    blender.ts       Blender headless 起動
    chars.ts         chars/*.yaml
    paths.ts         out/ の規約
  stages/            concept / views / model / retarget / render / sheet
  types/nodes.ts     codegen 生成物
scripts/blender/
  retarget.py        ARP Remap を叩いて 1 モーション 1 GLB に焼く
  render_sprites.py  8 方向レンダ（EEVEE、color + camera-space normal）
chars/               キャラ定義
motions/             Mixamo / Quaternius の FBX（gitignore、README のみ追跡）
docs/research/       調査
```
