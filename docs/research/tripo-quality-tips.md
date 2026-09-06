# Tripo AI（tripo3d.ai）で高品質な Image-to-3D / Multiview-to-3D を得るためのベストプラクティス調査

調査日: 2026-09-06
対象: ゲーム用（ローポリ・リグ付き）のスタイライズド／アニメ調キャラクターを、参照画像から Tripo で生成し Blender で仕上げるワークフロー

> **注記（信頼度について）**
> - `[公式]` … Tripo 公式ドキュメント / 公式ブログ / 公式 SDK に記載
> - `[三者]` … 第三者レビュー・ブログ・比較記事
> - `[未確認]` … 出典が一次情報でない、あるいは複数ソースで食い違いがある項目。実際に試して検証すべき
> - tripo3d.ai 本体のチュートリアル/ブログは直接取得が 403 になるため、一部は `r.jina.ai` 経由でテキストのみ取得した。内容は同一ページのもの。

---

## 0. 要点サマリ（先に結論）

1. **入力画像は「正面（または軽い3/4）・全身・A/Tポーズ・無地/透過背景・フラット照明・被写体1体・遮蔽なし」が公式推奨**。アニメ絵は「髪が顔や肩に融合」「帽子が頭に融合」「隠れた目/肌が崩れる」が典型的な失敗。 [公式][三者]
2. **マルチビューは `front, left, back, right` の固定4方向、front 必須、最低2枚**。最も効くのは4枚揃えたとき。2枚（前+後）は「動作はするが最低ライン」で、左右の情報がないぶん側面がボケやすい。 [公式]
3. **モデルバージョンは用途で分ける**: 高精細なら H3.1 (`v3.1-20260211`)、ゲーム用のクリーンなローポリ/クアッドなら P1 (`P1-20260311`) か P2.0 Preview（クアッド 最大 25K / 三角 50K、マルチビュー対応）。 [公式]
4. **自動リグは biped で Mixamo 互換ボーン命名（`spec: mixamo`）を選べる**。UE5 マネキンへのリターゲットが「ほぼ無調整」だった報告があるが、肩の潰れ・顎ウェイトの荒さ・指の弱さは要修正。マント/ゆるい衣服/複数肢は別処理が前提。 [公式][三者]
5. **Blender 側で必ずやること**: Merge by Distance → Delete Loose → Recalculate Normals → 非多様体チェック → 必要ならリトポ（Quad Remesher / Instant Meshes）→ ハイ→ローのベイク（Extrusion 0.05 程度）→ UV 再展開。 [三者]
6. **他ツールとの比較（2026）**: 品質ランキングでは Tripo v3.1 / Meshy 6 / Hunyuan3D 3.x / Rodin Gen-2.x / TRELLIS.2 が拮抗し「どれも万能ではない」。**ローカル（RTX 4080 16GB, ComfyUI）で回せるのは Hunyuan3D-2.x（2.0/2.1）と TRELLIS.2** で、Tripo / Meshy / Rodin / Hunyuan3D 3.x は API/クラウドのみ。 [三者]

---

## 1. Image-to-3D の入力画像ガイドライン

### 1.1 公式が明言している推奨事項

