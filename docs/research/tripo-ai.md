# Tripo AI (tripo3d.ai) 調査メモ

- 調査日: 2026-09-06
- 対象: Tripo Studio (Web アプリ) / Tripo API v3 / 公式 SDK・プラグイン / 料金 / 利用規約
- 情報源の優先順位: 公式 (tripo3d.ai, developers.tripo3d.ai, platform.tripo3d.ai, docs.tripo3d.ai, GitHub VAST-AI-Research, npm / PyPI レジストリ) > サードパーティのレビュー記事
- 凡例: **[確認済]** = 一次情報で確認、**[推定]** = 複数情報からの推測、**[未確認]** = サードパーティ記事のみで公式に確認できず

---

## 1. Tripo AI とは (初心者向け)

Tripo は VAST (法人名 Holymolly Ltd, 香港) が運営する生成 AI 3D プラットフォーム。ブラウザで使う **Tripo Studio** と、開発者向けの **Tripo API** の 2 系統がある。GitHub 組織は `VAST-AI-Research` (研究チーム名)。
- 出典: https://github.com/VAST-AI-Research 、https://www.tripo3d.ai/terms

### 1.1 Web アプリ (Tripo Studio) の基本フロー **[確認済]**

1. **入力を選ぶ**
   - Text-to-3D: テキストプロンプト (最大 1024 文字)
   - Image-to-3D: 画像 1 枚 (PNG/JPEG/WebP、20 MB まで)
   - Multiview-to-3D: 前・左・右・後の最大 4 枚 (有料プラン向け機能)
   - 画像がない場合は Studio 内の Image Generation (Nano Banana / GPT Image / Midjourney 等の外部モデル) でコンセプト画を作り、それを多視点画像に展開してから 3D 化できる
2. **モデル系統を選ぶ**
   - **High Detail Model (H シリーズ、現行 H3.1)**: 最大 ~200 万ポリゴンの高精細メッシュ + PBR テクスチャ。レンダリング・3D プリント向け
   - **Smart Topology Mesh / Smart Mesh (P シリーズ、P1.0 / P2.0 Preview)**: 約 2 秒で生成されるゲームエンジン向けのクリーンな低ポリメッシュ。P2.0 Preview はネイティブ quad トポロジー
3. **生成 → ワークスペースで後処理** (テクスチャ生成、セグメンテーション、リトポロジー、リギング、アニメーション付与)
4. **エクスポート**
- 出典: https://www.tripo3d.ai/blog/tripo-p2-0-preview (Studio の導線 "3D Workspace -> Smart Topology Mesh -> P2.0 Preview")、https://www.tripo3d.ai/pricing (プラン比較表の機能名)、https://kingy.ai/news/tripo-ai-the-all-in-one-ai-3d-workspace-that-might-actually-change-how-we-build-3d-content/ (2026-04 レビュー)

### 1.2 出力形式 **[確認済]**

- 生成直後の標準出力は **GLB** (PBR: base_color / metallic / roughness / normal)。`quad: true` を指定すると出力は **FBX** に強制される
- 変換 API (`/v3/models/convert`) で **GLTF / GLB / USDZ / FBX / OBJ / STL / 3MF** へ変換可能。テクスチャ形式は JPEG / PNG / WEBP / BMP / DPX / HDR / OPEN_EXR / TARGA / TIFF、`fbx_preset` に `blender` / `3dsmax` / `mixamo` / `bake_scale`
- 出典: https://developers.tripo3d.ai/en/docs/generation-image-to-model 、https://developers.tripo3d.ai/en/docs/models-convert 、https://docs.tripo3d.ai/export/conversion.html

### 1.3 後処理機能一覧

| 機能 | 内容 | API での対応 | 出典 |
|---|---|---|---|
| Auto Rigging | 自動でスケルトンとスキンウェイトを付与。`rig_type`: biped / quadruped / hexapod / octopod / avian / serpentine / aquatic。ボーン命名は `tripo` (既定) か `mixamo` 互換 | `POST /v3/animations/rig-check` (無料) → `POST /v3/animations/rig` | https://developers.tripo3d.ai/en/docs/animations-rig 、https://developers.tripo3d.ai/en/docs/animations-rig-check |
| Animation presets | リグ済みモデルにプリセットモーションを適用。Rig v1.0 (biped 専用) は "90+ presets"、Rig v2.5 は biped 11 種 + 四足/六足/八足/蛇/水棲の各 walk/march。API ページでは "100+ preset motions, up to 5 per batch" | `POST /v3/animations/retarget` (`animations` は最大 5 件) | https://developers.tripo3d.ai/en/docs/animations-retarget 、https://developers.tripo3d.ai/ja |
| Retopology / Quad mesh | v2.0 "Smart Retopology" (P 系 AI でクリーンなトポロジーを再構築、30 credits) と v1.0 basic decimation (10 credits)。三角 500–20,000 / quad 500–10,000 面 | `POST /v3/mesh/decimate` (`model: v2.0 or v1.0`, `quad`, `bake`, `part_names`) | https://developers.tripo3d.ai/en/docs/mesh-decimate |
| Smart Low Poly (生成時オプション) | 生成時に `smart_low_poly: true` で手作業風の低ポリトポロジーを直接生成 (+10 credits)。複雑な入力では失敗することがある | 生成エンドポイントのフラグ | https://developers.tripo3d.ai/en/docs/generation-image-to-model |
| Texture / Texture upscaling | `texture_quality`: standard / detailed / **extreme (8K)**。既存モデルの再テクスチャは `/v3/models/texture` (text / image / style_image プロンプト、`part_names` で部位指定)。Studio では 2026-05-29 に "8K Texture / Upscale" 機能を告知 | `POST /v3/models/texture` | https://developers.tripo3d.ai/en/pricing 、https://docs.tripo3d.ai/texture/texture-model-v3-0-20250812.html 、https://www.tripo3d.ai/blog/tripo-p2-0-preview (関連記事欄) |
| Stylization | Studio: clay / voxel / low-poly / cartoon / hologram 等の表示・変換モード **[未確認: レビュー記事]**。API v2 には `stylize_model` (lego / voxel / voronoi / minecraft、20 credits) があるが、**v3 のエンドポイント一覧には stylize が無い** | v2 のみ (`stylize_model`) | https://platform.tripo3d.ai/docs/billing ("Post Stylization 20")、https://github.com/VAST-AI-Research/tripo-python-sdk/blob/master/docs/API.md 、https://developers.tripo3d.ai/en/docs (v3 一覧) |
| Segmentation / Parts | Mesh Segmentation v1.0 (2025-05-06) / v2.0 (2026-04-30 Beta、`segmentation_granularity`: simple / balanced / detailed、`split_by_connectivity`、`ref_image`)。Studio では "Segmentation v2" を 2026-05-27 に告知。パーツ補完 `/v3/mesh/complete` もある。生成時に `generate_parts: true` でパーツ分割済みモデルを直接生成 (texture=false, pbr=false 必須) | `POST /v3/mesh/segment`, `POST /v3/mesh/complete` | https://developers.tripo3d.ai/en/docs/mesh-segment 、https://developers.tripo3d.ai/en/docs/generation-image-to-model |
| Magic Brush / Part-based edit | Studio 内で部位単位のテクスチャ編集・変形・リトポ (プラン比較表の "Part-based Transform / Retopology / Texture Edit", "Texture Edit with Magic Brush") | Studio のみ | https://www.tripo3d.ai/pricing |

