# Auto-Rig Pro でリグ → Mixamo / Quaternius をリターゲット

調査日: 2026-09-07。Tripo のオートリグを使わず、Blender ローカルでリグ・スキニング・リターゲットを完結させる経路の手順と実装メモ。

Tripo のリグを捨てた理由は §6。結論だけ言うと、**最終出力がスプライト PNG なのでボーン命名規約はどうでもいい**。Blender の中でリターゲットが通ればよく、そのための道具は既に手元にある。

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

1. **向きとスケールを揃えて Apply する。** Tripo の出力は **+X 正面・身長 1.0 単位**（正規化されている）。
   Z 軸まわりに **-90°** 回して -Y 正面にし、`chars/<name>.yaml` の `height` に合わせて拡大してから
   `Object > Apply > Rotation & Scale`。ついでに足が z=0 に乗るよう移動して Location も Apply する。

   `scripts/blender/orient_model.py` がやる。GLB を読んで整えた `.blend` を吐くところまで headless:

   ```bash
   "C:/Program Files/Blender Foundation/Blender 5.2/blender.exe" --background \
       --python scripts/blender/orient_model.py -- \
       --model out/chars/scavenger/model/model.glb --height 1.7 \
       --blend out/chars/scavenger/rig.blend
   ```

   起動済みの Blender の中（Text Editor / MCP）でアクティブオブジェクトに掛けるなら
   `--model` を省いて `-- --height 1.7`。

   回転量は bbox から決める。**水平方向で広いほうが肩幅**なので、Y のほうが広ければ ±X 正面 →
   -90° 回す。X のほうが広ければ既に ±Y 正面なので何もしない（再実行しても壊れない）。
   Tripo は +X 正面だが、背中が正面に来たら `--yaw 90` で逆に回す。

   確認 1: 出力の `dimensions` が **X = 肩幅、Y = 厚み**になっていること。
   確認 2: **Numpad 1（Front）で顔が見えること**。背中なら `--yaw 90` でやり直す。

   実測 (scavenger, 2026-09-07): `(0.2329, 0.4951, 1.0)` → `(0.8417, 0.3959, 1.7)`、
   `location (0,0,0)`、`scale (1,1,1)`、足 z=0 / 頭 z=1.7。

   なぜやるか:
   - **リターゲットは world 空間の回転をコピーする。** Mixamo FBX は import 後 -Y 正面。ターゲットの
     レストポーズが +X のままだと 90° ずれた状態でベイクされ、`Redefine Rest Pose` で補正する羽目になる
   - **Mixamo / UAL のクリップは実寸の人体で作られている。** ARP `auto_scale` はソース側を
     ターゲットに合わせて縮めるので、ターゲットが 1.0 単位のままだと歩幅も 1.0 単位系になる
   - **`c3d render` は `chars/<name>.yaml` の `height` を `--height` に渡し、`ortho_scale = height * margin`
     を決める。** モデルが 1.0 単位のままだと 1.7 m 相当の枠に 1.0 m の被写体が写り、キャラが小さくなる
   - ARP は未適用のオブジェクト変換で壊れる（`arp.freeze_armature` operator が存在する理由）
2. **ARP Smart。** `Auto-Rig Pro` タブ → `Smart` → `Get Selected Objects` → 顎・首・胸・肩・手首・足首・膝のマーカーを配置 → `Go!`。
   フード付き・ガスマスクのキャラは顎と首の自動検出が外れやすい。マーカーは目視で直す。
3. **`Match to Rig`** でリグを生成。
4. **スキニング。** メッシュ → リグの順に選択して `Bind`。エンジンの選び方は §8。
5. `out/chars/<char>/rig.blend` として保存。**Bind が通ったら真っ先に保存する。**
6. 検証: `blender --background out/chars/<char>/rig.blend --python scripts/blender/check_bind.py`
   腕↔胴の最小隙間と、腕ボーンのウェイトが漏れた非腕頂点の割合を出す。

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
- 出力は `out/chars/<char>/anim.blend` 1 個。`rig.blend` にモーションごとの名前付きアクションを
  ベイクして保存する。`render_sprites.py` はそれを開いてアクションを差し替えるだけ
- FBX は 1 ファイルにつき 1 回だけ import する（Quaternius UAL は 1 ファイルに 45 クリップ入っていて、毎回読み直すと遅い）
- **中間の GLB は書かない。** 1 モーション 1 GLB にすると 27k tri のメッシュとテクスチャが本数分
  複製され（実測 5 本で 25MB、anim.blend なら 21MB）、さらに書き出し→読み直しの往復で
  glTF importer の不可視オブジェクトが混入する（§7）。ゲームエンジン向けの書き出しは
  Auto-Rig Pro の Export タブの仕事で、このスクリプトの守備範囲ではない

