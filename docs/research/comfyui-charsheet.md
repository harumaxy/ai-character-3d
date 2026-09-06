# ComfyUI でキャラクターデザイン参照（キャラシート）を作り、Tripo AI 等の image/multiview-to-3D に最適な入力を作る調査

- 調査日: 2026-09-06
- 前提環境: Windows / RTX 4080 16GB / ComfyUI ローカル / LoRA 学習・AnimateDiff は使わない / fp8・GGUF 量子化は可
- 既存資産（隣接リポジトリ）: Qwen-Image-Edit 2511 GGUF Q5_0 + Lightning 4-step LoRA のターンアラウンド WF、FLUX.2 klein 9B fp8、Anima、WAI Illustrious、comfyui-mcp サーバ
- 出力ゴール: Tripo の multiview-to-model（front / left / back / right の順、front 必須 + 1 枚以上）に渡せる、同一キャラ・同一スケール・平坦ライティング・背景無しの 4 面図

凡例: **[要確認]** = 一次情報で裏が取れていない/推測を含む主張。**[コミュニティ報告]** = ブログ・SNS 等の二次情報。

---

## 0. Tripo 側の入力仕様（ゴールの再確認）

| 項目 | 仕様・推奨 | 出典 |
|---|---|---|
| 画像順序 | `[front, left, back, right]` の 4 要素固定。file_token を空にすると省略可。**front は省略不可**、**2 枚未満は不可** | [Tripo OpenAPI: Multiview to model (P1-20260311)](https://docs.tripo3d.ai/model-generation/multiview-to-model-p1-20260311.html), [同 (H3 / v3.0-3.1)](https://docs.tripo3d.ai/model-generation/multiview-to-model-v3-0-v3-1.html) |
| 形式 | JPEG / PNG、20MB 以下 | 同上 |
| 解像度 | Tripo 公式チュートリアルは「2048×2048 以上を推奨」「明瞭な被写体・均一な照明・単純な背景」「強い影・反射・モーションブラーを避ける」 | [Tripo: 5 Professional Tips](https://www.tripo3d.ai/tutorials/tripo-ai-image-to-3d-tips), [Best image types](https://www.tripo3d.ai/tutorials/tripo-ai-best-image-types) |
| マルチビューのコツ | 4 面全部使うと再構成品質が上がる。**被写体のスケールと中心位置を各画像で揃える**。**強いパースを避け orthographic 寄りにする**。ライティングを全面で揃える | [Scenario: Tripo 3.1 Multi View guide](https://www.scenario.com/blog/tripo-31-multi-view-examples-88ebdd2) **[コミュニティ報告]** |
| ComfyUI から直接呼ぶ | 組み込み API ノード `TripoMultiviewToModelNode`（image=front 必須, image_left/back/right 任意、texture / pbr / texture_quality / face_limit / quad / geometry_quality） | [ComfyUI docs: TripoMultiviewToModelNode](https://docs.comfy.org/built-in-nodes/TripoMultiviewToModelNode) |
| パラメータ | `enable_image_autofix`（入力画像自動補正）、`texture_alignment`（`original_image` = 見た目優先 / `geometry` = 形状優先）、`orientation: align_image` | [Tripo OpenAPI (H3)](https://docs.tripo3d.ai/model-generation/multiview-to-model-v3-0-v3-1.html) |
| Tripo 自身のマルチビュー生成 | `image-to-multiview` エンドポイントが 1 枚から front/left/back/right を生成し、multiview-to-model の前処理として使える。「被写体がクリーンな背景ではっきり見えること」が条件 | [Tripo Developers: Image to Multiview](https://developers.tripo3d.ai/en/docs/generation-image-to-multiview) |

> 結論として「front を極限までクリーンに作る」ことが最重要で、side/back は (a) 自前で作る、(b) Tripo の image-to-multiview に任せる、の 2 択がある。本書は (a) を主に扱いつつ、(b) をフォールバックとして推奨する。

---

## 1. 単体フロントビュー（A/T ポーズ・無地背景）に最適なモデル比較（2026-09 時点）

### 1.1 比較表（16GB VRAM 前提）

| モデル | 規模 / 種別 | 16GB での動作 | 速度目安 | プロンプト追従 | 得意スタイル | 備考 |
|---|---|---|---|---|---|---|
| **Qwen-Image-2512** (2025-12) | 20B MMDiT、Qwen2.5-VL 7B TE | fp8 (`qwen_image_2512_fp8_e4m3fn`) は 12-16GB 向けと公式明記。GGUF は Q5_K_M (~15GB) / Q6_K (~16.8GB) が 16GB の目安 | 50 steps / true_cfg 4.0 が公式。Lightning 4/8-step LoRA で大幅短縮。4060Ti で 5-6 分/枚との報告 → 4080 では **1-2 分程度と推定 [要確認]** | 「literal すぎて弱点になりうる」レベルで最強クラス | 写実〜絵画〜アニメまで LoRA なしで幅広い | 解像度は 1328², 1104×1472 (3:4), 928×1664 (9:16) 等 | 
| **FLUX.2 [klein] 9B** (2026-01-15) | 9B、Qwen3 8B TE、生成と編集を単一モデルで | Comfy blog 表記: 9B distilled 19.6GB / base 21.7GB（bf16 と推定）。**fp8 なら 16GB で動作（ユーザー環境で既に稼働）** | distilled: 4 steps / CFG 1、5090 で約 2 秒。base: 20-50 steps / CFG 4-5 | 強い（Qwen3 TE）。「プロンプトのスタイルに強く影響される」 | 写実・イラスト両方。アニメは「伝統的なアニメ調」寄り | 9B は非商用ライセンス。マルチリファレンス編集は最大 4 枚 |
| **FLUX.1 dev** (2024) | 12B、T5+CLIP | fp8 で問題なし | 20-28 steps | 良いが Qwen/klein 世代に劣る | 写実・イラスト | 2026 では klein / 2512 に世代交代。Kontext dev（編集）も同様 |
| **Z-Image Base** (2026-01-28) / Turbo (2025-11) | 6B 単一ストリーム DiT、Qwen3 4B TE | bf16 でも 16GB に収まる（Turbo は公式に「16GB 消費者向けデバイスに収まる」） | Base: 28-50 steps / CFG 3-5。Turbo: 8-9 steps / CFG 0-1 | Turbo は写実で強いが Qwen 2512 ほどではない。Base は「精密なプロンプト追従・多様性」を掲げる | Base は「イラストに強い」「顔・構図の多様性」（GIGAZINE 評） | アニメ特化フルファインチューン **Z-Anime** あり（NL プロンプト、8GB で動作） |
| **Anima 1.0** (Base v1: 2026-05-15) | 2B（Cosmos-Predict2 ベース）、Qwen3 0.6B TE、Qwen-Image VAE | 6GB 未満で動作 | 30-50 steps / CFG 4-5（Turbo: 8-12 steps / CFG 1） | Danbooru タグ + 自然言語の両対応 | アニメ・イラスト専用（写実は対象外） | 「フルボディ立ちポーズが最もクリーン」との比較記事あり |
| **HiDream-O1-Image** (2026-05) | 8B、ピクセル空間モデル | fp8 で ~10GB、GGUF Q6 (~14.7GB) が 16GB 向け | 28 steps | テキスト描画に強い | 汎用 | キャラシート用途の実績が少なく **[要確認]** |
| **Krea 2 Turbo** (OSS: 2026-06-22) | 12.9B DiT、Qwen3-VL TE、Qwen-Image VAE | fp8 / NVFP4 / INT8 あり。5060Ti 16GB での動作報告あり | 8 steps / CFG 1 / euler_ancestral + beta | 自然言語向け。文字は苦手 | 写真〜アニメまで「美的品質」重視 | CharacterSheet LoRA の対応ベースの 1 つ |
| **Ideogram 4.0** (open weights: 2026-06-03) | 9.3B DiT、Qwen3-VL 8B + Gemma4 TE、**conditional / unconditional の 2 モデル**（fp8 各 13.8GB） | 合計 ~38GB のファイル。オフロードで動くとされるが 16GB では遅い **[要確認]** | JSON 構造化プロンプト対応 | レイアウト・空間理解・文字が非常に強い | ポスター/デザイン寄り | 非商用ライセンス。キャラ 1 体の立ち絵用途にはオーバースペック |
| **WAI Illustrious (SDXL)** | SDXL 系 | 余裕 | 25-30 steps | Danbooru タグ厳密 | アニメ | タグ忠実度は最高クラス（Illustrious/NoobAI）。`reference sheet`, `multiple views` 等のタグを理解 |

出典:
- Qwen-Image-2512: [HF model card](https://huggingface.co/Qwen/Qwen-Image-2512), [ComfyUI docs](https://docs.comfy.org/tutorials/image/qwen/qwen-image-2512), [Unsloth GGUF ガイド](https://unsloth.ai/docs/models/tutorials/qwen-image-2512)
- 3 モデル横断レビュー: [Diffusion Doodles: Model Rundown (Z-Image Turbo / Qwen 2512 / Edit 2511 / Flux.2 Dev)](https://diffusiondoodles.substack.com/p/model-rundown-z-image-turbo-qwen)
- FLUX.2 klein: [HF FLUX.2-klein-9B](https://huggingface.co/black-forest-labs/FLUX.2-klein-9B), [Comfy blog](https://blog.comfy.org/p/flux2-klein-4b-fast-local-image-editing), [ComfyUI docs (klein)](https://docs.comfy.org/tutorials/flux/flux-2-klein), [nomadoor: FLUX.2 [klein]](https://comfyui.nomadoor.net/en/basic-workflows/flux-2-klein/)
- Z-Image: [GitHub Tongyi-MAI/Z-Image](https://github.com/Tongyi-MAI/Z-Image), [ComfyUI Wiki: Z-Image-Base release](https://comfyui-wiki.com/en/news/2026-01-28-alibaba-z-image-base-release), [GIGAZINE](https://gigazine.net/gsc_news/en/20260128-z-image-image-generation-ai/), [Z-Anime](https://huggingface.co/SeeSee21/Z-Anime)
- Anima: [HF circlestone-labs/Anima](https://huggingface.co/circlestone-labs/Anima), [ComfyUI docs (Anima)](https://docs.comfy.org/tutorials/image/anima/anima), [note: Anima 紹介](https://note.com/yoya48/n/n6cb08878780e)
- HiDream-O1: [stablediffusiontutorials](https://www.stablediffusiontutorials.com/2026/05/hidream-o1-image.html), [kombitz 解説](https://www.kombitz.com/2026/05/10/hidream-o1-image-explained-a-new-pixel-space-ai-image-model/)
- Krea 2: [Comfy blog](https://blog.comfy.org/p/krea-2-open-source-models-are-now), [note: あべちん Krea 2 Turbo](https://note.com/abechin_t/n/n4115ba44c7d3)
- Ideogram 4: [Comfy blog Day-0](https://blog.comfy.org/p/ideogram-4-day-0-support-in-comfyui), [ComfyUI docs](https://docs.comfy.org/tutorials/image/ideogram/ideogram-v4)
- 5 モデル同一キャラ比較（Krea 2 / NoobAI / Anima / Illustrious / NetaYume, 2026-06）: [note: TNSOR_WORKS](https://note.com/tnsor_works/n/n0d9ab70999f2)

### 1.2 結論（フロントビュー用）

1. **第一候補: Qwen-Image-2512**（GGUF Q5_K_M または fp8 + Lightning 8-step）。「A-pose・両足を開く・無表情・白背景・全身・見切れなし」といった**制約列挙型のプロンプト**に最も literal に従う。3:4 (1104×1472) で全身が収まりやすい。
2. **第二候補（高速な試行用）: FLUX.2 klein 9B fp8**（4 steps）。候補を 8-16 枚量産して選ぶ用途に最適。既に環境にある。klein は後段で「編集」もできるので、同じモデルで front を微修正（背景白化・ポーズ修正）できる。
3. **アニメ/セル調なら: Anima（タグ+NL）または WAI Illustrious（タグ）**。同一キャラ再現性はタグ系（NoobAI / Illustrious）が最も高いという比較結果（TNSOR_WORKS）。ただしタグ系は「orthographic」「no perspective」の概念が弱く、あくまで正面立ち絵を作る用途。
4. Z-Image Base は「イラストに強く多様性が高い」ため候補出しには良いが、Qwen ほど制約に従わない印象の報告 **[コミュニティ報告]**。Ideogram 4 / HiDream-O1 は本用途では過剰（ファイルサイズ・速度）。

### 1.3 「A ポーズ正面・白背景・全身」を安定させるプロンプトパターン

**自然言語モデル（Qwen-Image-2512 / FLUX.2 klein / Krea 2 / Z-Image）向け**（英語推奨。Qwen 系は 200 文字超で曖昧化するとの指摘があるので、要素を絞る）:

```
A full-body character design reference of ONE character, standing in a neutral A-pose:
arms straight and held slightly away from the body, palms facing inward, feet shoulder-width apart,
facing the camera directly, front orthographic view, no perspective distortion, camera at chest height.
Neutral expression, mouth closed, eyes open looking straight ahead.
Flat, even, shadowless studio lighting, no cast shadow on the ground, no rim light.
Plain pure white background, nothing else in the frame. The entire body including head and feet is visible
with margin above the head and below the feet, not cropped. Centered.
[キャラクター記述: 髪型/色、服装、体型、小物]
```

- 「orthographic view, no perspective distortion」の明示は 3D 用途向けに推奨されている（[Apatero: AI Character Turnaround Sheet Guide 2026](https://apatero.com/blog/ai-character-turnaround-sheet-generation-guide-2026)）。
- 「sheet」「turnaround」「multiple views」という語は**単体ビューが欲しいときは入れない**（マルチパネル化を誘発する）。
- 見切れ対策: 縦長 3:4 または 9:16 を使い、「margin above the head and below the feet」を明示。
- ネガティブ（Qwen-Image 2512 は true_cfg > 1 のときネガティブが効く。Lightning 使用時 CFG 1 では無効）: `cropped, cut off, multiple characters, text, watermark, shadow on ground, dramatic lighting, perspective, low angle, high angle, dynamic pose, hands on hips`。

**Danbooru タグ系（Anima / WAI Illustrious）向け**（Danbooru には `a-pose` / `t-pose` タグが存在: [Danbooru wiki: A-Pose](https://danbooru.donmai.us/wiki_pages/a-pose)）:

```
masterpiece, best quality, score_7, safe,
1girl, solo, full body, standing, a-pose, arms at sides, legs apart, straight-on, looking at viewer,
expressionless, closed mouth, simple background, white background, flat color, flat shading,
no shadow, character design, [キャラ記述タグ]
```
Negative: `worst quality, low quality, score_1, score_2, score_3, artist name, blurry, multiple views, reference sheet, text, cropped, from side, from behind, dutch angle, foreshortening`

- Anima 公式推奨 prefix / negative は上記の通り（[HF Anima](https://huggingface.co/circlestone-labs/Anima)）。
- タグ系では「multiple views」「reference sheet」を**ネガティブ**に入れて単体ビューを強制する。

---

## 2. マルチビュー一貫性（同一キャラの front/back/left/right）

### 2.1 手法比較

| 手法 | 一貫性 | orthographic / 同一スケール | 16GB | 長所 | 短所 |
|---|---|---|---|---|---|
| (a) **Qwen-Image-Edit 2511**（+Lightning 4-step）でビュー編集 | 高（2511 で「character consistency」「image drift 軽減」「geometric reasoning 強化」、「新規視点合成をベースモデルのみで」と公式明記） | 素の指示だとカメラ距離・仰角がぶれる。**fal Multiple-Angles LoRA** を足すと 96 カメラ位置（8 方位 × 4 仰角 × 3 距離）が固定され、Gaussian Splatting レンダ由来で空間整合性が高い | Q5_0 GGUF + Lightning で動作中 | 既存資産をそのまま拡張できる。1 ビューずつ独立に再生成・再抽選できる | ビューごとに別推論なので細部（アクセサリ、非対称デザイン）が揺れる。back は特に劣化しやすい |
| (b) **FLUX Kontext dev**（+ turnaround LoRA） | 中 | 横一列シート形式。LoRA で改善 | fp8 で可 | 一枚絵の中で照明・比率が揃う | 2025 世代。Kontext 単体は back の破綻が多い **[コミュニティ報告]**。klein に置換可能 |
| (c) **FLUX.2 klein 9B + CharacterSheet TripleView LoRA**（2026-07-31） | 中〜高（front/side/back を 1 枚に生成、同一画像なのでスタイル・照明・比率が揃う） | 1536×1024 のシートを後段でパネル分割 → bbox 正規化が必須 | fp8 で可 | 8 steps・CFG 1 で速い。既存の klein 環境に LoRA を足すだけ | 約 300 枚で学習・人型中心。「side/back は追加生成や手直しが要る」と作者明記。left/right の 4 面は QuadView（顔アップ + 3 面）で、left と right は片方のみ |
| (d) **T2I で「turnaround sheet」を 1 枚に描く**（Qwen 2512 / klein / Anima 等） | 中（同一画像なので破綻は少ない） | パネル間でスケールがずれやすい。1 パネルあたりの解像度が低い | 可 | 最速・最も簡単。デザイン初期の「雰囲気確認」に良い | 3D 入力としては解像度不足・パネル抽出が手間。back が front の鏡写しになりがち |
| (e) **MV-Adapter i2mv (SDXL)** | 高（マルチビュー同時生成＝設計上の一貫性） | 6 視点（azimuth 0/45/90/180/270/315°、elevation 0°）= 0/90/180/270 が含まれる。orthographic 寄り **[要確認]** | i2mv は「約 13-14GB」。fp16 VAE + VAE slicing 推奨 | 3D 再構成入力として設計された唯一の選択肢（MIDI-3D 等と連携） | SDXL ベース・768² 止まりで質感が古い。入力は背景除去済み・中央配置が前提。スタイライズドキャラでの品質は未確認 |
| (f) **Hunyuan3D-2mv / 2.1 のマルチビュー条件付け** | — | front/left/back（HF カード例）を受けて形状生成 | 2.0 は 16GB で可 **[コミュニティ報告]** | Tripo の代替として同じ 4 面図を再利用可 | 画像を生成するのではなく 3D を作る側。Hy3D 2.1 の `MultiViews Generator` はメッシュからテクスチャ用ビューをレンダするもので、本目的とは別物 |
| Zero123++ / Era3D / Wonder3D / CharacterGen / SV3D | — | 2023-24 世代、低解像度（256-512） | — | — | 2026 時点で ComfyUI ノードのメンテ状況が不明で **非推奨 [要確認]**。MV-Adapter / Hunyuan3D-mv / Tripo image-to-multiview に置換された |

出典:
- Qwen-Image-Edit-2511: [HF model card](https://huggingface.co/Qwen/Qwen-Image-Edit-2511), [ComfyUI docs 2511](https://docs.comfy.org/tutorials/image/qwen/qwen-image-edit-2511), [Comfy blog 2511 & Layered](https://blog.comfy.org/p/qwen-image-edit-2511-and-qwen-image), [Lightning LoRA (lightx2v)](https://huggingface.co/lightx2v/Qwen-Image-Edit-2511-Lightning), [GGUF (unsloth)](https://huggingface.co/unsloth/Qwen-Image-Edit-2511-GGUF), [GGUF (QuantStack)](https://huggingface.co/QuantStack/Qwen-Image-Edit-2511-GGUF)
- Multiple-Angles LoRA: [HF fal/Qwen-Image-Edit-2511-Multiple-Angles-LoRA](https://huggingface.co/fal/Qwen-Image-Edit-2511-Multiple-Angles-LoRA)（Apache 2.0、強度 0.8-1.0、`<sks> [azimuth] [elevation] [distance]`）, [ComfyUI_CameraAngleSelector](https://github.com/NickPittas/ComfyUI_CameraAngleSelector)（96 角度を 3D UI で選び `<sks> ...` 文字列を出力）, [Comfy supported-models ページ](https://comfy.org/p/supported-models/qwen-image-edit-2511-multiple-angles-lora/)
- 日本語事例: [note: Qwen Image Edit 2511 で 3 面図を作る（Multi-Angle LoRA → 3D 生成 → 3D プリント）](https://note.com/snapreplica/n/nbaafc4e308eb), [SAKASA AI: Qwen で多角度生成](https://sakasaai.com/comfyui-multi-angle-image/), [Zenn: Qwen-Image-Edit-2509 プロンプト攻略](https://zenn.dev/rick_lyric/articles/ffd10bbb59e8b6), [Zenn: 2511 を試す（4bit / Lightning）](https://zenn.dev/kun432/scraps/879fe9a8d587da), [note: ひのき — イラストから 3D モデル（Qwen-Image-Edit 三面図 → Hunyuan3D 2.0）](https://note.com/hiha/n/neeac410a7b29)
- Kontext: [ComfyUI docs Kontext dev](https://docs.comfy.org/tutorials/flux/flux-1-kontext-dev), [Kontext turnaround LoRA](https://huggingface.co/reverentelusarca/kontext-turnaround-sheet-lora-v1)
- CharacterSheet LoRA: [HF Alissonerdx/CharacterSheet](https://huggingface.co/Alissonerdx/CharacterSheet), [ComfyUI Wiki ニュース (2026-07-31)](https://comfyui-wiki.com/en/news/2026-07-31-charactersheet-multiview-loras)
- klein のポーズ制御 LoRA: [RefControl (pose map + reference)](https://huggingface.co/thedeoxen/refcontrol-FLUX.2-klein-9B-reference-pose-lora)
- MV-Adapter: [GitHub MV-Adapter](https://github.com/huanngzh/MV-Adapter), [ComfyUI-MVAdapter](https://github.com/huanngzh/ComfyUI-MVAdapter), [HF checkpoints](https://huggingface.co/huanngzh/mv-adapter), [i2mv 推論スクリプト（既定: 6 views, azimuth [0,45,90,180,270,315], 768², CFG 3.0, 50 steps）](https://raw.githubusercontent.com/huanngzh/MV-Adapter/main/scripts/inference_i2mv_sdxl.py), [論文 (ICCV 2025)](https://arxiv.org/html/2412.03632v1)
- Hunyuan3D-mv: [HF tencent/Hunyuan3D-2mv](https://huggingface.co/tencent/Hunyuan3D-2mv), [ComfyUI docs Hunyuan3D-2](https://docs.comfy.org/tutorials/3d/hunyuan3D-2), [Comfy blog: Hunyuan3D 2.0 & Multiview native](https://blog.comfy.org/p/hunyuan3d-20-and-muitiview-native)

### 2.2 (a) Qwen-Image-Edit 2511 で効くプロンプト

**Multiple-Angles LoRA あり（推奨）** — LoRA の語彙に厳密に従う。距離は全ビューで同じ語を使う（＝スケール固定）:

```
<sks> front view eye-level shot medium shot
<sks> left side view eye-level shot medium shot
<sks> back view eye-level shot medium shot
<sks> right side view eye-level shot medium shot
```
- 語彙: azimuth = `front view | front-left quarter view | left side view | back-left quarter view | back view | back-right quarter view | right side view | front-right quarter view`、elevation = `low-angle shot | eye-level shot | elevated shot | high-angle shot`、distance = `close-up | medium shot | wide shot`。
- 全身を確実に収めたい場合は `wide shot`（×1.8）を試す。4 面すべて同じ distance 語にすること。
- Tripo の left/right 定義は公式に明記なし。**2026-09-06 実測で確定**: `left_view` = キャラ **画面左**向き、`right_view` = キャラ **画面右**向き。カメラ位置基準でなく **絵の中でキャラがどっち向くか** で覚える。→ §9.1
- 日本語事例（note/snapreplica）では `right side view / back view / front view` + `eye-level shot medium shot` で 3 面図を作り、Hunyuan 3D に複数枚入力して「単画像より髪・服の背面再現が明らかに良い」と報告。

**LoRA なし（素の 2511）** — 保持条件を列挙する「preserve 型」の書き方が 2509/2511 で有効:

```
Rotate the character 180 degrees to show the back view.
Keep the exact same character, hairstyle, outfit, colors, proportions and A-pose.
Same flat even lighting, same plain white background, full body visible, same camera distance and height.
```
```
Show the same character from the left side (profile view), turned 90 degrees.
Keep the same A-pose, outfit, proportions, flat lighting and plain white background. Full body visible.
```
- Zenn のガイド語彙: 「Obtain the front view」「Rotate to show the back」「Change to a side view」「Leave everything else unchanged」「Maintain the original lighting」。
- 2511 は入力画像を 3 枚まで参照できる（ComfyUI テンプレート）。**front + 生成済み back の 2 枚を渡して side を作る**と左右の整合が上がる **[コミュニティ報告・要確認]**。
- Lightning 4-step 使用時は CFG 1.0 / 4 steps / ネガティブは空白 `" "`（公式カードのネガティブ既定は `" "`）。

### 2.3 (c) FLUX.2 klein 9B + CharacterSheet TripleView

- トリガーキャプション（固定）: `Convert the character in the image to a Character Sheet showing front, side and back full body views`
- 設定: 1536×1024、8 steps、CFG 1、Euler、scheduler `beta57`、LoRA 強度 1.0（QuadView は scheduler `simple`）。
- 出力は 1 枚のシートなので、後段で 3 パネルを切り出し → §3 の bbox 正規化にかける。
- 制限: 「解剖・顔・服・小物・比率がビュー間で違うことがある」「side/back は再生成や手動修正が要ることがある」「複雑なアクセサリ・非対称デザイン・手は苦手」。

### 2.4 どれが最も「一貫・orthographic・同一スケール」か（推奨順）

1. **Qwen-Image-Edit 2511 + Multiple-Angles LoRA（+Lightning）を 1 ビューずつ** → bbox 正規化。カメラ語彙で距離・仰角が固定され、破綻したビューだけ再抽選できるのが決定的に有利。
2. **klein 9B + TripleView LoRA** を「セカンドオピニオン」に。1 枚で style/照明が揃うため、(1) の back が崩れたときの back 候補として使う。
3. **MV-Adapter i2mv** は「本当にマルチビュー整合な画像」を出す唯一のローカル手段だが、SDXL 品質 / 768² / 13-14GB のため、テクスチャ品質より形状一貫性を優先するときの選択肢。Tripo に渡す前に (1) の高品質 front を `texture_alignment: original_image` で活かす、という組合せも可。
4. 自前で 4 面を作るのが難しいキャラ（複雑な装備など）は、**クリーンな front だけ作って Tripo `image-to-multiview` → `multiview-to-model`** に任せる手がある。ただし **2026-09-06 実測**: Tripo 製 4 面 と 自前 4 面 は構図・向き・スケールほぼ同一（自前の方が整合わずかに良い）。**二面顔は入力起因でない → これでは直らない**。→ §9.2

---

## 3. 3D 入力用のクリーンアップ

### 3.1 背景除去

- 推奨ノードパック: **ComfyUI-RMBG（1038lab）** v3.1.0（2026-07-21）。RMBG-2.0 / BiRefNet（general, portrait, matting, **HR**, lite）/ **Lucida**（BiRefNet fine-tune、「イラスト・線画・半透明・グロー/VFX」向け）/ BEN / BEN2 / InSPyReNet / SDMatte / SAM / SAM2 / SAM3 / GroundingDINO を 1 ノードで切替。パラメータ: `sensitivity`, `process_res`(512-2048), `mask_blur`, `mask_offset`, `background`(alpha/white/...)。[GitHub](https://github.com/1038lab/ComfyUI-RMBG)
- モデル選択の目安 **[コミュニティ報告]**: 髪は BiRefNet-HR が良好（過補正することもある）、BEN2 は髪・細部で InSPyReNet/BiRefNet より上との評価、RMBG-2.0 は汎用で安定。**イラスト/アニメは Lucida → BiRefNet-HR の順に試す**。[Medium: Background Removal in ComfyUI](https://medium.com/code-canvas/background-removal-in-comfyui-just-got-really-really-good-2a12717ff0db)
- ライセンス: RMBG-2.0（BRIA）は非商用ライセンスのはず **[要確認]**。商用案件なら BiRefNet / BEN2 / InSPyReNet 系を使う。
- 生成段階で白背景を強制していれば、`background: white` で PNG 出力 + アルファ版も同時保存（Tripo は「透過 PNG または無地白」を推奨）。
- 補足: Qwen-Image-Layered（2511 と同時公開）は画像を RGBA レイヤに分解できる。キャラと背景の分離が難しい生成物の救済に使える **[要確認]**。[Comfy blog](https://blog.comfy.org/p/qwen-image-edit-2511-and-qwen-image)

### 3.2 影・ライティングの平坦化（delight）

- **Hy3DDelightImage**（kijai/ComfyUI-Hunyuan3DWrapper、モデル `hunyuan3d-delight-v2-0`）: 「harsh shadows and lighting を除去し照明を中立化」する。既定 50 steps / cfg_image 1.0、内部解像度 518² 程度 → 出力は低解像度なので **front の最終画像には使わず、Tripo 用テクスチャ参照や検証用** に留める **[要確認]**。[runcomfy ノード解説](https://www.runcomfy.com/comfyui-nodes/ComfyUI-Hunyuan3DWrapper/download-and-load-hy3-d-delight-model), [DeepWiki: Hunyuan3DWrapper 基本 WF](https://deepwiki.com/kijai/ComfyUI-Hunyuan3DWrapper/5.1-basic-single-image-to-3d-workflow)
- **Qwen-Image-Edit のライティング編集**: fal の「Lighting Restoration / Remove Lighting」LoRA（2509 向け、2511 でも動く可能性 **[要確認]**）は「既存の照明と影を除去し柔らかい均一光にする」用途。LoRA なしでも `Remove all shadows and directional lighting. Relight with flat, even, shadowless lighting. Keep everything else unchanged.` が有効 **[コミュニティ報告]**。[fal: lighting-restoration](https://fal.ai/models/fal-ai/qwen-image-edit-2509-lora-gallery/lighting-restoration), [Segmind: remove lighting](https://www.segmind.com/models/qwen-image-edit-plus-remove-lighting)
- 最も確実なのは**生成時にフラット光を指定**すること（§1.3）。後処理 delight は「救済策」。

### 3.3 アップスケール

- Tripo は 2048² 以上を推奨。生成解像度（~1MP）から 2 倍にする。
- スタイライズド/イラストは**保守的なアップスケーラ**が正解（「独自スタイルには conservative が最良、creative モデルはディテールを足しすぎてスタイルから外れる」: [Comfy blog: Upscaling handbook](https://blog.comfy.org/p/upscaling-in-comfyui)）。
  - 第一候補: **4x ESRGAN 系**（4x-AnimeSharp / 4x-UltraSharp / 4x_NMKD-Siax 等）を `UpscaleModelLoader` → `ImageUpscaleWithModel` → `ImageScale` で 2048 へダウン。フラットカラーが崩れず、VRAM も軽い。
  - SeedVR2（[ComfyUI docs](https://docs.comfy.org/tutorials/utility/seedvr2), [numz ノード](https://github.com/numz/ComfyUI-SeedVR2_VideoUpscaler)）は写実寄りで高品質だが、3B fp8 でも 16GB で「18GB 要る/結果がまちまち」の報告あり（block swap で回避可）。イラストには過剰。
  - SUPIR は creative 寄りで、SeedVR2 に比べ over-process しがちとの評価。本用途では非推奨。
- 順番: **背景除去 → bbox 正規化 → アップスケール**（透明部分を含めて拡大するとエッジが荒れるので、アルファは別途 `ImageScale` で nearest/lanczos 拡大するか、RGB 拡大後に再度 RMBG をかける）。

### 3.4 スケール・位置合わせ（同一スケール／中央配置）

Tripo マルチビューでは「スケールと中心を揃える」ことが品質に直結する（[Scenario: Tripo 3.1 Multi View](https://www.scenario.com/blog/tripo-31-multi-view-examples-88ebdd2)）。全身が写っている前提なら、**キャラの高さ（bbox の縦）を全ビューで同じピクセル数に揃える**のが最も簡単で正しい（横幅は side で細くなるのが正常）。

使えるノード:
- **KJNodes `ImageCropByMaskAndResize`**: マスクの bbox を検出 → `padding` を足して切り出し → 長辺を `base_resolution` にリサイズ。[ComfyUI Wiki 解説](https://comfyui-wiki.com/en/custom-nodes/ComfyUI-KJNodes/nodes/image-crop-by-mask-and-resize)
- **KJNodes `ImagePadKJ` / `ImageResizeKJv2`**: 正方形へパディング（白または透明）。
- **ComfyUI_essentials `MaskBoundingBox+`**（padding / blur、bbox 座標を返す）+ `ImageCrop` + `ImageResize+`（`pad` モード）。[InstaSD 解説](https://www.instasd.com/comfyui/custom-nodes/comfyui_essentials/maskboundingbox)
- **1hewNodes `Image Crop With BBox Mask`**（`preset_ratio` で 1:1 指定可）。[runcomfy 解説](https://www.runcomfy.com/comfyui-nodes/ComfyUI-1hewNodes/1hew-image-crop-with-b-box-mask)

手順（全ビュー共通、同じ数値を使う）:
1. RMBG でマスク取得（`mask_offset` 0-2、`mask_blur` 0-2 程度、フラットカラーなら小さめ）。
2. `MaskBoundingBox+` → bbox の高さ `h_char` を取得。
3. `ImageCrop` で bbox（+padding 16px）を切り出し。
4. 高さ基準でリサイズ: 目標 `H_target = 1800`（2048 キャンバスの ~88%）。幅は比率維持。`ImageResize+`（keep_proportion）またはスケール係数 `1800 / h_char` を `Math` ノードで計算して `ImageScaleBy`。
5. 2048×2048 の白（または透明）キャンバスに**水平中央・垂直中央**（足元を揃えたい場合は下端 124px 固定）でパディング（`ImagePadKJ` / `ImageResize+ pad`）。
6. RGB は白背景版、加えて RGBA 版を `SaveImage` で出力（Tripo は両方受け付ける）。

注意: back/side で髪や装備が front より高く/低く出ている（＝生成の不整合）場合、高さ基準で揃えると胴体スケールがずれる。目視で違和感があれば、そのビューを再生成する方が良い。

### 3.5 最終画像仕様（推奨）

- 2048×2048 PNG、被写体中央、キャラ高さ ≈ 1750-1850px、背景は純白 (#FFFFFF) または透明。
- 影・床・グラデーション背景・文字・枠線を一切含めない。
- ファイル名を `front.png / left.png / back.png / right.png` に固定し、順序ミスを防ぐ。

---

## 4. スタイル（アニメ / セル / DKC 風プリレンダ）とプロンプト言語

### 4.1 どのモデル・どの言い回しで「フラットで焼き込みやすい色」を出すか

- **セル/アニメ**: Anima（`flat color, flat shading, no shadow, simple background, white background`）または WAI Illustrious。タグ系は「陰影なし」を `flat color` で強制しやすい。Anima は NL 併用で「A-pose で腕を体から離す」といった動作指示を補える。
- **DKC 風プリレンダ CG**: 自然言語モデル（Qwen-Image-2512 / klein 9B / Krea 2）で:
  ```
  1990s pre-rendered 3D CGI character render in the style of early SGI game cutscenes, smooth plastic-like matte shading,
  rounded simple geometry, soft even ambient lighting, no specular highlights, no cast shadows, plain white background,
  full body A-pose front orthographic view
  ```
  テクスチャに焼き込むなら **specular / rim light / cast shadow / ambient occlusion の強いものを避け、`matte`, `diffuse only`, `evenly lit`** を明示する。
- Krea 2 Turbo はアニメ〜写真の美的品質重視で、キャラシート LoRA（QuadView_krea2）も存在するが文字が苦手。Z-Anime（Z-Image Base のアニメ FT、NL プロンプト）も候補。

### 4.2 自然言語 vs Danbooru タグ

| モデル | 推奨入力 | 根拠 |
|---|---|---|
| Qwen-Image / Qwen-Image-Edit / FLUX.2 klein / Krea 2 / Z-Image / Ideogram 4 | 自然言語（文）。Qwen-Image-Edit は「タグ列より文が有効」「重み付け `(x:1.5)` は非対応」 | [Zenn: Qwen-Image-Edit 2509 攻略](https://zenn.dev/rick_lyric/articles/ffd10bbb59e8b6), [Zenn: Qwen-Image-Edit を試す](https://zenn.dev/kun432/scraps/78a9ab675d2440) |
| Anima | タグ + 自然言語の混在（タグ構造: `[quality/meta/year/safety] [character count] [character] [series] [artist] [general tags]`、`@artist` 記法） | [HF Anima](https://huggingface.co/circlestone-labs/Anima) |
| WAI Illustrious / NoobAI | Danbooru タグ（小文字・スペース区切り） | [note: TNSOR_WORKS 比較](https://note.com/tnsor_works/n/n0d9ab70999f2) |

- 同一キャラ再現性はタグ系（NoobAI > Illustrious）が最も高く、Anima / Krea 2 は「雰囲気は良いが細部に解釈ぶれ」との比較（seed 777, 832×1216, LoRA なし）。
- タグ→NL 変換や逆変換は `ComfyUI-Anima-Prompt-Enhancer` 等で自動化できる（[GitHub](https://github.com/Kinglord/ComfyUI-Anima-Prompt-Enhancer)）。

---

## 5. 再現性と反復（4-8 候補 → 選択 → ビュー派生）

- **seed**: KSampler の `control_after_generate` を `fixed` にし、候補出しの間だけ `increment` にする。ComfyUI は PNG メタデータにワークフロー全体（seed・prompt・モデル名）を埋め込むので、選んだ候補の PNG を `LoadImage` するだけで設定が復元できる。[Creative-comfyUI: Understanding ComfyUI seed](https://github.com/Creative-comfyUI/seed_eng)
- **候補一括生成**: `EmptySD3LatentImage`（Qwen）/ FLUX.2 用 Empty Latent の `batch_size=4..8`。バッチ内の各画像は seed + index で決まる（`LatentBatchSeedBehavior` で `random`/`fixed` を切替可）。[ComfyUI Wiki: LatentBatchSeedBehavior](https://comfyui-wiki.com/en/comfyui-nodes/latent/advanced/latent-batch-seed-behavior)
- **選択**: コアの `ImageFromBatch`（batch_index, length）または rgthree `Image Comparer` で目視選択 → `SaveImage`。以降はその 1 枚を **front.png** として固定し、編集モデルに渡す（再生成しない）。
- **ビュー派生の抽選**: Qwen-Image-Edit 2511 側も seed を固定。back が崩れたら seed だけ変える（プロンプト・LoRA 強度は固定）。4 面のうち 1 面だけ再抽選できるのが (a) 手法の利点。
- **量子化と再現性**: fp8 / GGUF / INT8 は同 seed でも結果が変わる（Krea 2 で報告）。**途中で量子化を変えない**。Lightning LoRA は多様性を下げるので、候補出しは非 Lightning（または 8-step 版）、量産は 4-step という使い分けも有効 **[コミュニティ報告]**。
- **記録**: comfyui-mcp の `save_workflow` で候補出し WF / ビュー派生 WF を別名保存し、`get_history` で prompt_id → 出力ファイル → seed を追跡する。

---

## 6. ComfyUI ワークフロー案（ノード順・主要パラメータ）

### (A) フロントビュー候補生成

**A-1: Qwen-Image-2512（GGUF Q5_K_M または fp8）**

1. `UnetLoaderGGUF`（`qwen-image-2512-Q5_K_M.gguf`）または `UNETLoader`（`qwen_image_2512_fp8_e4m3fn.safetensors`, weight_dtype default）
2. （任意）`LoraLoaderModelOnly`: `Qwen-Image-Lightning-8steps-V*.safetensors` strength 1.0（候補出しは非 Lightning でも可）
3. `ModelSamplingAuraFlow` shift ≈ 3.1（テンプレート既定。「shift 13 で鮮明になる」という実験報告もあり **[コミュニティ報告]**）
4. `CLIPLoader`（`qwen_2.5_vl_7b_fp8_scaled.safetensors`, type `qwen_image`）→ `CLIPTextEncode` ×2（§1.3 の positive / negative）
5. `VAELoader`（`qwen_image_vae.safetensors`）
6. `EmptySD3LatentImage` 1104×1472（3:4）または 928×1664（9:16）、batch_size 4-8
7. `KSampler`: 非 Lightning = 50 steps（20-30 でも実用）, cfg 4.0, euler / simple。Lightning 8-step = 8 steps, cfg 1.0
8. `VAEDecode` → `SaveImage`（`front_candidates/`）
9. 選択後: `LoadImage` → `ImageFromBatch` 不要（PNG 単体）→ front.png 確定

**A-2: FLUX.2 klein 9B fp8（高速版・既存環境）**

1. `UNETLoader`（`flux-2-klein-9b-fp8.safetensors`）
2. `CLIPLoader`（`qwen_3_8b_fp8mixed.safetensors`, type `flux2`）→ `CLIPTextEncode`（positive のみ。distilled は CFG 1 のため negative 不要）
3. `VAELoader`（`flux2-vae.safetensors`）
4. FLUX.2 用 Empty Latent（テンプレートに従う。16 の倍数、1024×1344 など）batch_size 8
5. `KSampler`: 4 steps, cfg 1.0, euler / simple（base 版を使うなら 20 steps, cfg 4-5）
6. `VAEDecode` → `SaveImage`
- klein は編集も同モデルで可能なので、選んだ候補の微修正（「背景を純白に」「影を消す」「腕をもう少し体から離す」）を `VAEEncode(front)` → `ReferenceLatent` → 同じサンプラで行える。

**A-3（アニメ）: Anima base v1 / WAI Illustrious** — §1.3 のタグ prompt、Anima は 30-50 steps / CFG 4-5 / er_sde、832×1216。

### (B) 選んだ front から back/left/right を派生（Qwen-Image-Edit 2511 GGUF Q5_0 + Lightning 4-step + Multiple-Angles LoRA）

既存ターンアラウンド WF に **Multiple-Angles LoRA を 1 段追加**し、プロンプトを `<sks>` 形式に置き換えるだけ。

1. `LoadImage`（front.png、白背景版）→ `ImageScaleToTotalPixels` 1.0 MP（Qwen-Edit は入力を ~1MP に正規化する。[ComfyUI docs](https://docs.comfy.org/tutorials/image/qwen/qwen-image-edit)）
2. `UnetLoaderGGUF`（`qwen-image-edit-2511-Q5_0.gguf`）
3. `LoraLoaderModelOnly` ①: `Qwen-Image-Edit-2511-Lightning-4steps-V1.0-bf16.safetensors` strength 1.0
4. `LoraLoaderModelOnly` ②: `Qwen-Image-Edit-2511-Multiple-Angles-LoRA`（~295MB） strength 0.8-1.0
5. `ModelSamplingAuraFlow` shift 3.0（テンプレート既定値に合わせる）
6. `CLIPLoader`（`qwen_2.5_vl_7b_fp8_scaled`, type `qwen_image`）、`VAELoader`（`qwen_image_vae`）
7. `TextEncodeQwenImageEditPlus`（clip, vae, image1=front）positive:
   - back: `<sks> back view eye-level shot medium shot`
   - left: `<sks> left side view eye-level shot medium shot`
   - right: `<sks> right side view eye-level shot medium shot`
   - 必要なら末尾に `, same A-pose, full body visible, plain white background, flat lighting` を追記（LoRA 語彙の後ろに置く）**[コミュニティ報告]**
   negative: `" "`（空白）
8. `VAEEncode`（front）→ latent
9. `KSampler`: 4 steps, cfg 1.0, euler / simple, denoise 1.0, seed 固定
10. `VAEDecode` → `SaveImage`（`views/back.png` 等）
11. （任意・整合強化）side 生成時に `TextEncodeQwenImageEditPlus` の image2 に生成済み back.png を追加し、「image1 is the front view and image2 is the back view of the same character; render the left side view」と書く **[要確認]**
12. 3 ビューを `NickPittas/ComfyUI_CameraAngleSelector` の `selected_angles` 出力で一括指定し、`ImageBatch` で並列生成することも可能。

LoRA なし版（既存 WF そのまま）は §2.2 の preserve 型プロンプトを使用。

### (C) MV-Adapter i2mv（ComfyUI-MVAdapter）で 4 面同時生成

VRAM が 13-14GB 必要なので、他モデルをアンロード（comfyui-mcp `clear_vram`）してから実行。

1. `LoadImage`（front.png）→ `RMBG`（BiRefNet-HR / Lucida、background=white）→ `ImageCropByMaskAndResize`（padding 32, base_resolution 768）→ 正方形パディング 768×768（MV-Adapter の前処理は「背景除去 + 中央配置」が前提）
2. ComfyUI-MVAdapter のローダ: diffusers 形式なら `Diffusers Model Makeup`（SDXL base 1.0 + `madebyollin/sdxl-vae-fp16-fix`）、LDM 形式（Illustrious 等の SDXL チェックポイント）なら `Ldm*Loader`（`upcast_fp32` 調整が必要）
3. MV-Adapter アダプタ読み込み（`mvadapter_i2mv_sdxl.safetensors`）
4. `View Selector`: `front, right, back, left`（beta アダプタは 2/3/4 ビューが最良、`num_views` は未使用）
5. i2mv サンプラ: 50 steps, guidance 3.0, reference_conditioning_scale 1.0, negative `watermark, ugly, deformed, noisy, blurry, low contrast`（公式スクリプト既定）
6. 出力 4 枚 → `RMBG` → §3.4 の bbox 正規化 → 2048² へ ESRGAN アップスケール
- 正確なノード名は同梱の `workflows/*.json`（i2mv / view-selector 例）に従う。i2mv アダプタは「beta」表記で品質は SDXL 相当。スタイライズドキャラでの実績は未確認 **[要確認]**。
- 代替: Tripo `image-to-multiview` API（クラウド）、または Hunyuan3D-2mv（ローカル 3D 側で front/left/back を直接受ける）。

### (D) 共通後処理（全ビュー）

`LoadImage` → `RMBG`（Lucida / BiRefNet-HR, background=white, mask も出力）→ `MaskBoundingBox+` → `ImageCrop` → 高さ基準リサイズ（`ImageResize+` keep_proportion, height=1800）→ `ImagePadKJ`（2048×2048, 中央, 白）→ `UpscaleModelLoader(4x-AnimeSharp)` は必要なら **リサイズ前**に適用 → `SaveImage`（RGB 白背景）+ `JoinImageWithAlpha` → `SaveImage`（RGBA）。

---

## 7. 既存資産との整合・追加インストール

| 既存 | そのまま使う | 追加するもの |
|---|---|---|
| Qwen-Image-Edit 2511 GGUF Q5_0 + Lightning 4-step ターンアラウンド WF | (B) の骨格 | `fal/Qwen-Image-Edit-2511-Multiple-Angles-LoRA`（`download_model`）、任意で `ComfyUI_CameraAngleSelector`（`install_custom_node`） |
| FLUX.2 klein 9B fp8 | (A-2) 候補出し・front 微修正 | `Alissonerdx/CharacterSheet` の `TripleView_klein9b_v1.safetensors` + 同梱 WF（セカンドオピニオン用）。任意で RefControl pose LoRA（A-pose を DWPose 骨格で強制したい場合、9B **base** 推奨） |
| Anima / WAI Illustrious | (A-3) アニメ front 候補 | なし（必要なら `ComfyUI-Anima-Prompt-Enhancer`） |
| comfyui-mcp | `install_custom_node`, `download_model`, `create_workflow`→`validate`→`enqueue_workflow`, `clear_vram`, `get_history` | `ComfyUI-RMBG`（1038lab）、`ComfyUI-KJNodes`、`ComfyUI_essentials`、（C を試すなら）`ComfyUI-MVAdapter`、（delight を試すなら）`ComfyUI-Hunyuan3DWrapper` |
| 未導入（追加候補） | — | Qwen-Image-2512 GGUF Q5_K_M（`unsloth/Qwen-Image-2512-GGUF` 等）+ `Qwen-Image-Lightning-8steps`、4x-AnimeSharp |

VRAM 運用: Qwen-Edit 2511 Q5_0 + Qwen2.5-VL 7B fp8 の組合せは 16GB で動作中。Qwen-Image-2512 Q5_K_M（~15GB）は TE と同時常駐できないため、ComfyUI 標準のスマートオフロードに任せるか `--reserve-vram` / `--cache-none` を検討（comfy:comfyui-launch-flags スキル参照）。MV-Adapter 実行時は他モデルを必ずアンロード。

---

## 8. 未確定事項・注意点まとめ

- ~~Tripo が受け取る left/right~~ → **解決済み**。§9.1。
- fal Multiple-Angles LoRA の `left side view` / `right side view` は **seed 次第で向きが反転する**。同じプロンプトで両方とも同じ側面が出ることもある → 向き指定に使えない。片側生成 → 水平反転で対を作る。§9.1
- **二面顔（Janus problem）**: フードで顔が隠れるキャラで後頭部にも顔が生成される。入力 4 面をどう整えても再現 **[未解決]**。§9.2
- Multiple-Angles LoRA と Lightning 4-step の併用はテンプレート/チュートリアルで一般的だが、品質低下の有無は自環境で A/B すること **[コミュニティ報告]**。
- MV-Adapter i2mv のスタイライズドキャラ品質、および 768² 出力の Tripo 適性は未検証 **[要確認]**。
- RMBG-2.0 のライセンス（非商用）と FLUX.2 klein 9B / Ideogram 4 / Anima の非商用条項に注意（生成画像の商用可否はモデルごとに異なる）。
- Qwen-Image-Edit 2511 は 2509 比で「大幅に一貫性向上」だが「まだ問題は残る」（Diffusion Doodles）。back の細部（背中の装飾、髪の結び目）はデザイン段階で**front から推測可能な形にしておく**（＝デザイン側の工夫）と破綻が減る **[コミュニティ報告]**。

---

## 推奨パイプライン（Tripo-ready 4 面図）

1. **候補出し（front）** — Qwen-Image-2512（GGUF Q5_K_M, 3:4, batch 4-8, seed increment）または klein 9B fp8（4 steps, batch 8）。プロンプトは §1.3 の A-pose 制約列挙型 + 「orthographic front view, flat shadowless lighting, plain white background, full body with margin」。アニメ調は Anima / WAI（タグ + `multiple views, reference sheet` をネガティブ）。
2. **選定・微修正** — 目視で 1 枚選び front.png として固定。必要なら klein（`ReferenceLatent` 編集）または Qwen-Edit 2511 で「背景純白化 / 影除去 / 腕の角度修正」を preserve 型プロンプトで 1 項目ずつ実施。
3. **ビュー派生** — 既存の Qwen-Image-Edit 2511 Q5_0 + Lightning WF に **fal Multiple-Angles LoRA（0.8-1.0）** を追加し、`<sks> left side view eye-level shot medium shot` / `<sks> back view ...` / `<sks> right side view ...` を同一 distance 語で生成（4 steps, cfg 1, seed 固定）。崩れたビューだけ seed を変えて再抽選。back が安定しないときは klein 9B + CharacterSheet TripleView LoRA で back 候補を作り差し替え。
4. **クリーンアップ** — ComfyUI-RMBG（Lucida / BiRefNet-HR, white + alpha）→ `MaskBoundingBox+` / `ImageCropByMaskAndResize` で bbox 切り出し → **キャラ高さ 1800px に統一** → 2048×2048 中央パディング → 4x-AnimeSharp 等の保守的 ESRGAN で解像度確保（必要時）。影が残るなら Qwen-Edit「flat even lighting」編集、または Hy3DDelightImage（低解像度に注意）。
5. **書き出し・投入** — `front.png, left.png, back.png, right.png`（2048², 白 or 透過 PNG）を Tripo multiview-to-model（`[front, left, back, right]`、`texture_alignment: original_image`、`enable_image_autofix` は最初は off）へ。ComfyUI 内から完結させるなら `TripoMultiviewToModelNode`。
6. **フォールバック** — 4 面の整合が取れない複雑なキャラは、front.png のみを Tripo `image-to-multiview` に渡して 4 面を作らせ、それを multiview-to-model に投入する。ローカル完結なら Hunyuan3D-2mv（front/left/back）。

---

## 9. 実測ログ — scavenger（2026-09-06）

ComfyUI 4 面 → Tripo `multiview-to-model`（`v3.1-20260211`, `texture_quality: detailed`, `orientation: align_image`）→ rig → retarget を実行した記録。

実測クレジット: multiview（HD テクスチャ込み）40 / auto rig 25 / retarget 10 per animation / image-to-multiview 10。

### 9.1 Tripo の left/right 定義 **[確定]**

`image-to-multiview` に front.png を投入（10 credits）、出力 4 面を目視:

- `left_view` = キャラ **画面左**向き
- `right_view` = キャラ **画面右**向き
- `back_view` = 真後ろ。フードのキャラなら後頭部（顔なし）

カメラ位置（キャラの左側にカメラ）で考えると混乱する。**絵の中でキャラがどっちを向くか**で覚える。

fal Multiple-Angles LoRA の `<sks> left side view` / `<sks> right side view` は **seed 次第で向きが反転**。同一プロンプトで両方とも同じ側面が出た実例あり → 向き指定に使えない。**片側だけ生成 → `sharp().flop()` で水平反転**して対を作るのが確実。装備の左右は反転するが、front/back が真値を持つので実害は小さい（`src/stages/views.ts` はこの方式）。

### 9.2 二面顔（Janus problem）**[解決済み — 入力の出所が原因]**

> **結論（2026-09-07 訂正）**: 原因は **left / right の取り違え**。自前の 4 面は left.png がキャラを画面右に向け、right.png が画面左に向けていた（Tripo と逆）。左右を入れ替えると二面顔も back 無視も消える。**「Tripo 自身が作った画像でないと効かない」は誤りだった** — §9.6 の実験 A が通ったのは出所ではなく向きが正しかったからで、同じ 4 面でも左右が逆なら失敗する（実験 B / C）。詳細は §9.6。

以下は原因を潰していった記録。

症状: フード + フルフェイスガスマスクのキャラで **後頭部にも顔が生成**。フードを貫通。足首も捻れてブーツが変形。

切り分け済み（**すべて原因ではない**）:

| 疑い | 検証方法 | 結果 |
|---|---|---|
| left/right の入れ替わり | LoRA 出力そのまま / 左右逆 / ミラー の 3 通りで生成 | **全部 同じ症状** |
| 4 面のスケール・位置ズレ | 非白ピクセルの bbox を実測 | 被写体高さ 971-978px（±7px）。Tripo 自身の出力（±25px）より整合が良い |
| 入力画像の作りが悪い | `image-to-multiview` の Tripo 製 4 面と比較 | 構図・向き・背景ほぼ同一。back も同じくフードで顔なし |

→ **入力側に原因なし。`multiview-to-model` の再構成側**（「頭には顔がある」プライアが back view を上書き）。

未検証の対策:

- `model_seed` を変えて再抽選（20 credits / 回、`--draft`）
- `geometry_quality: detailed`（+20 credits）
- `P1-20260311`（別アーキテクチャ、ゲーム向けローポリ、multiview 対応）
- **デザイン側で回避** — フードで顔が隠れる構造そのものが Janus を誘発。8 方向スプライトは後頭部が必ず映る → **フードなしデザインが安全**
- Blender で後頭部の顔を手動削除（1 体だけなら最速）

### 9.3 出力メッシュ **[確定]**

`face_limit` 未指定・v3.1 の実測: **1,445,404 面 / 749,288 頂点 / 4K テクスチャ 3 枚（Color / NormalGL / ORM）**、GLB 43MB。スプライトレンダには過剰。

- 生成時の `face_limit` は **課金なし**（[API 価格表](https://developers.tripo3d.ai/en/pricing)のアドオン一覧に無い）
- `smart_low_poly: true` は **+10 credits**、face_limit は 500-20000 に制限。「複雑な入力では失敗することがある」と公式注記
- 後処理の Retopology は 30（v2.0 Smart）/ 10（v1.0 Basic）credits → **生成時にやる方が安い**。かつ **メッシュ編集はリグを消す**ので、どのみち生成時が正解

出力モデルは **+X が正面**（`glTF は -Y 向き` の常識が通らない）。tripo-cli の convert デフォルトも `export_orientation: '+x'` で一致。`c3d render --facing` で吸収する。

### 9.4 リグ **[未解決]**

`spec: "mixamo"` を送信 → **サーバは受理**（`tripo task get <id>` の `input.spec` に `"mixamo"` が残る）。だが rig `v2.5-20260210` の出力ボーンは:

```
tripo::Root, tripo::Spine_0, tripo::Head_0, tripo::Head_1,
tripo::0_Right_Limb_0 … tripo::1_Left_Limb_2,
bone_7 … bone_22（命名なしが 18 本）  ← 計 32 本
```

**mixamo 命名にならない。**

[公式 rig ドキュメント](https://developers.tripo3d.ai/en/docs/animations-rig)は spec とリグ版の対応を書いていない。`v1.0-20240301` = biped 専用・90+ プリセット（旧世代）、`v2.5-20260210` = 非人型対応の新スケルトン。**mixamo 命名は v1.0 側の機能の可能性** **[未検証、25 credits]**。

[StraySpark の実測](https://www.strayspark.studio/blog/ai-auto-rigging-showdown-2026-tripo-meshy-cascadeur-mixamo)では「ボーン名は認識可能な規約に従う」「UE の Manny/Quinn に近く、retarget は足ボーンのオフセット程度の微調整で済んだ」。弱点として肩・胸のウェイトが過度に滑らかで腕上げ時にメッシュが垂れる、顎のウェイトがノイジー。

### 9.5 ツール **[確定]**

`tripo-cli`（npm、グローバル）は薄いラッパではなく、`dist/knowledge/*.js` にサーバ側バリデーションを写したドメイン知識を持つ。`tripo docs --llm` の SKILL は `.claude/skills/tripo-cli/SKILL.md` にコピー済み。

そこから拾った、公式ドキュメントに散っている事実:

- `retarget` は `animations` 配列で **1 タスクに最大 5 モーション**（課金はモーション単位で不変）
- convert の `export_orientation` は `+x` / `-x` / `+y` / `-y`、**デフォルト `+x`**
- convert の非デフォルト引数は "complex convert" 課金ティア（`pivot_to_center_bottom: true` も該当）
- `quad: true` は **出力を FBX に強制**（quad は glTF に格納できない）
- P1 は `quad` / `smart_low_poly` / `generate_parts` / `geometry_quality` 非対応、`face_limit` は 50-20000
- rig のサーバ側デフォルトは v1.0（biped プリセットのみ）。v2.5 を使うなら明示指定が必要

### 9.6 決定実験 — left / right の取り違え（2026-09-06 〜 07）

同じ `front.png` から出発し、side / back を **誰が作ったか**だけを変えて `multiview-to-model` を 2 回実行（両方 `--draft --seed 20260906`、各 20 credits）。

すべて `--draft --seed 20260906`、各 20 credits。

| # | 投入した 4 面 | side の向き | 結果 |
|---|---|---|---|
| A | すべて Tripo `image-to-multiview` 製 | 正しい | **成功**（背面にX字、顔なし） |
| B | back だけ Tripo 製、front/left/right は自前 | **逆** | 失敗（二面顔、X字が前面に出る） |
| C | front + back + right の 3 枚、すべて自前 | **逆** | 失敗（同上） |
| D | 自前 4 面、**left と right を入れ替え** | 正しい | **成功**（背面にX字、顔なし） |

A だけが通ったので当初は「Tripo 製の画像でないと効かない」と結論したが、**誤り**。A の side は画面左/右を正しく向いており、B・C の side は逆だった。出所ではなく向きが効いていた。

**判定は目視に頼らないこと。** 3 回向きを直して 3 回とも外した。`facesRight()`（`src/stages/views.ts`）が頭部帯と胴体帯の重心 x を比べて機械的に判定する。実測:

```
自前  left : faces RIGHT   ← 逆
自前  right: faces LEFT    ← 逆
Tripo left : faces LEFT    ← 正
Tripo right: faces RIGHT   ← 正
```

**正しい向き**: `left.png` = キャラが画面**左**を向く（キャラの左半身がカメラ側、90°）。`right.png` = 画面**右**（270°）。

潰した仮説（すべて原因ではない）:

| 仮説 | 検証 | 結果 |
|---|---|---|
| EXIF / メタデータに方位情報 | ExifTool で両方ダンプ | Tripo 製は JFIF ヘッダのみ、自前は pHYs のみ。**空** |
| アップロード経路・署名付き URL | 実験 A を `file_token` アップロードで実施 | **無関係**（効いた） |
| PNG / JPEG の違い | 実験 A は PNG に変換して投入 | **無関係** |
| 背景の純度 | ピクセル統計 | 自前 255 純白 / Tripo 254（JPEG ノイズ）。**自前の方がきれい** |
| 被写体のスケール・位置 | bbox 実測 | 自前 ±7px / Tripo ±25px。**自前の方が揃っている** |

#### 9.6.1 結論

**ComfyUI 製の 4 面で問題なく通る。`image-to-multiview` に 10 credits を払う必要はない。** 実験 D（自前 4 面の left/right を入れ替えただけ）が A と同等の結果を出した。

left / right が逆だと Tripo は 90° と 270° に矛盾する側面を与えられ、顔をどちらに置くか決められずに両側へ作る。これが二面顔の正体で、back が無視されて見えたのも同じ原因（座標系が破綻するので back の情報を置く先がない）。フードもガスマスクも Janus も関係なかった。

検証費用: 実験 A-D で 80 credits + `image-to-multiview` 10 credits。**目視で向きを判定して 3 回連続で外したのが遠回りの原因**なので、`facesRight()` を通して機械的に決める。

### 9.7 SDK の型を信じると外す点 **[確定]**

`@vastai/tripo-sdk` の型定義にあるが v3 の実際の API と食い違うもの:

- **`MultiviewToModelParams.original_task_id`** — サーバは 400 `code=1004 files or inputs are required for multiview_to_model` で拒否。ドキュメントの「`files` と排他」という記述も現行 API では機能していない。`image-to-multiview` の結果を使うなら **出力 URL を `files` に渡す**
- **`generate_multiview_image` の出力 URL のネスト** — `output.front_view_url` ではなく `output.generate_multiview_image.front_view_url`。`left` / `back` / `right` も同様
- `toFileDescriptor` は `http(s)://` で始まる文字列を `{url}`、それ以外を `{file_token}` として送る（`src/utils.js:33`）。URL をそのまま `files` に入れてよい

### 9.8 Bun の落とし穴 **[確定]**

`Bun.write(path, Response)` は 42MB の GLB で **CPU 1 コアを 100% 占有したまま無限に回る**（bun 1.3.14 / Windows）。curl は同じ URL を数秒で取得。**タスクはサーバ側で成功しクレジットも消費済み**なので、ハングに見えて金だけ払う経路になる。`await res.arrayBuffer()` を挟んで回避（`src/lib/tripo.ts`）。

kill しても bun の子プロセスが残り、出力ディレクトリを掴んで `mv` が `Device or resource busy` で失敗する。プロセスを明示的に落とすこと。