---

## 2. 料金

### 2.1 Tripo Studio サブスクリプション **[確認済: 公式 pricing ページを 2026-09-06 に取得]**

公式ページ https://www.tripo3d.ai/pricing (USD 表示) の内容。プラン名は **Free / Pro / Max / Team** の 4 段階。

| 項目 | Free | Pro | Max | Team |
|---|---|---|---|---|
| 月額 (月払い) | $0 | $20.00 | $90.00 | $110.00 / seat |
| 年払い | $0 | $240.00 / 年 | $1,080.00 / 年 | $1,980.00 / 年 ($55 / 月 / seat 相当、"50% off" 表示) |
| 月間クレジット | 200 (≈13 models) | 3,000 (≈200 models、$0.16/model) | 25,000 (≈1,660 models、$0.09/model) | 90,000 (≈6,000 models) |
| 同時タスク数 | 1 | 10 | 100 | 200 |
| キュー優先度 | Standard | High Priority | Dedicated Priority | Dedicated Priority |
| モデル公開/商用 | **Public Models · Non-Commercial Use** | Private Models · Commercial Use | Private · Commercial | Private · Commercial |
| 編集履歴 | 1 日 | 7 日 | 永続 | 永続 |
| 無料リトライ | 3 | Unlimited | Unlimited | Unlimited |
| モデル保存数 | 10 | Unlimited | Unlimited | Unlimited |
| エクスポート | 15 回 (H2.5 のみ) | Unlimited | Unlimited | Unlimited |
| バッチ生成 | - | 10 | 30 | 30 |
| Free Pro Refine | - | - | 3 | - |
| Multi-view to 3D / Ultra Mesh / Smart Low Poly / Rigging & Animation | 制限あり (表では Free 列に印なし) | ○ | ○ | ○ |
| 8K Texture | Limited | Limited | Unlimited | Unlimited |
| Smart Segmentation | Limited | Unlimited | Unlimited | Unlimited |
| DCC Bridge (Blender, 3ds Max, Unity, Unreal, Maya, Cocos, Godot, ZBrush) | - | ○ | ○ | ○ |
| 画像生成 | Nano Banana のみ | 全ツール (20 free/day + 80% off) | 全ツール (Free) | 全ツール (Free) |