| 項目 | 推奨 | 出典 |
|---|---|---|
| ポーズ | 「全身・立ちポーズ・正面または3/4ビュー」。「極端なアングル、切れた手足、腕組みは AI が隠れた部分を推測することになる」 | [公式] Tripo blog "Why Your AI Anime Character Breaks in 3D" ([tripo3d.ai/blog/tripo-pix-anime-3d-characters](https://www.tripo3d.ai/blog/tripo-pix-anime-3d-characters)) |
| 背景 | 「クリーンな正面向きのキャラクターイラスト/ポートレートが最適」「**透過または単純な背景の PNG** が Tripo によるキャラの分離を助ける」 | [公式] [tripo3d.ai/features/image-to-3d-model/for-3d-character](https://www.tripo3d.ai/features/image-to-3d-model/for-3d-character) |
| 背景（アニメ） | 「ネオン、パーティクル、細かい背景はキャラの髪や服に滲み出す」→ 単純背景・明快なシルエット | [公式] 同上 anime 記事 |
| 解像度 | 「2048x2048 以上の解像度を入力ソースに」（顔や細部の抽出に効く）。JPEG/PNG、API 上限 20MB | [公式] Tripo tutorial "5 Professional Tips" ([tripo3d.ai/tutorials/tripo-ai-image-to-3d-tips](https://www.tripo3d.ai/tutorials/tripo-ai-image-to-3d-tips))、API docs |
| 照明 | 「均一な色温度と明るさを保つ」（マルチビュー時のテクスチャ継ぎ目・色差の主因） | [公式] 同上 tutorial |
| 被写体 | 単一被写体。不要要素はネガティブプロンプト（例: "no glasses, no accessories"）で抑制。v3.1 はネガティブプロンプトで「浮遊パーツ、文字、過剰スムージング」を抑制可能 | [公式] 同上 / [三者] z.tools |
| 遮蔽 | 「長い髪やレイヤード衣装はすでに体を隠しているので、そこに難しいポーズを足すと AI に勝ち目はない」 | [公式] anime 記事 |
| Multiview 前処理 | Image-to-Multiview API の入力注意: 「Subject should be clearly visible against a clean background」 | [公式] [developers.tripo3d.ai/en/docs/generation-image-to-multiview](https://developers.tripo3d.ai/en/docs/generation-image-to-multiview) |
| 自動補正 | `enable_image_autofix: true` で「入力画像を最適化」（デフォルト false）。透過/背景処理が甘い画像で試す価値あり | [公式] [docs.tripo3d.ai image-to-model (H3)](https://docs.tripo3d.ai/model-generation/image-to-model-v3-0-v3-1.html) |

### 1.2 第三者の実践ガイドで一貫している点

- 「単一の主被写体」「エッジがシャープ（モーションブラーなし）」「被写体と背景のコントラスト」「**極端なパース歪みを避ける**」「シルエットが読めること」「うまくいかないなら画像を直せ」「**シンプルな入力ほど強いジオメトリ**」 — [三者] HeyDream Tripo guide ([heydream.im](https://heydream.im/blog/detail/Image-to-3D-on-HeyDream-AI-A-Practical-Tripo-3D-Step-by-Step-Guide-7adc6ef10dae/))
- 「ソフトで均一な光、強い影・白飛びを避ける」「無地・非反射の背景」「被写体を中央に、少し余白」 — [三者] sider.ai guide ([sider.ai](https://sider.ai/blog/ai-tools/how-to-convert-photos-to-3d-models-with-tripo-a-step-by-step-guide))
- 「グロッシーなハイライト/反射はテクスチャ問題の元」「細い部品（ストラップ、指、ワイヤー）は単一画像では失われやすい」 — [三者] HeyDream
- **A ポーズ**（腕を 45° 下げる）が「必須」で、T ポーズや変則ポーズだと苦戦した、という実践報告あり（ただし Tripo 公式は Mixamo 向けに T ポーズ出力を推している。**入力は A ポーズ、出力を T ポーズ**という組み合わせがもっとも安全 [未確認]） — [三者] dev.to hands-on ([dev.to](https://dev.to/abigail_armijo/what-i-learned-exploring-ai-generated-3d-a-hands-on-tour-of-meshy-tripo-and-threejs-5cic))
- 「正面/側面/3/4 の一連の画像を与えると比率が固定される。それでも**左右対称性とボリュームは後工程で直すつもりでいろ**」 — [三者] neural4d cleanup guide ([blog.neural4d.com](https://blog.neural4d.com/user-guide/ai-3d-model-blender-cleanup-complete-mesh-fix-guide-2026/))

### 1.3 スタイル一貫性とテクスチャへの影響

- 公式は「セルシェードのアニメ絵から絵画的なファンタジー設定画まで扱える」と明言 [公式]。ただし実際のテクスチャは **参照画像の陰影がそのまま焼き込まれる**（`texture_alignment: original_image` がデフォルトで「見た目の忠実度を優先」）。セルシェードの影の段差やハイライトが Base Color に残るため、**フラットカラーが欲しければ「影のない・ハイライトのない」入力画像を用意する** のが実質的な対策。 [公式 パラメータ仕様] + [推測: 未確認]
- 日本語レビュー: 「3Dを意識していないイラスト……日本の2D系イラストだと3D化の過程で破綻しやすい」「前髪にかくれた目」「髪に隠れた部分の目や肌の処理に違和感」「金属の反射や布の縫い目といった部分が甘くなる」 — [三者] uzurea.net ([uzurea.net/tripo-ai-3d-generator](https://uzurea.net/tripo-ai-3d-generator/))
- リアル寄りとアニメ寄りを混ぜた画像（例: 写実的な陰影を持つアニメ顔）はスタイルがぶれやすい [未確認・経験則]。

### 1.4 文字・透かし・パース

- 文字/透かし: 公式は v3.1 のネガティブプロンプトで「text」を抑制できると記載 [三者 z.tools]。画像段階で消しておくのが確実。
- パース: HeyDream / neural4d いずれも「極端なパース歪みを避け、平行投影（オーソグラフィック）に近い設定画」を推奨。Tripo の公式失敗モード記事も「正面の設定画だけでは背面は作れない。**オーソグラフィックまたはターンアラウンド参照（front/side/3/4）** を使え」と明言 [公式] ([common-failure-modes](https://www.tripo3d.ai/blog/explore/common-failure-modes-of-ai-3d-generators-and-fixes))。

---

## 2. Multiview-to-3D

### 2.1 仕様（公式 API docs）

出典: [Multiview to model (H3)](https://docs.tripo3d.ai/model-generation/multiview-to-model-v3-0-v3-1.html), [Multiview to model (P1-20260311)](https://docs.tripo3d.ai/model-generation/multiview-to-model-p1-20260311.html), [ComfyUI TripoMultiviewToModelNode](https://docs.comfy.org/built-in-nodes/TripoMultiviewToModelNode)

- `files` は **ちょうど4要素の配列、順序は `[front, left, back, right]` 固定**。`file_token` を空にして特定ビューを省略できるが **front は省略不可**。
- 「**Do not use less than two images to generate.**」→ 最低は front + 1枚。
- JPEG/PNG、最大 20MB。
- 対応バージョン: `v3.1-20260211`, `v3.0-20250812`（H3 系）、`P1-20260311`（P1 系）。P2.0 Preview も Studio 上でマルチビュー入力に対応（front/left/right/back の 4 枚まで） [公式 P2.0 blog]。
- 公式の使い分け: 「H3 は**多角度入力があり、ジオメトリの一貫性を高めたい**とき」「**P1 は多角度入力からクリーンなローポリ＋安定したトポロジが欲しい**とき」。

### 2.2 ビューの整合性要件

**公式ドキュメントには「同スケール・同カメラ高・平行投影」といった数値的な整合要件は書かれていない**（Scenario の Tripo 3.1 Multi View 解説も同様に未記載）[公式/三者 確認済み]。分かっている範囲:

- Tripo のマーケティング文: 「最大4枚の**直交ビュー（orthogonal views）** を受け取り、ビューを整列し、隠れたジオメトリを推定し、**手動整列不要**で一貫した 3D アセットを出力」 [公式 3daistudio/Tripo 説明]
- 公式チュートリアル（写真向け）: 「2〜4枚」「隣接写真間で 30〜60% のオーバーラップ」「均一な色温度・明るさでないとテクスチャ継ぎ目・色差が出る」 [公式 tutorial]。※これは実写の写真撮影向けの記述で、キャラ設定画では「front/left/back/right が同じポーズ・同じ縮尺・同じ照明」と読み替えるのが妥当。
- 公式の「Image to Multiview」エンドポイントは 1 枚から front/left/back/right の 4 枚を生成し、「multiview-to-model の前処理として有用」と明記 [公式]。つまり **Tripo 自身が想定する理想の入力は「同一被写体を 4 方向から見た、ポーズ・スケール・照明が完全に一致した画像セット」**。自作する場合はこれを模倣する（例: ComfyUI で生成した正面画像 → キャラ LoRA / Qwen-Image-Edit 等で背面・側面を作る → 同一解像度・同一余白に揃える）。

### 2.3 不整合なビューを入れるとどうなるか

- 公式ドキュメントに明示的な記述は無い [確認済み]。
- 第三者の観察: 「ビュー間の重なりが少ない（正面↔背面）と参照情報がほぼ効かず、背面はほとんど幻覚になる」（マルチビュー生成の一般論 arXiv）。窓の杜レビュー（旧 v1.4）では 3 方向入力でも「羽で隠れた背中がぽっかり空いていた」 [三者] ([forest.watch.impress.co.jp](https://forest.watch.impress.co.jp/docs/serial/blenderwthing/1633191.html))。Qiita の家具事例では「複数画像からの生成は期待より成果が限定的」 [三者] ([qiita.com/KouuAo](https://qiita.com/KouuAo/items/00847af05f8745438be8))。
- 経験則としてよく言われるのは、**ポーズや衣装ディテールがビュー間で食い違うと、左右非対称・パーツの二重化・テクスチャのにじみが出る**。矛盾するビューを入れるより、front 1 枚で生成した方が良い結果になることもある [未確認・要検証]。

### 2.4 2 枚（front + back）で十分か

- 仕様上は OK（最低 2 枚）。ただし公式は「4 方向すべてを同時に読むことで**全ての面が構造的に一貫**する」と 4 枚を推し、Scenario も「4 枚（front, left, back, right）で完全な構造精度」と記載 [公式/三者]。
- 側面の厚み（鼻・胸・髪のボリューム）は front/back だけでは決まらないので、**キャラでは最低でも front + side（left か right）+ back の 3 枚**を推奨。左右対称キャラなら片側だけでもよい（省略したビューは推定される） [推測]。

### 2.5 Web (Tripo Studio) でのマルチビュー

- Tripo Studio に「Multi-view」入力切替があり、front/left/right/back の最大 4 枚をアップロードできる（v3.0/v3.1、P2.0 Preview）。**複数画像入力は有料プラン機能**（Qiita/unolaboratory の記述） [三者]。
- ComfyUI 公式ノード `TripoMultiviewToModelNode` からも利用可能（API キー必要）。

---

## 3. パラメータのコツ

出典: [Image to model (H3)](https://docs.tripo3d.ai/model-generation/image-to-model-v3-0-v3-1.html), [Multiview (P1)](https://docs.tripo3d.ai/model-generation/multiview-to-model-p1-20260311.html), [Tripo H3.1 model page](https://developers.tripo3d.ai/en/models/v3-1), [tripo-python-sdk API.md](https://github.com/VAST-AI-Research/tripo-python-sdk/blob/master/docs/API.md), [P2.0 Preview blog](https://www.tripo3d.ai/blog/tripo-p2-0-preview)

### 3.1 モデルバージョン

| バージョン | 特徴 | 向く用途 |
|---|---|---|
| `v2.5-20250123` | 旧世代。ドキュメントに残るが H3 系の下位 | 互換用途のみ |
| `v3.0-20250812` (H3.0) | 最大 200 万面、PBR、マルチビュー対応 | 高精細 |
| `v3.1-20260211` (H3.1) | 現行フラッグシップ。「best-in-class geometry and PBR textures」最大 2,000,000 面、text/image/multiview をネイティブ対応、テクスチャ無し約 40 秒・有り約 120 秒。3D Arena 系ランキングで 1 位（ELO 1142, 勝率 71%）という第三者記述あり | ハイポリ原型 → 自分でリトポ・ベイクする前提のヒーローキャラ |
| `P1-20260311` (Smart Mesh P1.0) | 「cleaner low-poly output with stable topology」。`face_limit` 48〜20,000。数秒で生成 | ゲーム用ローポリ小物・背景キャラ。ヒーローキャラは要リトポ |
| **P2.0 Preview** (2026) | **ネイティブ・クアッドトポロジ**、三角 500〜50K / クアッド 500〜25K、「関節周りに滑らかなエッジループ、平面はクリーンなクアッド、ディテール部に密度」、マルチビュー入力対応、Studio で誰でも 2 回無料 | **リグ前提のゲームキャラ**の第一候補 [未確認: 品質は要実機検証] |

**推奨コンボ（ゲーム用ローポリ・リグ付きキャラ）** [推測を含む]:
1. まず H3.1 で `texture: true, pbr: true, geometry_quality: detailed` のハイポリを 1 本作り、形状の当たりを確認（`model_seed` を固定して比較）。
2. 同じ入力で P2.0 Preview（または P1）マルチビューでクアッド 10K〜25K を生成。
3. 形状は P2.0 / 法線・色は H3.1 からベイク、という「ハイ→ロー」構成が最も production 向き。

### 3.2 各パラメータ

| パラメータ | 値 / 既定 | メモ |
|---|---|---|
| `texture_quality` | `standard` / `detailed`（+10 credits）。ComfyUI ノードでは `extreme`（8K）も選択肢 | ローポリにベイクし直すなら `detailed` で十分 |
| `pbr` | 既定 true | Base Color / Metallic / Roughness / Normal を出力。トゥーン用途なら Base Color のみ使う |
| `geometry_quality` | `standard` / `detailed`（+20 credits）。「standard はゲーム小物・背景キャラ、detailed はヒーローアセット」 | ベイク元にするなら detailed |
| `face_limit` | H3: adaptive（0）〜三角 1.5M〜2M、クアッドは ≤150K。`quad=true` で未指定なら 10,000 に | ゲームキャラは三角 10K〜50K 目安（公式 tutorial は「リアルタイムなら 10,000〜50,000」） |
| `quad` | 既定 false（+5 credits）。FBX で出力 | 「均等な四角形」で**エッジフローはアニメ用ではない**（後述） |
| `smart_low_poly` | 既定 false（+10 credits）。「Hand-crafted topology」／「単純な被写体向け」。Studio では最大 5,000 ポリ | 小物向け。キャラには P2.0 の方が適切 [未確認] |
| `texture_seed` / `model_seed` | 乱数。固定で再現性 | 形状比較するときは `model_seed` 固定、テクスチャだけリロールは `texture_seed` |
| `texture_alignment` | `original_image`（既定、画像忠実・3D 的な不整合あり得る）/ `geometry`（3D 整合優先、画像との差が出る） | マルチビューで色ズレが出るなら `geometry` を試す |
| `orientation` | `default` / `align_image` | `align_image` で「モデルの向きを元画像に合わせる」。正面が +Y/-Y のどちらになるかはエンジンにより後で直す |
| `auto_size` | 既定 false。「実世界メートルにスケール」（テクスチャ無しだと無視） | Blender 側で人間サイズを揃えるなら true が楽 |
| `generate_parts` | 既定 false（+20 credits）。編集可能なパーツに分割 | 髪・帽子・武器が融合する問題への公式対策（Studio の「セグメンテーション」） |
| `enable_image_autofix` | 既定 false | 入力画像の自動補正 |
| `compress` | `meshopt` / `geometry` | 配布用 |
| `style` | `person:person2cartoon` 等 | 入力写真をカートゥーン化。アニメ絵入力なら不要 |

### 3.3 クアッド／リトポ品質の実態

- 「Meshy / Tripo / Rodin いずれもクアッドリメッシュを提供するが、**均等に分布したクアッド**であり、アニメーションキャラでは手動リトポを計画するか、肩の潰れを受け入れるしかない」 [三者] RapidDirect/IndieHackers 比較 ([rapiddirect.com](https://www.rapiddirect.com/blog/best-8-ai-3d-model-generators/))
- 「小物や背景アセットは優秀だが、**アニメーションするヒーローキャラは本物のリトポが必要**」 [三者] Smart Mesh レビュー
- Tripo 公式ブログも「関節にループを入れないと candy wrapper 効果」「肩に 3 ループ、肘膝に 5 ループ」「Studio のリトポで初期最適化 → Blender/Maya で手動調整、のハイブリッドを推奨」 [公式] ([retopo-an-ai-character-model-for-animation](https://www.tripo3d.ai/blog/retopo-an-ai-character-model-for-animation))
- P2.0 Preview は「関節周りのエッジループ」を謳っており、上記の弱点への回答とされる。**2026-09 時点でまだ Preview であり、第三者による厳密な評価は見つからなかった** [未確認]。

---

## 4. リギング／アニメーション

出典: [Auto Rig — Tripo Developers](https://developers.tripo3d.ai/en/docs/animations-rig), [tripo-python-sdk API.md](https://github.com/VAST-AI-Research/tripo-python-sdk/blob/master/docs/API.md), [StraySpark Auto-Rigging Showdown 2026](https://www.strayspark.studio/blog/ai-auto-rigging-showdown-2026-tripo-meshy-cascadeur-mixamo), [Tripo blog: Rig AI character for Mixamo](https://www.tripo3d.ai/blog/rig-ai-generated-character-for-mixamo)

### 4.1 API フロー

1. `animate_prerigcheck`（SDK では `check_riggable`）: 「モデルがリグ可能かを判定。結果の `output.riggable`（bool）を確認」 [公式 SDK]。窓の杜レビューでもハト（非人型）は「このモデルには付けられない」と拒否された [三者]。
2. `animate_rig`（`POST /v3/animations/rig`）:
   - 入力: 生成タスク ID / file_token / URL。GLB, GLTF, FBX, OBJ, STL、150MB まで
   - `model_version`: `v1.0-20240301`（**biped 専用。人型に推奨、90 以上のアニメプリセット**）/ `v2.5-20260210`（非人型向け）
   - `rig_type`: `biped`（既定）, `quadruped`, `hexapod`, `octopod`, `avian`, `serpentine`, `aquatic`（SDK には `OTHERS` も）
   - `spec`: `tripo`（既定、Tripo 独自ボーン名）/ **`mixamo`（Mixamo 互換ボーン名）**
   - `out_format`: `glb` / `fbx`
3. `animate_retarget`: プリセット（IDLE, WALK, RUN, DIVE, CLIMB, JUMP, SLASH, SHOOT, HURT, FALL, TURN, QUADRUPED_WALK, …）を適用。

### 4.2 リグ品質の第三者評価

- **StraySpark（UE5/Blender で Tripo, Meshy, Cascadeur, AccuRig, Mixamo を比較, 2026）**:
  - 「Tripo のボーン命名は UE の Manny/Quinn に十分近く、リターゲットは**足ボーンのオフセットの微調整だけ**で済んだ」「全ツール中もっともクリーンなリターゲット」「Mover 2.0 でジッターなし、パイプライン全体で約 3 分」
  - 弱点: 「**幅広の肩は腕を上げると潰れる**」「**顎のウェイトがノイジー**。低品質な口パクなら可、クローズアップの会話には不向き」
  - Meshy は腰のウェイトに不整合、AccuRig は純粋なリグ品質でやや上だが遅い。**非人型では Tripo が最良**。
  - 結論: 「テキスト→キャラのパイプラインやスタイライズド・アセットの高速イテレーション向け。顔のクローズアップには向かない」
- dev.to の実践者は「auto rig でエクスポートエラー」「Mixamo 取り込みでボーン構造が非互換で手動修正が必要」「Meshy の方が Mixamo 連携がスムーズ」と報告（`spec: mixamo` を使ったかは不明） [三者・未確認]。
- Tripo 公式: 「AI 自動リグはリグスタックの**下半分（スケルトン、体のウェイト、移動）には有効**で、**上半分（顔、二次、ゲームロジック）は手作業**」「手動リグは**マント物理、プロップ取り付け、顔のクローズアップ**など art direction やリグの複雑さが要求する場合に取っておけ」 [公式 blog]

### 4.3 出力仕様（分かっている範囲）

- `spec: mixamo` で Mixamo 互換命名（`mixamorig:Hips` 形式かどうかは公式に明記なし [未確認]。StraySpark の「UE Manny に近い」という記述から標準的な Hips/Spine/…/LeftArm 系の階層と推定）。
- v3.1 世代は「**T ポーズ・Mixamo-ready スケルトンで出力**」（Tripo blog）。Studio には「T-Pose」オプションがあり、「アニメ用途なら T-Pose を ON」（rutinelabo 日本語ガイド） [公式/三者]。
- Blender への取り込み: 「File → Import → FBX、**Automatic Bone Orientation を無効**」（Tripo blog）。
- Mixamo アニメーションの流用は、Blender なら Rokoko Studio Live アドオンや Auto-Rig Pro のリマップで「ボーンペアを対応付けてリターゲット」が定石 [三者]。Quaternius / UE マネキンへのリターゲットの直接的な報告は UE5 Manny のみ確認 [未確認: Quaternius]。

### 4.4 失敗しやすいケース

- ゆるい衣服・スカート・マント: 体と一体のスキンになるので貫通・伸びが出る → Blender で分離して別ボーン/クロス/ボーンチェーンにする [三者・公式 blog の「cape physics は手動」]
- 複数の腕・尻尾・翼: biped v1.0 はプリセット外。v2.5 の `hexapod/octopod/avian` 等を試すか、Blender で追加ボーン [公式]
- T ポーズが不正確（腕が水平でない）だと「四肢が伸びる」→「正しい T ポーズで再エクスポート」 [公式 blog]
- 指: 「ウェイト不足 → Blender で手動ウェイトペイント」 [公式 blog]
- 非水密メッシュ・浮遊パーツがあるとリグ判定に落ちる/ウェイトが飛ぶ → 先に §5 のクリーンアップ [公式 blog + 三者]

### 4.5 Blender でリグし直すべきか

- **速度重視 / モブ / 試作**: Tripo `spec: mixamo` + T-Pose 出力 → そのまま Mixamo / UE5 リターゲット。StraySpark の結果からは「ほぼ無調整で動く」レベル。
- **ヒーローキャラ / 表情 / 衣装物理**: Tripo リグは骨の当たりだけ流用し、**Rigify または Auto-Rig Pro（有料、Mixamo/UE リマップ・ゲームエクスポート機能あり）で組み直す**のが一般的。Auto-Rig Pro は UX 評価 9/5 で Rigify を上回る（CGDive 比較） [三者]。
- Mixamo 自動リガー: 人型のみ。Tripo 出力（T ポーズ・水密）ならそのまま通る。Mixamo のウェイトが荒い部分は Blender の Automatic Weights で置き換える手法が知られている [三者]。

---

## 5. Blender での後処理（プロダクション向け）

出典: [neural4d Blender cleanup guide 2026](https://blog.neural4d.com/user-guide/ai-3d-model-blender-cleanup-complete-mesh-fix-guide-2026/), [triverse.ai clean-up tutorial](https://triverse.ai/blog/clean-up-ai-model-in-blender-tutorial), [Tripo common failure modes](https://www.tripo3d.ai/blog/explore/common-failure-modes-of-ai-3d-generators-and-fixes), [Tripo tutorial: problems](https://www.tripo3d.ai/tutorials/tripo-ai-image-to-3d-problems), [Qiita 家具事例](https://qiita.com/KouuAo/items/00847af05f8745438be8)

### 5.1 Tripo に特有と報告されるアーティファクト

| アーティファクト | 出典 | 対処 |
|---|---|---|
| 正面は正しいが**背面の法線が内向き** | neural4d（「Tripo が最も恩恵を受ける」） | Edit Mode 全選択 → Shift+N（Recalculate Outside） |
| 浮遊ジオメトリ / 切り離された断片 / 非多様体 | neural4d, Hyper3D レビュー | Merge by Distance（0.0001）→ Mesh > Clean Up > Delete Loose → 3D Print Toolbox「Make Manifold」 |
| 髪と肩、帽子と頭、アクセサリーが**融合して一塊** | Tripo anime 記事 | Studio の Segmentation / `generate_parts: true`、または Blender で Select Linked / Separate by Loose Parts、Sculpt で切り離し |
| 左右非対称（片腕が太い等） | Tripo failure modes | 良い側を Symmetrize（X 軸）。顔は特に注意 |
| 細いパーツ（指・ストラップ・ひも）の欠落 | HeyDream | 入力で太くしておく／後で手動モデリング |
| 毛並み等を細かく処理しようとして「トゲ状パーツ」が出る | unolaboratory（動物） | Smooth / Remesh で潰す。アニメ髪は房を大きめに描く |
| 髪の下のテクスチャ歪み、顔の印象変化 | modelinghappy / 日本語検索要約（Pro Refine 2026-08 の説明として言及） [未確認] | 顔テクスチャは元イラストから投影し直す（§5.4） |
| UV の自動展開による継ぎ目・ストレッチ | Tripo tutorial | Smart UV Project で再展開 → ベイク |
| 実世界スケールが無い | Tripo failure modes | `auto_size: true` または Blender で人型リファレンスに合わせる |

### 5.2 標準クリーンアップ手順（neural4d の順序）

1. インポートしてスケール確認（N パネル）。
2. 3D Print Toolbox → Check All（非多様体・ゼロ面積・交差）。
3. Edit Mode 全選択 → M → Merge by Distance（0.0001）。
4. Mesh > Clean Up > Delete Loose。
5. Shift+N で法線を外向きに再計算。
6. 3D Print Toolbox → Make Manifold → 再度 Check All（非多様体 0 を目標）。
7. Object Data > Normals > Clear Custom Split Normals Data（Meshy で特に必要。Tripo でも安全）→ Auto Smooth 30°（ハードサーフェス）/ 60°（有機）。
8. Ctrl+A → Apply All Transforms、不要なライト/カメラ/エンプティ削除。
   - 所要時間の目安: Tripo 出力で 20〜30 分（neural4d）。

### 5.3 リトポロジー

| 手段 | 向き | メモ |
|---|---|---|
| Tripo 側 `quad` / P2.0 | 手早い。P2.0 はリグ前提の設計 | 均等クアッドで**関節ループが弱い**（P2.0 は改善主張、未検証） |
| **Quad Remesher**（有料アドオン, Exoside） | ヒーローキャラのベース | 対称オプション・密度ガイドでアニメ向きの流れが作れる。Tripo 公式もキャラ向けに「Q Remeshify」系アドオンを推奨 |
| **Instant Meshes**（無料） | 中〜ローポリ | Qiita 事例: 約 100 万ポリ → 約 4,000 ポリまで、方向場を手で描いて流れを指定 |
| Blender Remesh (Voxel) | 融合パーツの統合、シルエット再構築 | voxel size 0.01〜0.02 から。UV・テクスチャは消えるので要ベイク |
| Blender Decimate (Collapse) | 最速。UV 保持 | ratio 0.3〜0.5（有機）。三角形のままなのでアニメ向きではない。Planar はハードサーフェス用 |
| 手動リトポ（Retopoflow 等） | 顔・手 | 顔は AI 出力が最も崩れる部位なので、ここだけ手動が費用対効果高い [推測] |

### 5.4 ベイク（ハイ→ロー）

- Cycles、Selected to Active（ハイ→ローの順に選択）、Bake Type: Diffuse で Direct/Indirect を外す（色のみ）、**Extrusion ≈ 0.05**（「ローポリ表面に当たらないようレイを外側に押す。無いと黒点」）、必要なら Cage を使う（triverse.ai）。
- Normal ベイク（Tangent space）も同じ設定で。トゥーン用途では法線マップを弱く／使わない（StraySpark トゥーン記事）。
- ロー側 UV: Smart UV Project（Island Margin 0.02）から始め、顔・手を大きめに取り直す。
- **アニメ顔のテクスチャ**: Tripo の顔テクスチャは崩れやすいので、Blender の Project from View で**元イラストの正面を顔 UV に投影**し直し、Tripo テクスチャと Texture Paint でブレンドするのが実務的 [推測・一般的手法]。
- Substance Painter を使う場合: Qiita 事例のように「ローポリ + ハイポリでメッシュマップをベイクしてテクスチャ転写」。

### 5.5 パーツ分離とスケール

- 髪・武器・マント・アクセサリーは Separate（P）して別オブジェクト化 → それぞれ別マテリアル/ボーン。`generate_parts` で最初から分かれていれば楽。
- ゲームエンジン向けポリ数の目安（neural4d）: 背景キャラ 500〜3,000、ヒーロー 5,000〜15,000、WebGL 5,000〜20,000 三角。Tripo 公式は「リアルタイムなら 10,000〜50,000 面」と少し高めの目安。

---

## 6. スタイライズド／アニメ・キャラクター固有の話

- 公式スタンス: 「セルシェードのアニメ絵もうまく扱える」「アニメ調キャラは正しいプロポーションで出てくる」（ユーザー声） [公式 feature page]。第三者比較（ideate.xyz, 2025-04）では「**スタイライズドは Hunyuan / TRELLIS の方がカートゥーンの美学を保つ**。Tripo / Rodin は顔テクスチャに強い」 [三者] ([ideate.xyz](https://ideate.xyz/blogs/posts/ai-3d-model-comparison-trellis-tripo-meshy-rodin-hunyuan))。
- 典型的な失敗（公式 anime 記事）: 「帽子が頭に融合」「長い髪が肩に融合」「別々であるべきパーツが一塊」「アニメ絵はレイヤード衣装・複雑な髪・リボン・アクセサリーが融合しやすい」「デザインの揺れ（髪型・アクセの消失）で 3D 化後に別人になる」→ Reference Pro / キャラ LoRA で**同一性を固定してから**マルチビューを作れ、と推奨。
- 日本語レビュー（uzurea.net, modelinghappy）: 「前髪に隠れた目」「髪に隠れた肌」が破綻しやすい。Tripo 3.0 以降で「髪の下のテクスチャ歪み」を修正する改良が入ったとされるが、「**処理後は顔の印象がかなり変わる（頭部比率・表情）**」 [三者・未確認]。
- 大きな目 / 平面的な顔: 単一画像だと目の凹み・鼻の高さが推定不能で「顔が平面のまま」または「写実寄りの鼻が生える」揺れがある。**側面ビュー（鼻の高さ・目の埋まり具合を示す）をマルチビューで与える**のが最も効く [推測・経験則]。目の描き込み（ハイライト・虹彩）はテクスチャに残るので、後で平面ポリゴン+テクスチャに置き換える手法もある [推測]。
- 髪の房: 細い房・ぱらつく毛先は細いパーツ扱いで消える/トゲ化する。**房を太く、塊としてシルエットが明快なデザイン**にすると安定 [公式 HeyDream 系の「シルエット重視」の帰結]。
- フラットカラー維持: `texture_alignment: original_image` で入力の陰影がテクスチャに焼き込まれる（§1.3）。**フラット塗り + ライン無し or 薄いラインの画像**を入力し、Blender 側でトゥーンシェーダーを当てるのが安定（StraySpark の Blender トゥーン記事も「法線マップは控えめに」） [三者]。PBR 出力の Roughness/Metallic はトゥーンでは無視してよい。
- 入力画像そのものを ComfyUI（本リポジトリの `comfy:anima-base` など）で作るなら、「A ポーズ・全身・白背景・フラットライティング・影なし」のプロンプトを最初から入れる。

---

## 7. 他ツールとの比較（2026 年）

出典: [sorceress.games 六モデル比較 (2026-05-31)](https://sorceress.games/blog/rank-the-best-image-to-3d-model-ai-six-model-test), [3DAI Studio Hitem3D vs Meshy vs Tripo (2026-07-07)](https://www.3daistudio.com/blog/hitem3d-vs-meshy-vs-tripo-comparison), [z.tools Meshy-6 vs Tripo v3.1](https://z.tools/blog/meshy-6-vs-tripo-v3-1-3d), [RapidDirect 8 tools](https://www.rapiddirect.com/blog/best-8-ai-3d-model-generators/), [Medium: Meshy vs Tripo vs Rodin vs Hunyuan (2026-07)](https://marcellinusprevailer.com/meshy-vs-tripo-ai-vs-rodin-vs-hunyuan-3d-best-ai-3d-generator-2077dd4d4533), [triposr.org Hunyuan3D vs TRELLIS](https://triposr.org/blog/hunyuan3d-vs-trellis), [trellis2.app ComfyUI guide](https://trellis2.app/blog/trellis-2-comfyui), [ComfyUI Hunyuan3D-2 docs](https://docs.comfy.org/tutorials/3d/hunyuan3D-2), [Hunyuan3D-2.1 GitHub](https://github.com/tencent-hunyuan/hunyuan3d-2.1)

| ツール | 強み（キャラ用途） | 弱み | ローカル / ComfyUI (RTX 4080 16GB) |
|---|---|---|---|
| **Tripo v3.1 / P2.0** | 速い・安い（Meshy の約 1/6 のコスト）、PBR 既定 ON、**biped/多足の自動リグ + T ポーズ出力 + Mixamo 互換**、クアッド/Smart Low Poly、パーツ分割、Blender/ComfyUI 公式ノード。sorceress では「クリーンなクアッド」枠 | 浮遊パーツ・非対称・顔テクスチャ崩れの報告（競合 Hyper3D レビュー含む）。均等クアッドで関節ループが弱い（P2.0 で改善主張） | **不可**（API のみ）。ComfyUI 内蔵 API ノードあり |
| **Meshy 6** | NetEase/Tencent の 3D アーティスト 1,331 名のブラインド評価で **63.8% が Tripo 3.1 より Meshy-6 を選好**（Meshy 社公表）。クアッド、**A/T ポーズ制御**、生成時リメッシュ、面数指定 5K〜100K、テクスチャ参照画像 | 高い（約 $0.80/gen）。ウェイト（腰）に不整合報告 | 不可 |
| **Rodin Gen-2 / 2.5 (Hyper3D)** | 最も写実的なテクスチャ、編集制御が豊富、ネイティブクアッド。ハードサーフェスに強い | 人型リアル寄り。アニメ調の評価情報が少ない | 不可（ComfyUI に API ノードあり） |
| **Hunyuan3D 2.0 / 2.1**（Tencent, オープンウェイト） | **スタイライズド/T ポーズ精度で高評価**（ideate.xyz）、2.1 は PBR。ComfyUI 公式チュートリアルあり | テクスチャは商用勢より簡素。2.1 のテクスチャパスは VRAM を食う（~29GB と報告、低 VRAM 版/分割実行で回避） | **可**。形状のみ 6〜10GB、形状+テクスチャ 12〜16GB（2.0）。2mv（マルチビュー）版あり |
| **Hunyuan3D 2.5 / 3.0 / 3.1** | 3.1 は sorceress で「推奨デフォルト」（コスト/品質バランス） | **3.x のオープンウェイトは確認できず**（ホスト/API 提供）。2.5 の重み公開は情報が食い違う [未確認] | 3.x は不可（要確認） |
| **TRELLIS.2**（Microsoft, オープン） | 最大ディテール、ボクセル解像度・サンプリングを細かく制御、1〜3 分、ComfyUI ノードあり | テクスチャはシンプル、PBR 弱め。Gaussian 系表現由来のメッシュ化アーティファクト | **可**。8GB 最低（512³ 低 VRAM）、**16GB で 1024³ 推奨帯** |
| Hitem3D | 1536³ / 200 万面の高密度 | 要リメッシュ、クアッド/ポーズ制御なし | 不可 |

**判断の目安**
- 「画像 → リグ付きゲームキャラ」を**最短で**回すなら Tripo（P2.0 マルチビュー + 自動リグ mixamo spec）が最も工程が揃っている。
- **アニメ調の形状忠実度**を最優先し、ローカルで回数無制限に試したいなら Hunyuan3D-2.1（または 2mv）→ Blender 手動リトポ/リグ。RTX 4080 16GB は形状生成は余裕、テクスチャは低 VRAM モードか Tripo/Blender ベイクで代替。
- ディテール最優先で自前リトポ前提なら TRELLIS.2 ローカル。
- Meshy 6 はポーズ制御・クアッドで Tripo と競るがコスト高。まず Tripo 無料枠 → 不満なら Meshy、が現実的。
- ※ 3DAI Studio の比較記事は「Tripo にクアッド/ポーズ制御がない」と書いているが、Tripo 公式 API/Studio に `quad` と T-Pose オプションがあるため、その記述は古いか誤り [三者記事の誤りとして注記]。

---

## 8. 参考リンク一覧

### Tripo 公式
- Image to model (H3) API: https://docs.tripo3d.ai/model-generation/image-to-model-v3-0-v3-1.html
- Multiview to model (H3): https://docs.tripo3d.ai/model-generation/multiview-to-model-v3-0-v3-1.html
- Multiview to model (P1-20260311): https://docs.tripo3d.ai/model-generation/multiview-to-model-p1-20260311.html
- Tripo H3.1 model page: https://developers.tripo3d.ai/en/models/v3-1
- Image to Multiview: https://developers.tripo3d.ai/en/docs/generation-image-to-multiview
- Auto Rig API: https://developers.tripo3d.ai/en/docs/animations-rig
- Python SDK API.md（check_riggable, rig_type, spec, style 等）: https://github.com/VAST-AI-Research/tripo-python-sdk/blob/master/docs/API.md
- 5 Professional Tips（入力画像）: https://www.tripo3d.ai/tutorials/tripo-ai-image-to-3d-tips
- Common Issues（問題と解決）: https://www.tripo3d.ai/tutorials/tripo-ai-image-to-3d-problems
- Why Your AI Anime Character Breaks in 3D: https://www.tripo3d.ai/blog/tripo-pix-anime-3d-characters
- Image to 3D Character feature page: https://www.tripo3d.ai/features/image-to-3d-model/for-3d-character
- Common failure modes of AI 3D generators: https://www.tripo3d.ai/blog/explore/common-failure-modes-of-ai-3d-generators-and-fixes
- Retopo an AI character for animation: https://www.tripo3d.ai/blog/retopo-an-ai-character-model-for-animation
- Rig AI character for Mixamo: https://www.tripo3d.ai/blog/rig-ai-generated-character-for-mixamo
- P2.0 Preview: https://www.tripo3d.ai/blog/tripo-p2-0-preview / X 告知 https://x.com/tripoai/status/2089750360114298937
- Smart Mesh: https://www.tripo3d.ai/features/smart-mesh
- ComfyUI 内蔵ノード: https://docs.comfy.org/built-in-nodes/TripoMultiviewToModelNode

### 第三者（英語）
- StraySpark Auto-Rigging Showdown 2026: https://www.strayspark.studio/blog/ai-auto-rigging-showdown-2026-tripo-meshy-cascadeur-mixamo
- HeyDream Tripo guide: https://heydream.im/blog/detail/Image-to-3D-on-HeyDream-AI-A-Practical-Tripo-3D-Step-by-Step-Guide-7adc6ef10dae/
- sider.ai Tripo guide: https://sider.ai/blog/ai-tools/how-to-convert-photos-to-3d-models-with-tripo-a-step-by-step-guide
- dev.to hands-on Meshy/Tripo: https://dev.to/abigail_armijo/what-i-learned-exploring-ai-generated-3d-a-hands-on-tour-of-meshy-tripo-and-threejs-5cic
- neural4d Blender cleanup 2026: https://blog.neural4d.com/user-guide/ai-3d-model-blender-cleanup-complete-mesh-fix-guide-2026/
- triverse.ai Blender cleanup: https://triverse.ai/blog/clean-up-ai-model-in-blender-tutorial
- Scenario Tripo 3.1 Multi View: https://www.scenario.com/blog/tripo-31-multi-view-examples-88ebdd2
- Smart Mesh P1.0 test (Level Up Coding): https://levelup.gitconnected.com/tripo-ais-new-smart-mesh-feature-60-faster-33-cheaper-c9278f0579f3
- ideate.xyz 5-tool comparison: https://ideate.xyz/blogs/posts/ai-3d-model-comparison-trellis-tripo-meshy-rodin-hunyuan
- sorceress.games six-model test: https://sorceress.games/blog/rank-the-best-image-to-3d-model-ai-six-model-test
- 3DAI Studio Hitem3D vs Meshy vs Tripo: https://www.3daistudio.com/blog/hitem3d-vs-meshy-vs-tripo-comparison
- z.tools Meshy-6 vs Tripo v3.1: https://z.tools/blog/meshy-6-vs-tripo-v3-1-3d
- Meshy vs Tripo（Meshy 社）: https://www.meshy.ai/compare/meshy-vs-tripo
- Hyper3D の Tripo レビュー（競合）: https://hyper3d.ai/blog/tripo3d-review
- RapidDirect 8 generators: https://www.rapiddirect.com/blog/best-8-ai-3d-model-generators/
- TRELLIS 2 ComfyUI / low VRAM: https://trellis2.app/blog/trellis-2-comfyui , https://trellis2.app/blog/trellis-2-low-vram
- Hunyuan3D-2 ComfyUI 公式: https://docs.comfy.org/tutorials/3d/hunyuan3D-2
- Hunyuan3D-2.1 GitHub: https://github.com/tencent-hunyuan/hunyuan3d-2.1
- Hunyuan3D versions: https://hunyuan3d.cc/hunyuan3d-versions/
- Rigify vs Auto-Rig Pro (CGDive): https://cgdive.com/rigify-vs-auto-rig-pro-auto-rigging-comparison/

### 日本語
- 窓の杜 Blender ウォッチング（Tripo 画像→3D 検証）: https://forest.watch.impress.co.jp/docs/serial/blenderwthing/1633191.html
- 窓の杜（リグ・スタイライズ）: https://forest.watch.impress.co.jp/docs/serial/blenderwthing/1629716.html
- rutinelabo Tripo 3.0 完全ガイド（T-Pose、メッシュ解像度）: https://rutinelabo.com/tripo-ai-3-guide-2025/
- uzurea.net Tripo レビュー（2D イラストの破綻）: https://uzurea.net/tripo-ai-3d-generator/
- MODELING HAPPY Tripo 3.0: https://modelinghappy.com/archives/64255
- unolaboratory Tripo 2026: https://unolaboratory.com/3dgenai_tripo/
- npaka Tripo P2.0 概要: https://note.com/npaka/n/n57d9bfa3ecc2
- note: AI 生成モデルのリギング（非人型は手動）: https://note.com/bakushu/n/nf2310319106c
- note: Tripo モデルのポーズ変更: https://note.com/kongo_jun/n/nb292de630581
- Qiita: Tripo → Instant Meshes → Substance Painter: https://qiita.com/KouuAo/items/00847af05f8745438be8
- Qiita: Blender 4.5 + Tripo plugin: https://qiita.com/ringo7pie/items/ff098a62b96190dbeab3

---

## チェックリスト: Tripo に入れる参照画像の準備

### A. 単一画像（Image-to-3D）
- [ ] **全身**が写っている（足先まで切れていない、頭上にも余白）
- [ ] **A ポーズ**（腕を体から 30〜45° 離す）または T ポーズ。腕組み・手を前に出す・武器が体を横切るポーズは NG
- [ ] **正面**（必要なら軽い 3/4）。極端な俯瞰・煽り・広角パースなし
- [ ] **顔が髪で隠れていない**（前髪で目が隠れる場合は少し上げる／別バリアントを描く）
- [ ] 髪の房・リボン・アクセサリーは**太く・塊として**、体から浮いた細い要素を減らす
- [ ] 帽子・マント・武器など後で分離したいパーツは、**体と色/シルエットが分かれる**ように描く（または後で `generate_parts`）
- [ ] **背景は無地（白/グレー）または透過 PNG**。グラデーション・パーティクル・文字・ロゴ・透かしなし
- [ ] **照明はフラット**。強い影・リムライト・鏡面ハイライトなし（セルシェードの影も最小限に。フラットカラー版を別途用意すると Base Color が綺麗）
- [ ] 解像度 **2048px 以上**（長辺）、過度なシャープ/JPEG 圧縮なし、PNG 推奨、20MB 以下
- [ ] 被写体は**1 体のみ**。ペット・武器の別置き・小物の並置なし
- [ ] スタイルが 1 枚の中で統一されている（顔だけ写実、体はアニメ、のような混在なし）
- [ ] 左右対称にしたい要素は画像でも対称に（AI は非対称を素直に拾う）
- [ ] 指は開いた状態で見える（握り拳・ポケットは融合する）

### B. マルチビュー（Multiview-to-3D）追加項目
- [ ] ビューは **front / left / back / right** の固定 4 方向（順序を守る）。最低 front + 1、キャラは **front + side + back の 3 枚以上**推奨
- [ ] 全ビューで**同じポーズ・同じ衣装・同じ髪型・同じアクセサリー**（Reference / キャラ LoRA で同一性固定）
- [ ] 全ビューで**同じスケール・同じ画面内位置・同じ余白**（キャンバスサイズも揃える。足元と頭頂の高さが一致）
- [ ] 全ビューが**平行投影っぽく**（同じカメラ高さ・目線の高さ・パースなし）
- [ ] 全ビューで**同じ照明・同じ色温度**（テクスチャ継ぎ目の主因）
- [ ] 背景は全ビューで同じ無地/透過
- [ ] 迷ったら Tripo の **Image-to-Multiview** で 4 面を作らせ、それを手直しして戻す
- [ ] 矛盾するビューを無理に入れない（front 単体の方が良い結果になることもある）

### C. 生成パラメータ（ゲームキャラ用の初期値）
- [ ] 形状確認用: H3.1, `model_seed` 固定, `geometry_quality: detailed`, `texture_quality: detailed`, `pbr: true`
- [ ] ゲーム用: P2.0 Preview / P1 マルチビュー, `quad: true`, `face_limit` 10K〜25K, `orientation: align_image`, `auto_size: true`
- [ ] 融合しやすいデザインなら `generate_parts: true`
- [ ] 色ズレが気になるなら `texture_alignment: geometry` を試す
- [ ] Studio なら **T-Pose ON** → 自動リグ `biped` / `spec: mixamo` / FBX

### D. 生成後（Blender に入れる前後）
- [ ] `animate_prerigcheck` が通るか（通らなければ浮遊パーツ・非水密を先に修正）
- [ ] Merge by Distance → Delete Loose → Recalculate Normals → Make Manifold
- [ ] 非対称なら Symmetrize、顔/手は手動リトポ or Quad Remesher
- [ ] ハイ→ローで Diffuse/Normal ベイク（Extrusion 0.05）、UV 再展開
- [ ] 髪・マント・武器を Separate、必要なら別ボーン/クロス
- [ ] トゥーン用途なら Roughness/Metallic/Normal を捨て、Base Color + トゥーンシェーダー