**必ず `--dry-run` を先に通すこと。** 対応が取れていないプリセットでも黙ってベイクは成功する。脚が丸ごと落ちていても気付けるのは dry-run のログだけ。

## 4. ARP Remap の実装メモ

`auto_rig_pro/src/auto_rig_remap.py` を読んで確認した事実。

### 同梱プリセット（`auto_rig_pro/remap_presets/`）

`mixamo_fk` / `mixamo_ik` / `mixamo_fbx_ik` / `unreal_mannequin_remap` / `rigify` / `daz` / `rokoko_*` / `mocopi` / `xsens` ほか。

- **Mixamo → `mixamo_fbx_ik`**。`mixamo_fk` / `mixamo_ik` は脊椎 2 本の旧世代。下の「同梱 Mixamo プリセットは 2 世代ある」参照
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

### 同梱 Mixamo プリセットは 2 世代ある

| プリセット | ソース名 | 脊椎 | 足 |
|---|---|---|---|
| `mixamo_fk` / `mixamo_ik` | `Hips`（プレフィックス無し） | **2 本** | FK / IK |
| `mixamo_fbx_ik` | `mixamorig:Hips`（フルネーム） | **3 本** | IK + 膝ポール |

**`mixamo_fbx_ik` を使う。** 旧世代は脊椎 2 本 前提 → Mixamo の `Spine` が落ち、`c_spine_03.x`
無アニメ。胴の曲げ 1 段 消失。dry-run に `mixamorig:Spine` が unmapped で出る。

ARP 自身の脊椎デフォルトは 3 本（`auto_rig.py:1299` `spine_count: IntProperty(default=3)`）。
つまり **旧世代プリセットは ARP 自身のデフォルトリグと噛み合わない**。名前が `fk`/`ik` としか
違わないので世代差に気付けない。ここが唯一の実質的な罠。

`mixamo_fbx_ik` は unmapped ゼロ。`LeftEye`/`RightEye` の ERROR 報告も出ない。
専用 `.bmap` を手作りする必要は無い。

足が IK になる（`c_foot_ik.l` + `c_leg_pole.l`）。ARP 公式は歩行・走行では IK を推奨（FK は
足が滑る）。ベイク時に `Warning: Straight IK chain (c_foot_ik.l), adding offset` が出るが、
リグのレストポーズで膝が伸びきっているため ARP が自動でオフセットを入れただけ。

FK 版（脊椎を手で直した `mixamo_fk`）との実測差（左手位置・身長比）:

- walk: ソース `[+19 +12 -9]` / FK `[+20 +14 -17]` / **fbx_ik `[+20 +14 -17]`**
- sneak: ソース `[-49 +2 +17]` / FK `[-56 -5 +11]` / **fbx_ik `[-52 -5 +11]`**

同等。sneak は fbx_ik のほうが僅かにソースに近い。

### Redefine Rest Pose は腕だけに掛ける

`align_rest_pose()` = パネルの `Redefine Rest Pose` → `Copy Selected Bones Rotation` → `Apply`。
Mixamo は T ポーズ、ARP リグ（Tripo の A ポーズ由来）は腕が下がる。差 約 65 度。
補正しないと腕が全フレーム 誤る（実測: walk の左手が身長比 `[x+23 y-8 z-7]` のところ
`[x-18 y0 z+2]` で全フレーム 固着）。

**選ぶのは腕だけ** — `c_shoulder.` / `c_arm_fk.` / `c_forearm_fk.` / `c_hand_fk.`。
ARP 公式も "select misaligned bones (typically arms/legs)"。全 52 本 選ぶと胴の傾きがずれる。
頭の前傾 `(head.y - root.x.y) / 身長` の実測:

- walk: ソース -2% / 腕のみ -2% / 全ボーン **+4%**
- sneak: ソース +27% / 腕のみ +27% / 全ボーン **+20%**

（`mixamo_fk` を脊椎修正した版での計測。`mixamo_fbx_ik` でも同じ傾向）

指は除外。既に揃っていて、スプライト解像度では見えない。

operator 順は `auto_scale` → `redefine_rest_pose` → `retarget`。ARP 公式・実践記事とも この順。

`preserve` で Apply の operator が変わる（パネル `auto_rig_remap.py:5177`）:

```
preserve=True  -> arp.save_pose_rest
preserve=False -> arp.copy_raw_coordinates   # ソースを複製してベイクし直す。遅い
```

