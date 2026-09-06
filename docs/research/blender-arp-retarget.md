# Auto-Rig Pro でリグ → Mixamo / Quaternius をリターゲット

調査日: 2026-09-07。Tripo のオートリグを使わず、Blender ローカルでリグ・スキニング・リターゲットを完結させる経路の手順と実装メモ。

Tripo のリグを捨てた理由は §5。結論だけ言うと、**最終出力がスプライト PNG なのでボーン命名規約はどうでもいい**。Blender の中でリターゲットが通ればよく、そのための道具は既に手元にある。

## 1. 前提

インストール済みを確認（`%APPDATA%/Blender Foundation/Blender/5.2/extensions/superhivemarket_com/`）:

| アドオン | バージョン | 役割 |
|---|---|---|
| `auto_rig_pro` | 3.78.49 | Smart（リグ生成）/ Bind（スキニング）/ **Remap（リターゲット）** |
| `auto_rig_pro_quick_rig` | — | Quick Rig |
| `ARP_rig_tools` | — | リグ操作ユーティリティ |
| `voxel_skinning` | — | Voxel Heat Diffuse Skinning |

ARP の `blender_manifest.toml` は `blender_version_min = "2.8.0"` で上限なし。5.2 で動く前提。

モーション素材は `motions/` に置く（`motions/**/*.fbx` は gitignore、README のみコミット）。

## 2. 手作業（キャラ 1 体につき 1 回）

`c3d model <char>` が出した `out/chars/<char>/model/model.glb` から始める。

1. **向きを揃える。** Tripo の出力は **+X が正面**。Blender で import したあと Z 軸まわりに回して **-Y 正面**にし、`Object > Apply > Rotation` で確定する。これをやっておくと後段が全部デフォルト設定で通る（`c3d render` の `--facing` が `-y` 既定）。
2. **ARP Smart。** `Auto-Rig Pro` タブ → `Smart` → `Get Selected Objects` → 顎・首・胸・肩・手首・足首・膝のマーカーを配置 → `Go!`。
   フード付き・ガスマスクのキャラは顎と首の自動検出が外れやすい。マーカーは目視で直す。
3. **`Match to Rig`** でリグを生成。
4. **スキニング。** メッシュ → リグの順に選択して `Bind`。ARP の Voxelize バインドで足りなければ Voxel Heat Diffuse Skinning を使う。フードや装備が重なった箇所のウェイトが破綻していないか、腕を上げて確認する。
5. `out/chars/<char>/rig.blend` として保存。

以降の工程はこの `.blend` を入力に headless で回る。

## 3. 自動（`c3d retarget`）

```bash
bun run c3d retarget scavenger --dry-run   # ボーン対応だけ作って、外れたボーンを報告
bun run c3d retarget scavenger             # ベイクして anim/<id>.glb を書く
bun run c3d render scavenger               # 既存のまま
bun run c3d sheet scavenger --size 128
```

`src/motions.ts` の `MOTIONS` が入力。`fbx` / `action` / `preset` を持つエントリだけが対象。

- `scripts/blender/retarget.py` が ARP Remap の operator を順に叩く
- 出力は `out/chars/<char>/model/anim/<id>.glb`（メッシュ + アーマチュア + 1 クリップ）。**`render_sprites.py` は無改修**で読める
- FBX は 1 ファイルにつき 1 回だけ import する（Quaternius UAL は 1 ファイルに 45 クリップ入っていて、毎回読み直すと遅い）

**必ず `--dry-run` を先に通すこと。** 対応が取れていないプリセットでも黙ってベイクは成功する。脚が丸ごと落ちていても気付けるのは dry-run のログだけ。

## 4. ARP Remap の実装メモ

`auto_rig_pro/src/auto_rig_remap.py` を読んで確認した事実。

### 同梱プリセット（`auto_rig_pro/remap_presets/`）

`mixamo_fk` / `mixamo_ik` / `mixamo_fbx_ik` / `unreal_mannequin_remap` / `rigify` / `daz` / `rokoko_*` / `mocopi` / `xsens` ほか。

- **Mixamo → `mixamo_fk`**。スプライト用途で IK 版を選ぶ理由はない。IK 極の破綻リスクが増えるだけ
- **Quaternius UAL → `unreal_mannequin_remap` が出発点**。UAL のボーン名は UE Manny 系（`pelvis` / `spine_01` / `thigh_l` / `calf_l` / `clavicle_l` / `upperarm_l`）で同系統

### 名前マッチの挙動（`_import_config`、L4578）

```python
prefix = scn.remap_source_nodes[0].source_name.split(":")[0]
...
if src_name == preset_source_bone_name:      # 完全一致
elif src_name == prefix + ":" + base_name:   # プレフィックス付きで再試行
```