注意点:
- ページには "Annually 50% off" のトグルがあるが、取得時の表示では Pro / Max は月払いと年払いの月額換算が同額 ($20, $90) で、50% 引きが明示されていたのは Team ($110 → $55) のみ。**表示価格は地域・キャンペーン (新規 50% off 初月クーポン等) で変わる可能性あり [推定]**。
- サードパーティ記事では旧構成の **Basic / Professional ($19.90) / Advanced ($49.90) / Premium ($139.90)** や、年払い $13.93 などの数字が多数残っている (例: https://tripo3ds.com/pricing/ 2026-07、https://toolradar.com/tools/tripo-ai/pricing 2026-09 は $15.9 / $39.9 / $111.9)。**2026-09 時点の公式ページは Free / Pro / Max / Team** であり、旧数字は改定前のものと判断 **[推定]**。
- **ウォーターマーク**: 公式 pricing ページ・規約にウォーターマークの記述は見つからなかった。Free の制限は「公開モデル・非商用・エクスポート回数制限」という形 **[確認済: 記述なし]**。

Studio 追加クレジット購入 (同ページ): $10 = 1,000 credits / $100 = 10,000 + 2,000 / $500 = 50,000 + 12,000 / $1,000 = 100,000 + 30,000。

Studio 側の操作別クレジット (同ページ FAQ 表):

| 操作 | クレジット | アドオン |
|---|---|---|
| HD Generate | 15 | Ultra +15, Generate in Parts +30, Texture Gen +10, HD Texture +10, Quad +5 |
| Smart Mesh | 35 | Smart Mesh P2.0 +65 |
| Segmentation | 5 | Part Completion +5 / part |
| Retopology | 5 | Quad +5, Smart Lowpoly +30 |
| Texture Gen | 10 | Style Reference +5, PBR +5, HD Texture +10 |
| Auto Rig | 20 | - |

### 2.2 Tripo API 料金 **[確認済]**

- **1 credit = $0.01 USD (100 credits = $1)**。前払い pay-as-you-go。**購入クレジットは失効しない**。失敗タスクは frozen → available に自動返金。返金不可。
  - 出典: https://developers.tripo3d.ai/en/pricing 、https://platform.tripo3d.ai/docs/billing (FAQ)
- 新規開発者向け無料クレジット: "300 free credits in 2 weeks" (2 週間有効)
  - 出典: https://docs.tripo3d.ai/get-started/pricing.html
- **API クレジットと Studio クレジットは別会計 [推定]**: API 側は platform / developers サイトの独立したウォレット (Recharge / Wallet) で管理される。公式 FAQ に「Studio サブスクがあれば API を使えるか?」という設問があるが回答本文は取得できなかった。複数のサードパーティ記事は「API は別ビジネスラインで別課金」と明記 (https://tripo3ds.com/pricing/ 、https://costbench.com/software/ai-3d-generation/tripo-ai/)。
- エンタープライズ: business@tripo3d.ai でボリュームディスカウント

**API 操作別クレジット表 (developers.tripo3d.ai/en/pricing、2026-09-06 取得)**

| カテゴリ | 操作 | credits | USD |
|---|---|---|---|
| 3D 生成 (H シリーズ: v3.1 / v3.0 / v2.5 / v2.0 / Turbo) | Text to 3D | 10 (無テクスチャ) / 20 (標準テクスチャ) | $0.10 / $0.20 |
| | Image to 3D | 20 / 30 | $0.20 / $0.30 |
| | Multiview to 3D | 20 / 30 | $0.20 / $0.30 |
| 3D 生成 (P1.0、v2 billing ページより) | Text to 3D | 30 / 40 | $0.30 / $0.40 |
| | Image to 3D | 40 / 50 | $0.40 / $0.50 |
| | Multiview to 3D | 40 / 50 | $0.40 / $0.50 |
| 生成アドオン (加算) | HD Texture (`texture_quality=detailed`) | +10 | |
| | 8K Ultra Texture (`texture_quality=extreme`) | +20 | |
| | HD Geometry (`geometry_quality=detailed`) | +20 | |
| | Quad Mesh (`quad=true`) | +5 | |
| | Smart Low-poly (`smart_low_poly=true`) | +10 | |
| | Generate Parts (`generate_parts=true`) | +20 | |
| | Style (`style`、v2 のみ記載) | +5 | |
| モデル処理 | Texture Standard / HD / 8K Ultra | 10 / 20 / 30 | $0.10–0.30 |
| | Format Convert Basic / Advanced | 5 / 10 | |
| | Retopology v2.0 Smart / v1.0 Basic | 30 / 10 | $0.30 / $0.10 |
| | Segmentation | 40 | $0.40 |
| | Smart Segmentation (Image / Model) | 85 / 55 | |
| | Part Completion Default / Quick Cap | 50 / 30 | |
| | Post Stylization (v2 のみ) | 20 | |
| アニメーション | Rig Check | 無料 | |
| | Auto Rig | 25 | $0.25 |
| | Animation Retarget | 10 / animation | $0.10 |
| 画像生成 | Text to Image, generate_image 各種 | 5–20 (モデル・解像度で変動) | |

注意: v2 の billing ページ (platform.tripo3d.ai/docs/billing、changelog 2026-06-03) では texture 品質のサーチャージが "standard +10, detailed +20, extreme +30" と書かれており、developers.tripo3d.ai の "HD +10, 8K +20" と**数字がずれている**。v3 で課金する場合は developers.tripo3d.ai の表を正とし、実際の `credits_consumed` で検証すること **[要検証]**。

Format Convert が Advanced (10) になる条件: `quad`, `face_limit`, `flatten_bottom`, `flatten_bottom_threshold`, `texture_size`, `texture_format`, `pivot_to_center_bottom`, `scale_factor` のいずれかに非既定値を指定した場合。
- 出典: https://developers.tripo3d.ai/en/pricing

### 2.3 API と Web の違いまとめ

| 観点 | Studio (Web) | API |
|---|---|---|
| 課金 | 月額サブスク + 追加パック | 従量 (1 credit = $0.01)、失効なし |
| 商用利用 | Pro 以上 | 有料ユーザー扱い (規約 5.2.2) **[推定]**、公式ブログは "API outputs carry commercial rights" と記載 **[未確認: ブログ本文は 403 で未取得]** |
| 同時実行 | プラン依存 (1 / 10 / 100 / 200) | タスク種別ごとの固定枠 (後述) |
| 最新機能 | P2.0 Preview、Magic Brush 等は Studio 先行 | P2 / 8K などは順次 (P2 は 2026-09 時点で API ドキュメントに未掲載) |

---

## 3. API / SDK

### 3.1 概要 **[確認済]**

- **REST API あり。現行は v3**。
  - Base URL: `https://openapi.tripo3d.ai/v3` (中国: `https://openapi.tripo3d.com/v3`)
  - 認証: `Authorization: Bearer {api_key}` (キーは `tsk_` で始まる)。キーは https://platform.tripo3d.ai/api-keys で発行
  - レスポンス共通形式: `{"code": 0, "data": {...}}`、エラー時 `{"code": 2010, "message": "...", "suggestion": "..."}`
  - 出典: https://developers.tripo3d.ai/en/docs
- **旧 v2 API (`https://api.tripo3d.ai/v2/openapi`) は廃止予定**: 2026-10-01 (UTC+8) にサポート終了、**2026-11-01 (UTC+8) に全エンドポイント停止**。platform.tripo3d.ai/docs に V2 → V3 移行ガイドへのリンクあり。
  - 出典: https://platform.tripo3d.ai/docs/billing (バナー)、https://github.com/tryAGI/Tripo (README)
- **非同期タスクモデル**: `POST` でタスク作成 → `task_id` → `GET /v3/tasks/{task_id}` をポーリング (推奨 2 秒間隔、1 req/s 以下) または Webhook → `output.model_url` をダウンロード。
- **ダウンロード URL の有効期限は 5 分** ("Model URLs expire after 5 minutes. Download immediately after the task succeeds.")。Alibaba Cloud 経由の Tripo は 2 時間だが、これは代理サービスの仕様。
  - 出典: https://developers.tripo3d.ai/en/docs/quick-start 、https://docs.tripo3d.ai/task-query/get-your-task-result.html 、https://help.aliyun.com/en/model-studio/tripo-3d-generation-guide
- タスクは**作成に使った API キーでしか照会できない**。

### 3.2 エンドポイント一覧 (v3) **[確認済: https://developers.tripo3d.ai/en/docs]**

| 分類 | Method / Path | 説明 |
|---|---|---|
| 3D 生成 | `POST /v3/generation/text-to-model` | テキスト → 3D |
| | `POST /v3/generation/image-to-model` | 画像 → 3D |
| | `POST /v3/generation/multiview-to-model` | 多視点画像 → 3D |
| 画像生成 | `POST /v3/generation/text-to-image` / `image-to-image` / `image-to-multiview` / `edit-multiview` | コンセプト画・多視点画像の生成/編集 |
| モデル処理 | `POST /v3/models/texture` | 再テクスチャ |
| | `POST /v3/models/convert` | 形式変換 (+ リトポ/ベイク/ピボット等) |
| | `POST /v3/mesh/segment` | セマンティックセグメンテーション |
| | `POST /v3/mesh/complete` | パーツ補完 |
| | `POST /v3/mesh/decimate` | リトポロジー (v2.0 Smart / v1.0 Basic) |
| アニメーション | `POST /v3/animations/rig-check` | リギング可否判定 (無料) |
| | `POST /v3/animations/rig` | 自動リグ |
| | `POST /v3/animations/retarget` | プリセットモーション適用 |
| タスク | `GET /v3/tasks/{task_id}` / `POST /v3/tasks/list` | 照会 / 一括照会 |
| ファイル | `POST /v3/files` | multipart アップロード (フィールド名 `file`)。画像 PNG/JPEG(/WebP) ≤20 MB、モデル GLB/GLTF/FBX/OBJ/STL ≤150 MB、60 MB 超は Large Files エンドポイント |
| アカウント | `GET /v3/account/balance` | 残高 |
| Webhook | Settings → Webhooks で登録 | `task.completed` / `task.failed` / `balance.low`、`Tripo-Webhook-Signature: t=<unix>,v1=<hex>` (HMAC-SHA256)、非 2xx で再送 |

v2 のタスクタイプ名との対応 (旧 SDK / ComfyUI ノードで見かける名前): `text_to_model`, `image_to_model`, `multiview_to_model`, `refine_model` (v1.4 用), `texture_model`, `stylize_model`, `convert_model`, `mesh_segmentation`, `mesh_completion`, `highpoly_to_lowpoly` (smart low poly), `animate_prerigcheck`, `animate_rig`, `animate_retarget`。v2 は `POST /v2/openapi/task` に `{"type": "...", ...}` を送る単一エンドポイント方式。
- 出典: https://docs.tripo3d.ai/get-started/quick-start.html 、https://docs.tripo3d.ai/mesh-editing/smart-low-poly-p-v2-0-20251225.html 、https://apis.io/apis/tripo-ai/openapi-task/

### 3.3 image-to-model の主要パラメータ (v3) **[確認済: https://developers.tripo3d.ai/en/docs/generation-image-to-model]**

| パラメータ | 型 / 既定 | 説明 |
|---|---|---|
| `input` (必須) | string | `file_token` / 公開 URL / 画像生成タスクの `task_id` のいずれか 1 つ |
| `model` (必須) | string | `v3.1-20260211` (最新)、`v3.0-20250812`、`v2.5-20250123`。Quick Start とレート制限ページでは `P1-20260311` も使用可 |
| `texture` | bool / true | false で無テクスチャ (10 credits 安い) |
| `pbr` | bool / true | PBR マップ生成。true なら `texture` も強制 true |
| `texture_quality` | `standard` / `detailed` / `extreme` | extreme = 8K |
| `geometry_quality` | `standard` / `detailed` | detailed = Ultra モード。v3.0 以上のみ (v2.5 では指定不可) |
| `face_limit` | int / adaptive | 上限: v3.1 三角 1,500,000 (Ultra 2,000,000)、v3.0 1,000,000 (2,000,000)、v2.5 500,000、quad 150,000。`smart_low_poly` 時は三角 500–20,000 / quad 500–10,000 固定 |
| `quad` | bool / false | quad メッシュ。face_limit 未指定なら 10,000。**出力は FBX に強制** |
| `smart_low_poly` | bool / false | 低ポリ直接生成 (+10) |
| `generate_parts` | bool / false | パーツ分割生成 (+20)。`texture=false` かつ `pbr=false` 必須、`quad` は無視 |
| `orientation` | `default` / `align_image` | 入力画像視点に整列 (texture=true 時のみ) |
| `texture_alignment` | `original_image` / `geometry` | テクスチャ優先 or 形状優先 |
| `model_seed` / `texture_seed` | int | 再現性。形状固定でテクスチャだけ変えるなら `texture_seed` のみ変える |
| `auto_size` | bool / false | 実寸 (メートル) にスケール |
| `enable_image_autofix` | bool / false | 低品質画像の自動補正 |
| `compress` | `geometry` | meshopt 圧縮 |
| `export_uv` | bool / true | 生成時 UV 展開 (false で高速化) |
| `export_orientation` | `+x` / `-x` / `+y` / `-y` | 後処理する場合は指定せず、最後に convert で向きを変えることを推奨 |
| `style` | string | v2 の `text_to_model` 系で +5 credits。v3 image-to-model のドキュメントには記載なし (SDK 型定義には残っている) |

`texture_quality`, `geometry_quality`, `auto_size`, `quad`, `smart_low_poly`, `generate_parts`, `compress` は `model >= v3.0-20250812` でのみ有効。

**出力 (`GET /v3/tasks/{id}`)**: `task_id`, `type`, `status` (`queued` / `running` / `success` / `failed` / `cancelled`; v2 系ではさらに `banned` / `expired` / `unknown`), `progress` (0–100), `output.model_url`, `output.rendered_image_url`, `output.model_urls` (retarget で複数アニメ時), `output.riggable` / `output.rig_type` (rig-check), `credits_consumed`, `created_at`, `completed_at`, 失敗時 `error_code` / `error_message`。
**v2 との差**: v2 の出力は `output.pbr_model` / `output.base_model` / `output.model` / `output.rendered_image`。v3 では `model_url` / `rendered_image_url` に統一され `pbr_model` 等は廃止。パラメータ名も v2 `model_version` → v3 `model`。
- 出典: https://developers.tripo3d.ai/en/docs/task-query 、https://github.com/tryAGI/Tripo (移行ノート)、https://raw.githubusercontent.com/VAST-AI-Research/tripo-js-sdk/main/types/index.d.ts

### 3.4 リギング / リターゲット / リトポ / 変換のパラメータ **[確認済]**

- `POST /v3/animations/rig`: `input` (task_id / file_token / URL、GLB 等 ≤150 MB), `model`: `v1.0-20240301` (既定、biped 専用、90+ presets) / `v2.5-20260210` (非人型対応), `rig_type`, `spec`: `tripo` (既定) / `mixamo`, `out_format`: `glb` (既定) / `fbx`。事前に rig-check を推奨。メッシュ編集 (リトポ・セグメンテーション・補完) をするとリグは失われるので、**メッシュ編集を全部済ませてからリグする**。
  - 出典: https://developers.tripo3d.ai/en/docs/animations-rig 、https://docs.tripo3d.ai/animation/rig-v2-5-20260210.html
- `POST /v3/animations/retarget`: `input` (リグ済みタスク ID), `animation` または `animations` (最大 5), `out_format`, `bake_animation` (既定 true、GLB のみ), `export_with_geometry` (true), `animate_in_place` (false)。プリセット名: `preset:idle` / `walk` / `run` / `dive` / `climb` / `jump` / `slash` / `shoot` / `hurt` / `fall` / `turn`, `preset:quadruped:walk`, `preset:hexapod:walk`, `preset:octopod:walk`, `preset:serpentine:march`, `preset:aquatic:march`。
  - 出典: https://developers.tripo3d.ai/en/docs/animations-retarget 、https://docs.tripo3d.ai/animation/retarget.html
- `POST /v3/mesh/decimate`: `input`, `model`: `v2.0` (30 credits、既定) / `v1.0` (10), `face_limit` (三角 500–20,000 / quad 500–10,000), `quad`, `bake` (v2.0 のみ), `part_names` (v2.0 のみ)。出力は GLB。
  - 出典: https://developers.tripo3d.ai/en/docs/mesh-decimate
- `POST /v3/models/convert`: `input`, `format` (GLTF / FBX / USDZ / OBJ / STL / 3MF), `quad`, `face_limit`, `force_symmetry`, `flatten_bottom`, `texture_size` (既定 4096), `texture_format`, `bake`, `pack_uv`, `pivot_to_center_bottom`, `scale_factor`, `with_animation` (既定 true), `animate_in_place`, `export_orientation`, `fbx_preset`, `part_names`。
  - 出典: https://developers.tripo3d.ai/en/docs/models-convert

### 3.5 レート制限 / 同時実行 **[確認済: https://docs.tripo3d.ai/get-started/rate-limits.html]**

- 同時実行はタスク種別グループごと: `P1-20260311` の text/image/multiview_to_model = **5**、その他モデルの生成 = **10**、`refine_model` = 5、アニメーション系 (prerigcheck / rig / retarget) = 各 10、多視点画像生成・編集 = 各 1、その他 = 10
- 超過時 `code: 2000 "You have exceeded the limit of generation"` + `Retry-After` ヘッダー、指数バックオフ推奨
- 画像アップロードは 10 qps
- エラーコード例: 1002 認証失敗、1004 パラメータ不正、1007 レート制限、2000 生成上限、2001 タスクなし、2010 クレジット不足、2015 非推奨バージョン、2018 リメッシュ不能な複雑モデル
  - 出典: https://docs.tripo3d.ai/get-started/errors-and-error-handling.html

### 3.6 公式 SDK / CLI **[確認済: レジストリ]**

| 種別 | パッケージ | バージョン / 日付 | 備考 | 出典 |
|---|---|---|---|---|
| **JavaScript / TypeScript (公式)** | `@vastai/tripo-sdk` (npm) | 0.1.1 (2026-07-21 公開、0.1.0 も同日) | MIT、Node ≥18 / Bun / Deno / ブラウザ、ランタイム依存ゼロ (fetch 使用)、`types/index.d.ts` 同梱、v3 API 対象。メソッド: `uploadFile`, `textToModel`, `imageToModel`, `multiviewToModel`, `textureModel`, `convertModel`, `segmentMesh`, `completeMesh`, `decimateMesh`, `rigCheck`, `rigModel`, `retargetAnimation`, `getTask`, `listTasks`, `waitForTask`, `run`, `getBalance`, `downloadModel`。定数 `ModelVersion` = `v3.1-20260211`, `v3.0-20250812`, `v2.5-20250123`, `v2.0-20240919`, `P1-20260311`, `Turbo-v1.0-20250506` | https://registry.npmjs.org/@vastai%2Ftripo-sdk 、https://github.com/VAST-AI-Research/tripo-js-sdk |
| Python (公式) | `tripo3d` (PyPI) | 0.4.2 (2026-07-01)、0.4.1/0.4.0 (2026-04-29)、0.3.12 (2026-03-04) | MIT、Python ≥3.8、sync/async 対応。docs/API.md は v2 形式 (`model_version`, `pbr_model` 等) で書かれており、**v3 完全対応かは未確認 [未確認]** | https://pypi.org/pypi/tripo3d/json 、https://github.com/VAST-AI-Research/tripo-python-sdk |
| CLI (公式) | `tripo-cli` (npm) | - | `npm install -g tripo-cli`、`tripo login --key tsk_...` または `TRIPO_API_KEY`、`tripo make cat.png --then 'texture,rig,convert:fbx'`、プリセット `--for game-mobile / game-pc / film / print / ar-web / anim / toy`、`tripo view @last` | https://developers.tripo3d.ai/en/docs/cli |
| C# (コミュニティ) | `Tripo` (NuGet、tryAGI) | prerelease | v3 対応、V2 廃止日程を README に記載 | https://github.com/tryAGI/Tripo |
| 代理 API (サードパーティ) | Runware, 3D AI Studio, Scenario, fal.ai, Alibaba Model Studio | - | 独自の課金・URL 期限。公式 API とは別物 | https://runware.ai/docs/models/tripo-v3-1 ほか |

注: 検索スニペットに `tripo3d-sdk-js` という npm 名が出るが、npm レジストリは 404。**実在する公式 npm パッケージは `@vastai/tripo-sdk`** **[確認済]**。

### 3.7 最小 TypeScript 例 (SDK なし、fetch のみ): image-to-model **[v3 ドキュメントに基づく]**

```ts
// Node.js 18+ / Bun / Deno。環境変数 TRIPO_API_KEY に "tsk_..." を設定。
import { readFile, writeFile } from "node:fs/promises";

const BASE = "https://openapi.tripo3d.ai/v3";
const KEY = process.env.TRIPO_API_KEY!;
const auth = { Authorization: `Bearer ${KEY}` };

type Envelope<T> = { code: number; data: T; message?: string; suggestion?: string };

async function api<T>(path: string, init: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, { ...init, headers: { ...auth, ...(init.headers ?? {}) } });
  const body = (await res.json()) as Envelope<T>;
  if (!res.ok || body.code !== 0) throw new Error(`${path}: HTTP ${res.status} code=${body.code} ${body.message ?? ""}`);
  return body.data;
}

// 1) 画像アップロード (multipart、フィールド名は "file") → file_token
async function uploadImage(path: string): Promise<string> {
  const form = new FormData();
  form.append("file", new Blob([await readFile(path)], { type: "image/png" }), "input.png");
  const { file_token } = await api<{ file_token: string }>("/files", { method: "POST", body: form });
  return file_token;
}

// 2) タスク作成
async function createImageToModel(fileToken: string): Promise<string> {
  const { task_id } = await api<{ task_id: string }>("/generation/image-to-model", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      input: fileToken,
      model: "v3.1-20260211",
      texture: true,
      pbr: true,
      texture_quality: "standard",
      face_limit: 30000,
      // quad: true にすると出力は FBX になる
    }),
  });
  return task_id;
}

// 3) ポーリング (2 秒間隔、1 req/s を超えない)
type Task = {
  task_id: string; status: "queued" | "running" | "success" | "failed" | "cancelled";
  progress?: number; output?: { model_url?: string; rendered_image_url?: string; model_urls?: string[] };
  credits_consumed?: number; error_code?: number; error_message?: string;
};
async function waitForTask(taskId: string, timeoutMs = 15 * 60_000): Promise<Task> {
  const start = Date.now();
  while (true) {
    const t = await api<Task>(`/tasks/${taskId}`, { method: "GET" });
    if (t.status === "success") return t;
    if (t.status === "failed" || t.status === "cancelled") throw new Error(`task ${taskId} ${t.status}: ${t.error_message}`);
    if (Date.now() - start > timeoutMs) throw new Error("timeout");
    await new Promise((r) => setTimeout(r, 2000));
  }
}

// 4) ダウンロード (URL は成功後 5 分で失効するので即座に取得)
async function download(url: string, to: string) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`download failed: ${res.status}`);
  await writeFile(to, Buffer.from(await res.arrayBuffer()));
}

const token = await uploadImage("./character.png");
const taskId = await createImageToModel(token);
const task = await waitForTask(taskId);
await download(task.output!.model_url!, "./character.glb");
console.log("credits:", task.credits_consumed);

// 続けてリグ → リターゲット (いずれも task_id をそのまま input に渡せる)
const rig = await api<{ task_id: string }>("/animations/rig", {
  method: "POST", headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ input: taskId, model: "v2.5-20260210", rig_type: "biped", spec: "mixamo", out_format: "fbx" }),
});
const rigged = await waitForTask(rig.task_id);
await download(rigged.output!.model_url!, "./character_rigged.fbx");
```

参照: https://developers.tripo3d.ai/en/docs/files 、https://developers.tripo3d.ai/en/docs/generation-image-to-model 、https://developers.tripo3d.ai/en/docs/task-query 、https://developers.tripo3d.ai/en/docs/animations-rig 。公式 JS SDK の README にも同等の `uploadFile → imageToModel → waitForTask → downloadModel` の例がある (https://github.com/VAST-AI-Research/tripo-js-sdk)。

---

## 4. 周辺ツール (ComfyUI / Blender / MCP) **[確認済: GitHub]**

| ツール | リポジトリ | 内容 | 状態 |
|---|---|---|---|
| **ComfyUI-Tripo** (公式カスタムノード) | https://github.com/VAST-AI-Research/ComfyUI-Tripo | ノード: TripoTextToModel, TripoImageToModel, TripoMultiviewToModel, TripoTextureModel, TripoRefineModel, TripoAnimateRigModel / Retarget, TripoMeshSegmentation (v1 & v2.0), TripoConvertModel, TripoStylizeModel、URL からのモデル import。API キーは `TRIPO_API_KEY` 環境変数 / ノード入力 / `config.json`。出力は `ComfyUI/output` | pyproject: `comfyui-tripo` 1.3.0、依存 `tripo3d>=0.4.2`、MIT。Manager では "Tripo for ComfyUI"、`comfy node registry-install comfyui-tripo`。changelog 最新 2026-06-30 (Segmentation v2.0 / `model_url` import)。GitHub Releases は未発行 |
| **Tripo for Blender** (公式アドオン) | https://github.com/VAST-AI-Research/tripo-3d-for-blender | Text / Image / Multiview-to-Model、進捗バー、texture quality / PBR / face limit / style / quad 設定、複数同時生成、タスク管理ウィンドウ。API キー必須。Blender 3.0+、zip を Preferences > Add-ons > Install で導入 (Blender Extensions プラットフォーム配布は未確認)。README にはリギング・リトポ機能の記載なし | Releases: 0.7.7 "add mv for 3.0" (11/6)、0.7.4 "add v3.0"、0.7.2 "price for pbr"。MIT。公式サイトは Blender 以外に 3ds Max / Unity / Unreal / Maya / Cocos / Godot / ZBrush / MetaTailor / Roblox 向け "DCC Bridge" を掲載 (https://www.tripo3d.ai/pricing フッター) |
| **tripo-mcp** (公式 MCP サーバー) | https://github.com/VAST-AI-Research/tripo-mcp | 自然言語 → Tripo API で 3D 生成 → Blender へ import。Claude Desktop / Cursor から `uvx tripo-mcp` で起動。Tripo Blender アドオンのインストールが前提。blender-mcp (Siddharth Ahuja) を参考にしたと明記 | **alpha**。pyproject: `tripo-mcp` 0.1.2、Python ≥3.10、依存 `tripo3d>=0.2.0`, `mcp[cli]>=1.4.1`、MIT |

---

## 5. モデルバージョンと差異

### 5.1 API で指定できるバージョン文字列 **[確認済]**

| 系統 | バージョン ID | 位置づけ | 出典 |
|---|---|---|---|
| H シリーズ (High Detail) | `v3.1-20260211` | 最新・最高品質。三角 1.5M (Ultra 2M) まで。Tripo H3.1 として 2026-03 GDC で発表 (入力整合性・形状精度・テクスチャ品質・生成効率の改善) | https://developers.tripo3d.ai/en/docs/generation-image-to-model 、https://www.prnewswire.com/news-releases/tripo-ai-debuts-production-grade-native-3d-diffusion-at-gdc-2026-302708371.html |
| | `v3.0-20250812` | 2025-09 正式リリース。Standard / Ultra (detailed) モード導入、PBR・テクスチャ解像度改善。三角 1M (Ultra 2M) | https://www.tripo3d.ai/blog/introducing-tripo-new-algorithm3 (検索要約、本文 403) |
| | `v2.5-20250123` | 旧安定版。三角 500K、`geometry_quality` 等の v3 系オプション不可。V2→V3 移行で「v2 と同じ挙動」を保つ既定 | https://github.com/tryAGI/Tripo |
| | `v2.0-20240919`, `Turbo-v1.0-20250506`, `v1.4-20240625` | レガシー (v1.4 は draft → `refine_model` の 2 段階方式) | https://docs.tripo3d.ai/get-started/overview.html 、SDK 定数 |
| P シリーズ (Smart Mesh) | `P1-20260311` | Smart Mesh P1.0 (2026-03-20 発表)。ネイティブ 3D 拡散でエンジン向け低ポリ (三角 48–20,000 面) を約 2 秒で生成。同時実行 5。API 課金は H 系より高い (image 40/50) | https://docs.tripo3d.ai/model-generation/image-to-model-p1-20260311.html 、https://finance.yahoo.com/sectors/technology/articles/tripo-ai-introduces-smart-mesh-075000811.html |
| | P2.0 Preview | **Studio のみ (2026-08 頃)**。ネイティブ quad、三角 500–50,000 / quad 500–25,000、多視点入力対応、10–40 秒。単一画像は全ユーザー 2 回無料、以降とマルチビューは有料プラン限定。Studio クレジット表では "Smart Mesh P2.0 +65"。**API ドキュメントには 2026-09-06 時点で未掲載 [確認済]** | https://www.tripo3d.ai/blog/tripo-p2-0-preview 、https://www.tripo3d.ai/pricing |
| リグ | `v1.0-20240301` (biped, 90+ presets), `v2.0-20250506`, `v2.5-20260210` (非人型 rig_type 対応) | | https://developers.tripo3d.ai/en/docs/animations-rig |
| テクスチャ | `v2.5-20250123`, `v3.0-20250812`; `texture_quality=extreme` (8K) は 2026-06-03 に追加 | | https://platform.tripo3d.ai/docs/billing (changelog) |
| セグメンテーション | `v1.0-20250506`, `v2.0-20260430` (Beta) | | https://developers.tripo3d.ai/en/docs/mesh-segment |
| Smart Low Poly (post) | `P-v2.0-20251225` (`highpoly_to_lowpoly`) | v3 では `/mesh/decimate model=v2.0` | https://docs.tripo3d.ai/mesh-editing/smart-low-poly-p-v2-0-20251225.html |

### 5.2 未確認情報

- **"Tripo 4.0" (8K PBR のフラッグシップ) と "Tripo P2" 正式版が 2026-08-31 に同時リリース**という記述は 3D AI Studio (サードパーティ) のブログのみで、公式サイト・公式 API ドキュメント・SDK 定数のいずれにも "4.0" は見当たらない **[未確認]**。出典: https://www.3daistudio.com/blog/introducing-tripo-p2
- developers.tripo3d.ai の料金ページには "H Series / P Series / **Splat Series**" のタブがあり、Gaussian Splat 系の生成が存在する可能性があるが内容は未取得 **[未確認]**。
- Tripo W1.0 (ワールドモデル) は GDC 2026 で研究段階として言及 **[確認済: PR Newswire]**。

### 5.3 どれを選ぶか (キャラクター用途)

- 見た目重視・後でリトポするなら **v3.1 (H3.1)** + `texture_quality: detailed`。
- ゲーム/リアルタイム用の低ポリを最初から欲しいなら **P1** (リトポ工程を省ける)、または v3.1 + `smart_low_poly: true` (+10 credits、単純形状向け)。
- サードパーティのリギング比較 (2026-05) では Tripo のリグは UE5 Mannequin リターゲットが最も素直だった一方、肩・胸のウェイトが平滑化されすぎ、顎ウェイトがノイジー、非人型は弱いとの評価。出典: https://www.strayspark.studio/blog/ai-auto-rigging-showdown-2026-tripo-meshy-cascadeur-mixamo **[サードパーティ評価]**

---

## 6. 利用規約: 生成物の所有権と商用利用 **[確認済: https://www.tripo3d.ai/terms、Last updated 2025-07-11]**

- 契約主体は **Holymolly Ltd** (香港)。準拠法は香港法、紛争は HKIAC 仲裁。
- **5.2.1 Free Users**: 無料ユーザーの Inputs / Outputs については **Tripo がすべての権利を保持する** (use, copy, modify, distribute, derive revenue ... を含む)。
- **5.2.2 Paid Users**: 有料ユーザーは Inputs / Outputs およびそこから生じる知的財産権について、使用・複製・改変・配布・ライセンス・収益化を含む **"generally have all rights"**。ただしサービス提供に必要な範囲で Tripo に royalty-free・perpetual・worldwide・non-exclusive のライセンスを許諾する。**有料ユーザーの Inputs / Outputs は AI 学習に使わない**と明記。
- **3.2 Outputs の制限**: Tripo と競合するモデル/サービスを Outputs で作らない、API キーの売買・譲渡禁止、Generative 3D Foundation Model Service を第三者に (エンドユーザー含め) 事前承諾なく提供しない、等。「Outputs を合法的な商用・非商用目的で使ってよい」旨も同節にある。
- 生成物の独自性は保証されない (他ユーザーが類似・同一の Outputs を得る可能性がある)。
- pricing ページの表記: Free = "Public Models · Non-Commercial Use"、Pro / Max / Team = "Private Models · Commercial Use" **[確認済]**。
- サードパーティ記事にある「Free プランは CC BY 4.0 で公開」は旧 pricing ページの記述に基づくと思われ、2026-09 の公式ページには CC BY の文言なし **[未確認]**。
- **API 利用者の扱い**: 規約には API 専用条項がなく、クレジット購入者は "Paid Users" に該当すると読むのが自然 **[推定]**。Tripo 公式ブログは "API 出力は商用権付き" と述べているとされる (https://www.tripo3d.ai/blog/commercial-use-ai-3d-models 、本文は 403 で未取得) **[未確認]**。商用プロジェクトなら business@tripo3d.ai で確認を推奨。

---

## 7. 推奨: 趣味/研究プロジェクトで月に数十体のキャラクターを API 生成 (リグ + リトポあり)

### 結論
**Studio サブスクではなく、Tripo API (v3) の従量クレジットを使う。** 理由:
1. API クレジットは失効せず $0.01/credit で、月数十体なら数十ドルで収まる。Studio の Pro ($20/月、3,000 credits) は API に使えない (別会計と判断される) ので、API 主体なら二重払いになる。
2. v3 は image-to-model → rig-check → rig → retarget → decimate → convert までタスク ID を直接つなげられ、公式 TypeScript SDK (`@vastai/tripo-sdk`) も MIT で軽量。
3. **v2 は 2026-11-01 に停止**するため、新規実装は必ず v3 (`https://openapi.tripo3d.ai/v3`) で始める。

### 1 体あたりのコスト試算 (developers.tripo3d.ai の表、2026-09-06 時点)

| 工程 | パラメータ例 | credits |
|---|---|---|
| Image to 3D (H3.1、標準テクスチャ) | `model: v3.1-20260211`, `pbr: true` | 30 |
| (任意) HD テクスチャ | `texture_quality: detailed` | +10 |
| Rig Check | | 0 |
| Auto Rig | `model: v2.5-20260210`, `spec: mixamo`, `out_format: fbx` | 25 |
| Retopology v2.0 Smart (リグ前に実施) | `/mesh/decimate model=v2.0, face_limit 10000` | 30 |
| Retarget 3 モーション | `animations: [idle, walk, run]` | 30 |
| Convert (Advanced、FBX + face_limit 等) | | 10 |
| **合計** | | **約 125–135 credits ≈ $1.25–1.35 / 体** |

- 40 体/月 → 約 5,000–5,400 credits ≈ **$50–55/月**。P1 で低ポリを直接生成してリトポを省く場合は 50 + 25 + 30 = 105 credits (≈$1.05) だが、P1 は同時実行 5 で三角 20,000 面上限。
- まず **新規 300 クレジット (2 週間)** で品質を確認し、その後 $10 単位で購入 (API ウォレット)。
- 順序の注意: リトポ・セグメンテーション・補完はリグを消すので **メッシュ編集 → rig → retarget → convert** の順に固定する。`export_orientation` は生成時に触らず最後の convert で調整。
- ダウンロード URL は 5 分で失効するので、成功検知後すぐ取得して自前ストレージに保存。ポーリングは 2 秒間隔、または Webhook (`task.completed`) を使う。
- 対話的に Magic Brush や P2.0 Preview (Studio 限定) を試したい月だけ Studio Pro ($20) を別途契約する、という使い分けが現実的。

### 実装メモ
- Node 18+ なら `@vastai/tripo-sdk@0.1.1` を使うか、本ドキュメント 3.7 の fetch 実装で十分 (依存ゼロ)。
- レート制限 (`code: 2000`, `Retry-After`) と `2010 Insufficient credits` のハンドリング、`Tripo-Webhook-Signature` の HMAC 検証を最初から入れる。
- ComfyUI 連携が必要なら `comfyui-tripo` 1.3.0 (Python `tripo3d>=0.4.2`) が公式。Blender 取り込みは公式アドオン (生成のみ) か `tripo-mcp` (alpha)。

---

## 参考 URL 一覧

- 公式サイト / 料金: https://www.tripo3d.ai/pricing
- 公式規約: https://www.tripo3d.ai/terms
- API v3 ドキュメント: https://developers.tripo3d.ai/en/docs 、https://developers.tripo3d.ai/en/docs/quick-start 、https://developers.tripo3d.ai/en/docs/generation-image-to-model 、https://developers.tripo3d.ai/en/docs/files 、https://developers.tripo3d.ai/en/docs/task-query 、https://developers.tripo3d.ai/en/docs/webhooks 、https://developers.tripo3d.ai/en/docs/animations-rig-check 、https://developers.tripo3d.ai/en/docs/animations-rig 、https://developers.tripo3d.ai/en/docs/animations-retarget 、https://developers.tripo3d.ai/en/docs/mesh-decimate 、https://developers.tripo3d.ai/en/docs/mesh-segment 、https://developers.tripo3d.ai/en/docs/models-convert 、https://developers.tripo3d.ai/en/docs/cli 、https://developers.tripo3d.ai/en/models
- API 料金: https://developers.tripo3d.ai/en/pricing 、https://platform.tripo3d.ai/docs/billing 、https://docs.tripo3d.ai/get-started/pricing.html
- v2 ドキュメント (廃止予定): https://docs.tripo3d.ai/ 、https://docs.tripo3d.ai/get-started/rate-limits.html 、https://docs.tripo3d.ai/get-started/errors-and-error-handling.html 、https://docs.tripo3d.ai/model-generation/image-to-model-v3-0-v3-1.html 、https://docs.tripo3d.ai/model-generation/image-to-model-p1-20260311.html
- GitHub: https://github.com/VAST-AI-Research/tripo-js-sdk 、https://github.com/VAST-AI-Research/tripo-python-sdk 、https://github.com/VAST-AI-Research/ComfyUI-Tripo 、https://github.com/VAST-AI-Research/tripo-3d-for-blender 、https://github.com/VAST-AI-Research/tripo-mcp 、https://github.com/tryAGI/Tripo
- レジストリ: https://registry.npmjs.org/@vastai%2Ftripo-sdk 、https://pypi.org/project/tripo3d/
- モデル発表: https://www.tripo3d.ai/blog/tripo-p2-0-preview 、https://www.prnewswire.com/news-releases/tripo-ai-debuts-production-grade-native-3d-diffusion-at-gdc-2026-302708371.html 、https://runware.ai/docs/models/tripo-v3-1
- サードパーティ (参考): https://tripo3ds.com/pricing/ 、https://costbench.com/software/ai-3d-generation/tripo-ai/ 、https://kingy.ai/news/tripo-ai-the-all-in-one-ai-3d-workspace-that-might-actually-change-how-we-build-3d-content/ 、https://www.strayspark.studio/blog/ai-auto-rigging-showdown-2026-tripo-meshy-cascadeur-mixamo 、https://www.3daistudio.com/blog/introducing-tripo-p2