preserve=True 経路は **マップ済み全ボーン** のレスト差を再計算して remap ボーンに適用する
（`auto_rig_remap.py:3642`、`mat_rest_diff`）。選択を腕に絞っても他ボーンが無傷なわけではない。
両経路をベイクして比べたが出力は同一。速い preserve=True を使う。

### 検証は目視でなく数値

前傾クリップ（Mixamo `crouched sneaking`、UAL `Jump_Start`）は elev 30 のスプライトで見ると
「上半身が倒れて壊れている」ように見える。**ソースが実際にそう動いている**。
Jump_Start は手が身長の 73% 横に出るモーション。目視だけで判断すると正しい出力を壊れと誤判定する。

判定はソース FBX を import して同じ量を測り、ベイク結果と比べる:

- 身長 = `head.z - foot.l.z`
- 前傾 = `(head.y - root.x.y) / 身長`
- 腕 = `(hand.l - root.x) / 身長`

ソース側のボーン名は Mixamo が `mixamorig:Hips/Head/LeftFoot/LeftHand`、UAL が
`pelvis/Head/foot_l/hand_l`。ターゲット側は deform ボーン `root.x/head.x/foot.l/hand.l`。

## 5. Blender MCP から叩く場合

`mcp__blender__execute_blender_code` は GUI Blender 内で任意の Python を実行するので、`bpy.ops.arp.*` をそのまま呼べる。アドオン側で "Start MCP Server"（port 9876）を押しておくこと。

**ポップアップを開く operator は `'EXEC_DEFAULT'` を付けて `invoke()` を飛ばす。** 付けないと応答されないダイアログでブロックする:

- `arp.import_config_preset` / `arp.import_config` → `invoke_props_dialog`
- `arp.batch_retarget` → `invoke_popup`（そもそも呼ぶ必要がない。ダイアログを描くだけの operator で、`execute()` は何もしない）

ARP Smart のマーカー配置は目視判断なので MCP に投げる意味はない。手でやる。

**`execute_blender_code` は Blender のメインスレッドで走る。数秒を超える処理を投げるな。**
UI ごとフリーズし、120 秒でソケットが切れる。実際に 32k 頂点 × 68 ボーンの総当たり
（220 万回の線分距離）を投げて Blender を落とし、保存していなかったリグを失った (2026-09-07)。

- 重い計測・バッチは `blender --background --python <script>` で別プロセスに出す
- 総当たりを書く前に `mathutils.kdtree.KDTree` を使う。同じ計測が 1.5 秒で終わる
  （`scripts/blender/check_bind.py`）
- **Smart と Bind が通ったら、まず `rig.blend` を保存する。** やり直しが一番高い

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
- **ベイク済みアクションは誰からも参照されないと保存時に消える。** `use_fake_user = True` を立てる
- **glTF importer はボーン表示用の不可視 Icosphere（半径 1）を作り、`glTF_not_exported` コレクションに
  入れる。** 344 本のボーンのカスタムシェイプとして使われる実体のあるメッシュなので、素朴に
  「import して MESH を全部集める」と bbox が 2m の球になり、カメラが体ではなく球に合う。
  GLB 経由をやめたので現在は踏まないが、GLB を読む処理を足すときは必ず除外すること
- **glTF importer は `rotation_mode` を `QUATERNION` にする。** `o.rotation_euler = (...)` はエラーも
  警告も出さずに無視される。location と scale は別プロパティなので効いてしまい、「スケールと位置は
  直ったのに向きだけ変わらない」という分かりにくい壊れ方をする。`matrix_world` を組むか、先に
  `o.rotation_mode = 'XYZ'` を入れる
- **Tripo GLB は +X 正面・身長 1.0 単位に正規化されている。** 実測 (scavenger): glTF bbox が
  X 0.233 / Y 1.000 / Z 0.495 で、Blender import 後は X 0.233（薄い）/ Y 0.495（肩幅）/ Z 1.000（身長）。
  肩幅が Y に伸びている＝ ±X を向いている。§2-1 で回転とスケールを直しておくこと
- **Mixamo の DL 設定**は Skin = "Without Skin"、FBX Binary、30 fps（`motions/mixamo/README.md`）
- **`motions/quaternius/ual.bmap` は同梱 `unreal_mannequin_remap` のタイポを引き継いでいる。**
  `index_03_r` と `middle_02_r` の target が `.l`（右指が左指へ）。スプライトでは見えないが、
  指を使うなら直す