- **プレフィックスはソースアーマチュアの実物から自動検出される。** `.bmap` に `Hips` と書いてあれば `mixamorig:Hips` にも当たる。手で書き換える必要はない
- **大文字小文字は区別する。** UAL の `Head`（`motions/quaternius/README.md` 記載）と `unreal_mannequin_remap.bmap` の `head` は当たらない。dry-run で unmapped として出る
- 外れた分は ARP の Remap パネルで手で当ててから `arp.remap_export_preset` で `.bmap` に書き出し、`MOTIONS` の `preset` をそのパスに向ける（例: `motions/quaternius/ual.bmap`）
- `scn.search_and_replace` / `scn.name_search` / `scn.name_replace` で一括置換もできる

### operator の呼び出し順

```python
src.animation_data.action = act       # 先にアクションを載せる
scn.target_rig = target.name
scn.source_rig = src.name             # ← この代入が update handler を叩き、
                                      #    アクション名とスロットを scn.source_action に写す
bpy.context.view_layer.objects.active = target
bpy.ops.arp.build_bones_list()
bpy.ops.arp.import_config('EXEC_DEFAULT', filepath=preset, clear_current=True)
bpy.ops.arp.auto_scale()
bpy.ops.arp.retarget('EXEC_DEFAULT', frame_start=s, frame_end=e)
```

- `scn.source_rig` への代入は**アクションを載せた後**。順序を逆にすると `source_action` が空のまま `build_bones_list` の `poll` が落ちる
- Blender 4.4+ はアクションスロットがあるので、`save_source_action()` が `"<action>[%%%]<slot>"` を組み立てる。自前で `scn.source_action` を文字列で作らず、rig にアクションを載せて ARP に書かせるほうが安全
- `arp.build_bones_list` は `poll` で `active_object != None` かつ `source_action` / `source_rig` / `target_rig` が全部埋まっていることを要求する

## 5. Blender MCP から叩く場合

`mcp__blender__execute_blender_code` は GUI Blender 内で任意の Python を実行するので、`bpy.ops.arp.*` をそのまま呼べる。アドオン側で "Start MCP Server"（port 9876）を押しておくこと。

**ポップアップを開く operator は `'EXEC_DEFAULT'` を付けて `invoke()` を飛ばす。** 付けないと応答されないダイアログでブロックする:

- `arp.import_config_preset` / `arp.import_config` → `invoke_props_dialog`
- `arp.batch_retarget` → `invoke_popup`（そもそも呼ぶ必要がない。ダイアログを描くだけの operator で、`execute()` は何もしない）

ARP Smart のマーカー配置は目視判断なので MCP に投げる意味はない。手でやる。

## 6. Tripo のリグを使わない理由

`spec: "mixamo"` を送ってもサーバは受理するだけで、rig `v2.5-20260210` の出力は:

```
tripo::Root, tripo::Spine_0, tripo::Head_0,
tripo::0_Right_Limb_0 … tripo::1_Left_Limb_2,
bone_7 … bone_22（無名 18 本）  計 32 本
```

- 公式の[バージョン説明](https://developers.tripo3d.ai/en/models/rig)では `v1.0-20240301` = "Biped only, recommended for humanoids"、`v2.5-20260210` = "Non-humanoid creatures"
- `0_Right_Limb_0` / `1_Left_Limb_2` は**体型非依存の「N 番目の肢」命名**。人型前提の `mixamorig:LeftForeArm` に写像しようがない → `mixamo` spec が実質無視される
- `v1.0-20240301`（biped 専用の旧世代）なら mixamo 命名になる可能性はあるが未検証。25 credits

いずれにせよ ARP でリグを作るなら Tripo のリグ 25 credits は丸ごと不要。生成は `--faces 20000 --low-poly` の 50 credits で終わる。

## 7. 落とし穴

- **`motions/**/*.fbx` は gitignore。** クローン直後は `MOTIONS` のカタログはあるが実ファイルが無い。入手手順は `motions/mixamo/README.md` と `motions/quaternius/README.md`
- **ベイク済みアクションは `.blend` に溜まる。** GLB 書き出しは `export_animation_mode="ACTIVE_ACTIONS"` を使う。`"ACTIONS"` にすると全クリップが全ファイルに入る
- **Tripo GLB は +X 正面。** §2-1 で -Y に直しておかないと `c3d render --facing +x` が必要になり、`c3d retarget` を挟んだ後は何が正面か分からなくなる
- **Mixamo の DL 設定**は Skin = "Without Skin"、FBX Binary、30 fps（`motions/mixamo/README.md`）

## 出典

- [Tripo Rigging (models/rig)](https://developers.tripo3d.ai/en/models/rig)
- [Tripo Auto Rig API](https://developers.tripo3d.ai/en/docs/animations-rig)
- [Auto-Rig Pro 公式ドキュメント](https://www.lucky3d.fr/auto-rig-pro/doc/)
- `auto_rig_pro/src/auto_rig_remap.py`（ローカル、3.78.49）