- **ual.bmap は足を IK にマップする**（`foot_l -> c_foot_ik.l`、`ball_l -> c_toes_ik.l`）。
  mixamo 側は全 FK。`src/motions.ts` の「FK maps, not IK」は Mixamo だけの話

## 8. バインドエンジンの選び方 — 腕が胴に溶ける問題

Tripo の A ポーズは手が腰のすぐ横に垂れる。scavenger の実測 (2026-09-07):

| 帯 | 腕↔胴 表面の最小隙間 |
|---|---|
| 胴 z1.15–1.30 | 4.7 mm |
| **腰 / ポーチ z0.95–1.15** | **3.3 mm** |
| 腿 z0.80–0.95 | 4.7 mm |

ボリューム系のバインドは 1 ボクセルより近いものを溶接する。デフォルト設定では
腰のポーチが手のボーンに引っ張られる。

### `PSEUDO_VOXELS`（ARP 内蔵 "Voxelized"）の上限

`arp_pseudo_voxels_type = '1'` は Remesh SHARP の `octree_depth` に
`arp_pseudo_voxels_resolution`（既定 7、3–12）をそのまま入れる。身長 1.7 m なら:

```
depth  7 -> 13.28 mm   ← 既定。3.3 mm の隙間を余裕で埋める
depth  9 ->  3.32 mm
depth 10 ->  1.66 mm
```

ただし `auto_rig.py:21093-21110` にリメッシュ後の縮小ループがある:

```python
dist_threshold = (larger_dim / larger_scale) / 1000   # 1.7 m / 1000 = 1.7 mm
while len(voxelized_object.data.polygons) > 70000 and while_counter < 40:
    bpy.ops.mesh.remove_doubles(threshold=dist_threshold)
    ...
    dist_fac = 1.3        # パスごとに閾値が 1.3 倍
```

解像度を上げるとリメッシュ出力が肥大 → ループに入る → 閾値が 1.7 → 2.2 → 2.9 → 3.8 mm と育ち、
`remove_doubles` は連結性に関係なく閾値内の頂点を溶接するので、分離したはずの隙間がまた塞がる。
**解像度を上げるだけでは打ち消されうる。**

`type = '2'` はさらに狭い。`voxel_size = ((dim/scale)*0.003) / (res/8)` なので:

```
res 7 (内部で 6 に) -> 6.80 mm
res 9 (内部で 10 に) -> 4.08 mm
res 12              -> 3.40 mm   ← 最大解像度でも 3.3 mm を切れない
```

**type 2 では原理的にこのポーチを分離できない。**

### 選択肢（安い順）

1. **`HEAT_MAP`**（"Heat Maps"）。サーフェス法なので空隙を越えて滲むことが原理的にない。
   ARP 自身の説明は「重ね着や小物で不整合になりうる」。フード付きキャラでは別の場所が
   崩れる可能性があるが、腕↔胴のリークは確実に消える。まずこれを試すのが安い。
2. **`VHDS`**（Voxel Heat Diffuse Skinning アドオン）。`scn.voxel_resolution` は既定 128・最大 1024。
   身長 1.7 m なら 128 → 13.3 mm、512 → 3.3 mm、**1024 → 1.66 mm**。C 実装で縮小ループが無いので
   上げた解像度がそのまま効く。時間は掛かるが本命。
3. **局所リバインド。** `scn.arp_bind_sel_verts = True` + `scn.arp_bind_selected_bones = True` で、
   ポーチと脇の頂点だけを選び、`spine_01/02/03.x` と `root.x` だけを選んで
   `bpy.ops.arp.bind_to_rig()`。良いウェイトを壊さずに壊れた領域だけ焼き直す。
4. **`PSEUDO_VOXELS` の resolution 9–10。** 1 クリックなので試す価値はあるが、上の縮小ループで
   打ち消される公算。

### 予防

根本原因は手が腰から 3.3 mm しか離れていない A ポーズ。`chars/<name>.yaml` の concept を
T ポーズかもっと開いた A ポーズにすれば数センチの余裕ができ、どのエンジンでも素直に通る。
concept ステージが `full body, A-pose, white background` を自動で付けているので、変えるならそこ。

## 出典

- [Tripo Rigging (models/rig)](https://developers.tripo3d.ai/en/models/rig)
- [Tripo Auto Rig API](https://developers.tripo3d.ai/en/docs/animations-rig)
- [Auto-Rig Pro 公式ドキュメント](https://www.lucky3d.fr/auto-rig-pro/doc/)
- `auto_rig_pro/src/auto_rig_remap.py`（ローカル、3.78.49）
