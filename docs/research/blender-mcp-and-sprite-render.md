# Blender MCP と 8 方向スプライト・レンダリング調査 (2026-09 時点)

調査日: 2026-09-06。対象環境: Windows 11 / Blender 5.2.1 LTS (`C:\Program Files\Blender Foundation\Blender 5.2\blender.exe`, build 2026-08-25) / RTX 4080 / Claude Code。
凡例: **[確認済]** = 一次情報 (公式 doc / ソース / 手元の環境) で確認、**[要検証]** = 二次情報や推測を含む、**[未確認]** = 裏が取れていない。

---

## Topic A: コーディングエージェント向け Blender MCP

### A-1. ahujasid/blender-mcp (`uvx blender-mcp`)

#### 現在のバージョン **[確認済]**

| 項目 | 値 |
|---|---|
| PyPI 最新 | **1.9.1** (2026-09-02)。直前は 1.9.0 (08-30), 1.8.8, 1.8.7, ... 1.8.3 (08-16) と 8 月に集中してリリース |
| Python | >= 3.10 |
| 依存 | `mcp>=1.9.0,<2`, `httpx>=0.27.0` |
| GitHub Releases | 未使用 (「There aren't any releases here」)。バージョンは PyPI と `pyproject.toml` のみ |
| ライセンス | MIT |

出典: [PyPI blender-mcp](https://pypi.org/project/blender-mcp/), [pyproject.toml](https://raw.githubusercontent.com/ahujasid/blender-mcp/main/pyproject.toml), [Releases](https://github.com/ahujasid/blender-mcp/releases)

#### 仕組み **[確認済]** (手元の `addon.py` 1.6 / server 1.9.1 のソースで確認)

```
Claude Code ──stdio──> blender-mcp (FastMCP, uvx)  ──TCP JSON localhost:9876──> addon.py (Blender 内)
```

- **アドオン側 (`addon.py`)**: `bl_info = {"name": "MCP for Blender", "version": (1, 6), "blender": (3, 0, 0)}` の *レガシー形式アドオン* (extension manifest ではない)。`localhost:9876` (env `BLENDER_HOST` / `BLENDER_PORT` で変更可) で待ち受けるソケットサーバー・スレッドを持つ。
  - ソケットスレッドは JSON コマンドを受けてキューに積むだけで `bpy` に触らない。`bpy.app.timers.register(self._drain_command_queue, persistent=True)` で **メインスレッドが 50 ms ごとにキューを消化**して `bpy` を実行する (ワーカースレッドから `timers.register` を呼ぶと Windows でコールバックが失われる、というコメントあり)。
  - `execute_code` は `exec(code, {"bpy": bpy})` + `redirect_stdout` で出力を回収。
  - `ADDON_PROTOCOL_VERSION = 5`。サーバー側 `addon_manager.py` の `EXPECTED_ADDON_PROTOCOL_VERSION = 5` と一致していることを `get_addon_status` ツールで検証する。
- **サーバー側 (`blender_mcp/server.py`)**: `from mcp.server.fastmcp import FastMCP, Context, Image`。単一の永続 TCP 接続 (`_blender_connection`) を `_lock` で直列化。**ソケットタイムアウト 180 秒**。受信はチャンクを溜めて JSON が完結するまで待つ。
- 1.9.x で追加された **`uvx blender-mcp install-addon`** サブコマンドが、同梱の `addon.py` を Blender のユーザー addons ディレクトリにコピーする (`addon_manager.py`)。

出典: [README](https://raw.githubusercontent.com/ahujasid/blender-mcp/main/README.md), [addon.py](https://raw.githubusercontent.com/ahujasid/blender-mcp/main/addon.py), [server.py](https://raw.githubusercontent.com/ahujasid/blender-mcp/main/src/blender_mcp/server.py)

#### Windows でのインストール手順 **[確認済]** (README + 手元のソース)

1. `uv` を公式インストーラで入れる: `powershell -c "irm https://astral.sh/uv/install.ps1 | iex"`。`%USERPROFILE%\.local\bin` を PATH に追加 (README に PowerShell スニペットあり)。
2. アドオンを配置: `uvx blender-mcp install-addon` (または GitHub の `addon.py` を手動で `Edit > Preferences > Add-ons > Install...`)。
3. Blender: `Edit > Preferences > Add-ons` で **"Interface: MCP for Blender"** を有効化 (旧名 "Blender MCP")。
4. 3D Viewport で `N` → サイドバーの **"MCP for Blender"** タブ (`bl_category = 'MCP for Blender'`) → **"Connect to Claude"** ボタン (`bl_label`。旧 doc の "Connect to MCP server" は現在この名前)。停止は "Stop the connection to Claude"。同パネルに PolyHaven / Sketchfab / Poly Pizza / Hyper3D / Hunyuan3D のチェックボックスと API キー欄。
5. Claude Code: `claude mcp add blender -e DISABLE_TELEMETRY=true -- uvx blender-mcp`。GUI クライアント (Claude Desktop / Cursor) は PATH を継承しないので `uvx` のフルパス指定か `cmd /c uvx` が推奨。
6. **Windows 固有**: ポート 9876 が塞がれる報告 ([Issue #193](https://github.com/ahujasid/blender-mcp/issues/193), 2026-02, Blender 4.5.2 / Win11)。対処はアドオン側のポートと `"env": {"BLENDER_PORT": "9001"}` を揃える。

#### Blender 5.x 互換性 **[要検証]**

- `bl_info["blender"] = (3, 0, 0)`、README は「Blender 3.0+」。コード内の分岐は `bpy.app.version >= (4, 0)` (ShaderNodeSeparateColor 等) のみで、**5.x 固有の対応は無い**。
- [Issue #185](https://github.com/ahujasid/blender-mcp/issues/185) (2026-02-13): 「5.0 で Python エラー」報告、メンテナ返答なしで open のまま。ただしその後 2026-06〜09 の大量コミット (Supabase 依存除去、`install-addon`、safe mode、protocol v5) があり、具体的にどのエラーかは追えなかった。
- レガシー `bl_info` アドオン自体は Blender 4.2 以降も 5.2 でも `scripts/addons/` からロードされる (Extensions Platform と併存、削除予定日は未告知) ([Blender Manual: Add-ons](https://docs.blender.org/manual/en/latest/advanced/extensions/addons.html), [Superhive: Convert Add-on to Extension](https://superhivemarket.com/posts/how-to-convert-your-blender-add-on-to-an-extension))。
- Blender 5.0 の Python 破壊的変更で影響しうる点: `scene['cycles']` のような dict 風アクセス廃止、`bl_console_utils` 等の private 化、GreasePencil → Annotation 改名 ([5.0 Python API notes](https://developer.blender.org/docs/release_notes/5.0/python_api/))。addon.py はこれらに依存していないように見えるが、全行は読んでいない。
- **手元の状況 [確認済]**: `%APPDATA%\Blender Foundation\Blender\5.2\scripts\addons\` に `addon.py` (1.6 / protocol 5)、`blender_mcp.py` (同一内容の複製)、`addon.py.bak`、さらに旧 `blender-mcp-main/` (version 1.2) が同居している。**同じ `bl_info` 名のモジュールが 3 つ**あるので、Preferences で重複表示・二重登録の恐れがある → `addon.py` 以外は削除推奨。
- 本セッションで `get_addon_status` を呼んだ結果は `source: "missing", protocol_version: null, blender_version: null, telemetry_consent: false`。Blender が起動していない (接続不能) 時のフォールバック応答なので、5.2.1 での動作可否はこの調査では確認できていない **[未確認]**。uv キャッシュに 1.6.4 → 1.9.1 まで多数の環境があるため、過去に実際に使われてはいる。

#### 公開ツール一覧 **[確認済]** (server.py の `@mcp.tool`, 28 個)

| 分類 | ツール |
|---|---|
| 基本 | `get_addon_status`, `disable_telemetry`, `get_scene_info`, `get_object_info`, `get_viewport_screenshot` (max_size 既定 1000 px、一時 PNG 経由), `execute_blender_code` |
| PolyHaven | `get_polyhaven_status`, `get_polyhaven_categories`, `search_polyhaven_assets`, `download_polyhaven_asset`, `set_texture` |
| Sketchfab | `get_sketchfab_status`, `search_sketchfab_models`, `get_sketchfab_model_preview`, `download_sketchfab_model` |
| Poly Pizza | `get_polypizza_status`, `search_polypizza_models`, `download_polypizza_model` |
| Hyper3D Rodin | `get_hyper3d_status`, `generate_hyper3d_model_via_text`, `generate_hyper3d_model_via_images`, `poll_rodin_job_status`, `import_generated_asset` |
| Hunyuan3D | `get_hunyuan3d_status`, `generate_hunyuan3d_model`, `poll_hunyuan_job_status`, `import_generated_asset_hunyuan` |
| その他 | `record_trajectory_feedback` (テレメトリ用) |

注意: 全ツールが `user_prompt` (ユーザー発話をそのまま引用) を要求する。これは trajectory/テレメトリ記録用の設計。

#### 制限事項 **[確認済 / 一部要検証]**

- **単一接続・直列実行**: MCP サーバーは 1 インスタンスのみ ("Only run one MCP server instance")。複数接続はハンドラスレッドで競合する ([DeepWiki troubleshooting](https://deepwiki.com/ahujasid/blender-mcp/6.2-error-handling-and-troubleshooting))。
- **タイムアウト 180 秒**: 長いレンダ、大きなアセット DL、AI 生成のポーリングで超過しやすい。対策は「コマンドを小さく分割」「1k テクスチャを使う」「ポーリングは別コマンドで」。Claude Code 側の MCP タイムアウト (既定 ~40 秒で "Request timed out" 報告あり、[Issue #219](https://github.com/ahujasid/blender-mcp/issues/219)) は `MCP_TIMEOUT` 環境変数で伸ばせる **[要検証]**。
- **メインスレッド実行**: `bpy` は Blender の UI スレッドで走るので、実行中 Blender は固まる。ヘッドレスは不可 (GUI の Blender + アドオンが必須。`get_viewport_screenshot` は 3D Viewport 前提)。
- **`execute_blender_code` のセキュリティ**: 任意 Python を `exec`。README は「先に保存せよ」と警告。`BLENDER_MCP_SAFE_MODE=1` で `safe_mode.py` によるスクリプト検証 (ファイル / ネットワークアクセスを遮断、通常のモデリング操作は許可)。
- 生成 AI 連携 (Rodin / Hunyuan3D) は外部 API キーが要る。本プロジェクトは Tripo を TS 側で叩くので不要。

#### テレメトリ **[確認済]**

- 既定 ON。収集対象は「プロンプト原文、実行コード、スクリーンショット (base64 アップロード)、シーン情報サマリ」+ ツール実行イベント。
- OFF にする方法: (a) env `DISABLE_TELEMETRY=true` (サーバー側)、(b) Blender Preferences のアドオン設定 "Allow Telemetry" (`telemetry_consent` BoolProperty)、(c) `disable_telemetry` ツール。手元の `get_addon_status` は `telemetry_consent: false` を返した。

#### `--with "mcp[cli]<2"` ピンはまだ必要か **[確認済]**

- 経緯: **MCP Python SDK 2.0.0 (2026-07-28)** が `mcp.server.fastmcp` を `mcp.server.mcpserver` に移し、`FastMCP` → `MCPServer` に改名。`from mcp.server.fastmcp import FastMCP` は `ModuleNotFoundError` になる ([SDK What's new in v2](https://py.sdk.modelcontextprotocol.io/v2/whats-new/), [Zuplo 解説](https://zuplo.com/learn/mcp/errors/no-module-named-mcp-server-fastmcp))。`pip install mcp` は 2.x を入れる。
- 上流対応: 翌日 2026-07-29 のコミット "pin v1 of mcp.server.fastmcp (#296)" で `pyproject.toml` に `mcp>=1.9.0,<2` が入った ([commit history](https://github.com/ahujasid/blender-mcp/commits/main/pyproject.toml))。
- 手元の uv キャッシュには `mcp-2.0.0.dist-info` と `mcp-1.29.x` が混在しており、ピン前に 2.0.0 を掴んで壊れた時期があったと推測できる (ユーザーが `--with` を足した理由と整合)。1.9.1 の環境 (`archive-v0/-W_QgIGPNHqKZZHJ`) は `mcp-1.29.1` で解決済み。
- **結論**: 1.8.x 以降 (少なくとも 1.9.1) では `--with "mcp[cli]<2"` は **冗長だが無害**。将来上流が mcp 2 に移行したら逆に壊れるので、その時は外す。より確実なのは **バージョンを固定**すること:

```jsonc
// .mcp.json (推奨)
"blender": {
  "type": "stdio",
  "command": "uvx",
  "args": ["blender-mcp@1.9.1"],           // 固定。更新時は明示的に上げる
  "env": { "DISABLE_TELEMETRY": "true", "BLENDER_MCP_SAFE_MODE": "1" }
}
```

`~/.claude.json` 側は `C:\Users\harum\.local\bin\uvx.exe` の絶対パスになっており、こちらは GUI 起動でも PATH 問題を避けられる。リポジトリの `.mcp.json` は素の `uvx` なので、Claude Code (ターミナル起動) では問題ないが Desktop 系クライアントと共有するなら絶対パス化する。

### A-2. 代替 MCP / ヘッドレス実行パターン

#### 他の Blender MCP サーバー (2026-09) **[要検証: 各 README の自己申告]**

| プロジェクト | 規模 / 特徴 | Blender 対応 | ライセンス | 所見 |
|---|---|---|---|---|
| [ahujasid/blender-mcp](https://github.com/ahujasid/blender-mcp) | 28 ツール、27k★、`execute_blender_code` 中心 | 3.0+ (5.x は #185 未解決) | MIT | 事実上の標準。汎用性最大、型付きツールは少ない |
| [RFingAdam/mcp-blender](https://github.com/RFingAdam/mcp-blender) | 218 ツール (modeling/rigging/animation/baking/export/MSFS) | 4.2 LTS & 5.0 (互換レイヤ) | AGPL-3.0 (v0.4.0 で MIT から変更) | 型付きツールが豊富。AGPL に注意 |
| [glonorce/Blender_mcp](https://github.com/glonorce/Blender_mcp) | 69 ツール / 550 アクション、499 テスト、BVH 解析 | **5.0+** | MIT | 5.x 専用設計。コミット数 1 で成熟度不明 |
| [PoBruno/mcp-blender-agent](https://github.com/PoBruno/mcp-blender-agent) | ~216 型付きツール、`npx` 起動、`{ok,data,refs,nextSteps}` 形式 | 4.2+ (5.x 推奨) | 不明 | Node 製、決定論的な出力を志向 |
| [6xvl/blender-mcp](https://github.com/6xvl/blender-mcp) | ~270 ツール、hang 検出 | 不明 | MIT | **起動毎に GitHub main から強制自動更新** (`_BM_AUTOUPDATE_REPO`) — サプライチェーン的に非推奨 |
| [Oli97430/blender-mcp-addon](https://github.com/Oli97430/blender-mcp-addon) | 最小構成 (port 9876 で Python 実行) | 4.0→5.x (5.1.1 でテスト) | 不明 | 学習用 |
| projects.blender.org `lab/blender_mcp` | Blender Foundation の Gitea に存在 | 不明 | 不明 | **[未確認]** 403 で内容を取得できず。「公式 MCP」と呼べるものは見つからなかった。blendermcp.org 等の "Official" 表記はマーケティング |

商用: 3D-Agent (有償デスクトップアプリ)。BlenderGPT は衰退 ([StraySpark 比較](https://www.strayspark.studio/blog/blender-mcp-vs-ai-addons-comparison-2026))。

#### ヘッドレス `blender -b --python script.py -- args` パターン **[確認済]**

兄弟リポジトリ `pixel-2d-game-art/scripts/mixamo_poses.py` が既にこの形 (`blender --background --python scripts/mixamo_poses.py -- --out ... --fbx-dir ...`、`sys.argv` の `--` 以降を自前パース、例外時に `sys.exit(1)`)。Bun からは `Bun.spawn([BLENDER, "-b", "--python", script, "--", ...])` で呼び、stdout の `[tag]` 行で進捗を拾う。

Windows での注意 **[要検証]**:
- EEVEE を `-b` で使うには GPU コンテキストが要る。**アクティブなデスクトップセッションがあれば `blender -b` で EEVEE は動く**。サービス / ログオフ状態 / ディスプレイ無しの純ヘッドレスは Windows では不可 ([Medium: EEVEE on headless](https://medium.com/@jjziets/how-to-rendering-blender-eevee-on-a-headless-system-d3054ced8ec), [Manual: EEVEE Limitations](https://docs.blender.org/manual/en/latest/render/eevee/limitations/limitations.html))。Workbench / Cycles は制約が緩い。
- Blender 5.2 の既定 GPU バックエンドは OpenGL。Vulkan 既定化は 5.3 予定 ([5.3 release notes](https://developer.blender.org/docs/release_notes/5.3/eevee/))。5.1〜5.2 で Vulkan クラッシュ報告 ([#157029](https://projects.blender.org/blender/blender/issues/157029)) があるので、バッチでは `--gpu-backend opengl` を明示しておくと安全 ([Command Line Arguments](https://docs.blender.org/manual/en/latest/advanced/command_line/arguments.html))。

#### 使い分け

| 用途 | 推奨 |
|---|---|
| 「今の Tripo モデルのボーン名は?」「このアクションのフレーム範囲は?」「カメラ角度 25° と 35° でどう見える?」— 探索・検査・1 回限りの試行 | **MCP** (`get_object_info` / `execute_blender_code` / `get_viewport_screenshot`) |
| 8 方向 × N モーション × M フレームのレンダ、リターゲット、リメッシュ — 再現性・並列・CI | **ヘッドレススクリプト** (Bun → `blender -b --python`) |
| スクリプトのデバッグ | MCP で対話的に断片を実行 → 確定したら `.py` に落とす |

MCP の 180 秒制限とメインスレッド占有を考えると、**レンダ本体を MCP 経由で回すのは不適**。MCP は「見る・測る・試す」に限定する。

### A-3. Tripo 製キャラクターに対して bpy でスクリプト化できる制作タスク

#### インポート **[確認済 / 一部要検証]**

- GLB: `bpy.ops.import_scene.gltf(filepath=...)`。FBX: `bpy.ops.import_scene.fbx(filepath=...)` (Mixamo は 0.01 スケールで入る。`mixamo_poses.py` の `head_frame` コメント参照)。
- Tripo Auto Rig の出力は GLB/FBX どちらも可、複数アニメを 1 ファイルに同梱でき Blender では別 Action として入る ([Tripo blog: Import pre-rigged](https://www.tripo3d.ai/blog/collect/how-to-import-and-render-pre-rigged-characters-in-blender-yflw3jahoc0)) **[要検証]**。
- Blender 4.4+ の **Slotted Actions**: `obj.animation_data.action = act` の後にスロットが自動割当されない場合があり、`obj.animation_data.action_slot = act.slots[0]` (または `action_suitable_slots[0]`) を明示するのが公式推奨。旧 API は「5.0 で削除」と予告されていた ([Slotted Actions upgrading](https://developer.blender.org/docs/release_notes/4.4/upgrading/slotted_actions/))。`mixamo_poses.py` は自動割当に依存しているので、Tripo GLB (複数 Action) では明示割当を足す **[要検証]**。

#### リトポロジー (ヘッドレスで可能な手段)

| 手段 | 呼び方 | 品質 / 備考 |
|---|---|---|
| Remesh modifier (VOXEL / SMOOTH / SHARP / BLOCKS) | `m = obj.modifiers.new("R", 'REMESH'); m.mode='VOXEL'; m.voxel_size=0.02` | 非破壊、ヘッドレス安定。Voxel は四角面にならない。5.2 で Voxel remesher が属性 (頂点カラー等) を補間するよう改善 ([5.2 LTS notes](https://developer.blender.org/docs/release_notes/5.2/)) |
| 破壊的 Voxel Remesh | `obj.data.remesh_voxel_size=...; bpy.ops.object.voxel_remesh()` | modifier 版より結果が良いとされる ([Artisticrender](https://artisticrender.com/remeshing-in-blender/)) |
| QuadriFlow | `bpy.ops.object.quadriflow_remesh(target_faces=..., mode='FACES')` | 内蔵の唯一の quad リメッシャ。bpy 経由でクラッシュ報告 ([#124004](https://projects.blender.org/blender/blender/issues/124004)) **[要検証: 5.2 での状況]** |
| Decimate modifier | `'DECIMATE'`, `decimate_type='COLLAPSE'/'PLANAR'`, `use_symmetry` | 三角形化されるが sprite 用途なら十分 |
| Instant Meshes CLI | `Instant Meshes.exe in.obj -o out.obj -f 5000 -d -c 30` (`-v/-f/-s` は排他, `-d` 決定論, `-S` smooth) | 無料、Bun から `spawn` 可 ([main.cpp](https://github.com/wjakob/instant-meshes/blob/master/src/main.cpp)) |
| AutoRemesher CLI | huxingyi/autoremesher | CLI モードあり ([repo](https://github.com/huxingyi/autoremesher)) |
| QuadWild 系 | QRemeshify ($7, extension)、MutaMesh (Instant Meshes / QuadWild / CWF / AdapTropic 同梱) | GUI 前提。bpy から operator 呼びは可能かもしれないが未確認 |
| Quad Remesher (Exoside) | 有償 | 業界標準だが CLI 無し |

2026 時点で Blender 内蔵の「新 quad remesh」は無い (QuadriFlow のみ)。**スプライトレンダ目的ならリトポ不要** (Tripo メッシュのまま描画すれば良い)。3D ゲームで実機に載せる場合のみ Decimate か Instant Meshes。

#### テクスチャベイク (hi → low) **[確認済: API / 要検証: 5.x のバグ]**

- Cycles 必須。`scene.render.engine='CYCLES'`; `bake = scene.render.bake; bake.use_selected_to_active=True; bake.cage_extrusion=0.02; bake.max_ray_distance=0.1`; ターゲット材質に `ShaderNodeTexImage` を作り `nodes.active` にしてから `bpy.ops.object.bake(type='DIFFUSE', pass_filter={'COLOR'})` / `type='NORMAL'` ([BakeSettings](https://docs.blender.org/api/current/bpy.types.BakeSettings.html))。
- 5.0 で「`bpy.ops.object.bake()` から cage object が evaluated scene に見つからない」バグ報告 ([#151027](https://projects.blender.org/blender/blender/issues/151027)) — 修正状況未確認。cage を使わず `cage_extrusion` で代替すれば回避できる **[要検証]**。
- Tripo は既にテクスチャ付きで出力するので、ベイクが要るのはリトポ後だけ。

#### リギング

| 手段 | 自動化 | 備考 |
|---|---|---|
| **Tripo Auto Rig API** | ○ (TS から) | `spec: "tripo" | "mixamo"`, `out_format: glb|fbx`, `rig_type: biped/quadruped/hexapod/octopod/avian/serpentine/aquatic`, 25 credits, ~30 s。`v1.0-20240301` (人型, 90+ プリセット) / `v2.5-20260210` (非人型) ([Tripo Rig docs](https://developers.tripo3d.ai/en/docs/animations-rig), [Models/rig](https://developers.tripo3d.ai/en/models/rig), [python-sdk API.md](https://github.com/VAST-AI-Research/tripo-python-sdk/blob/master/docs/API.md)) |
| Mixamo Web auto-rigger | × (API 無し、手動アップロード) | 既に Tripo でリグ済みなら不要 |
| Rigify | △ | `import rigify; rigify.generate.generate_rig(bpy.context, metarig)` で Python から生成可 ([BlenderArtists](https://blenderartists.org/t/rigify-using-python-to-run-the-generate-rig-operation/1517713))。ただしメタリグをメッシュに合わせる工程が自動化困難 |
| Auto-Rig Pro | △ (有償) | Smart 自動配置 + Remap。バッチ実行の可否は未確認 |
| AccuRig (Reallusion) | × 無料 GUI | |
| Blender 5.2 内蔵の新自動リグ | **無し** | 5.2 のアニメ改善は QoL 中心 ([5.2 LTS](https://www.blender.org/download/releases/5-2/)) |

#### アニメーション・リターゲット

Blender 5.2 に **内蔵のボーンマッピング型リターゲット機能は無い**。標準手段はコンストレイント (Copy Rotation / Copy Location / Copy Transforms) + `bpy.ops.nla.bake(visual_keying=True, clear_constraints=True, bake_types={'POSE'})` ([nla.bake](https://docs.blender.org/api/current/bpy.ops.nla.html))。

| ツール | 5.x | 自動化 | 備考 |
|---|---|---|---|
| Rokoko Studio Live (本家) | 5.x で retarget がエラー | `bpy.ops.rsl.*` (`rsl.build_bone_list` 等) | 本家 [Rokoko/rokoko-studio-live-blender](https://github.com/Rokoko/rokoko-studio-live-blender) は更新停滞。コミュニティ fork [abaqDev/Rokoko-Blender-Addon](https://github.com/abaqDev/Rokoko-Blender-Addon) が 5.x 修正 (LGPL-3.0)。Auto Detect で Mixamo 名は認識 **[要検証: ヘッドレス実行]** |
| "Retarget" extension | **5.0+ 専用** | 不明 | Mixamo / Unreal / Vroid / MMD / Daz / ARP プリセット ([extensions.blender.org/retarget](https://extensions.blender.org/add-ons/retarget/)) |
| Mwni/blender-animation-retargeting | 不明 | `baking.py` に `nla.bake` 例 | 手動マッピング ([repo](https://github.com/Mwni/blender-animation-retargeting)) |
| mixaify-retarget | **5 専用** | UI のみ | Mixamo → Rigify 限定 (GPL-3) ([repo](https://github.com/netherby/mixaify-retarget)) |
| Auto-Rig Pro Remap | ○ | 有償 | |
| **Tripo Animation Retarget API** | — | ○ (TS から) | SDK enum: idle/walk/run/dive/climb/jump/slash/shoot/hurt/fall/turn + 非人型 5 種。`bake_animation`, `export_with_geometry` オプション ([Retarget docs](https://developers.tripo3d.ai/en/docs/animations-retarget)) |

#### Mixamo / Quaternius UAL の FBX を Tripo リグに当てる

- **Tripo のボーン名 [確認済]**: API の `spec` で `"tripo"` (native) と `"mixamo"` (Mixamo 互換名) を選べる。`mixamo` を指定すれば `Hips / Spine / Spine1 / Spine2 / Neck / Head / LeftArm / LeftForeArm / LeftHand / LeftUpLeg / LeftLeg / LeftFoot ...` 系の名前になるはず。**`mixamorig:` 名前空間プレフィックスが付くかは未確認 [未確認]** → 取得後に `bpy` で `[b.name for b in arm.data.bones]` を確認し、`mixamo_poses.py` の `RIGS[...]["prefix"]` に合わせる。
- native `tripo` 名の完全な一覧は公開 doc に見当たらなかった。第三者評価では「UE5 Manny/Quinn に近い命名」とされ、UE 5.7 でのリターゲットは最もクリーン ([StraySpark showdown 2026-05](https://www.strayspark.studio/blog/ai-auto-rigging-showdown-2026-tripo-meshy-cascadeur-mixamo))。肩・胸のウェイトが甘く、広い肩パッドは腕上げで潰れる、との指摘。
- 名前が一致しても **レストポーズ / ボーンロールが異なると Action の直接割当は破綻**する (Mixamo は T ポーズ、Tripo は入力メッシュの姿勢依存)。安全策は「Mixamo アーマチュアを同シーンに import → Tripo リグの各ボーンに `COPY_ROTATION` (WORLD→WORLD)、Hips に `COPY_LOCATION` → `nla.bake` → Mixamo アーマチュア削除」。ボーン名の対応表があればこれは完全に bpy で自動化できる。
- Quaternius UAL (`pelvis / thigh_l / calf_l / upperarm_l ...` = UE 命名) は `mixamo_poses.py` の `RIGS["quaternius"]` に既に対応表がある。同じ辞書を Tripo(native) にも増やせば 3 リグを同じコードで扱える。
- 現実的な最短経路: **プリセットで足りる動き (idle/walk/run/jump/hurt/fall/...) は Tripo Retarget API に任せ、足りない動きだけ Mixamo/UAL → Blender リターゲット**。

---

## Topic B: リグ済みキャラの 8 方向トップダウン (3/4 視点) スプライトシートをヘッドレスでレンダ

### B-1. カメラ設定

- **正射影**: `cam.data.type='ORTHO'`。`ortho_scale` は「画面の長辺に収まるワールド単位数」(sensor_fit AUTO のとき、正方形なら縦=横) ([Manual: projections](https://docs.blender.org/manual/en/latest/editors/3dview/navigate/projections.html))。
- **仰角**: `mixamo_poses.py` は 25°。ジャンル別の目安: サイドビュー 0° (DKC)、トップダウン 3/4 は 30〜45°、true isometric は 35.264° (`atan(1/√2)`)、"true top-down" 60〜90°。Diablo 2 はアイソメトリック視点で 8 (モンスター) / 16 (プレイヤー) 方向、ライトもカメラと一緒に回した ([Autodesk forum: Diablo 2 style](https://forums.autodesk.com/t5/3ds-max-forum/rendering-character-animation-sprites-diablo-2-style/td-p/7057434))。
- **8 方向**: 「カメラを 45° 刻みで回す」(mixamo_poses.py の `place_camera(az, el)`) か「キャラ (親 Empty) を回す」(FoozleCC: `obj.rotation_euler[2] = radians(angle)`、DirectionalSpriteBatchRender: `RotationOrigin` Empty をターンテーブルに)。**ライトをワールド固定にするならキャラ回転、カメラ追従にするならどちらでも同じ**。既存コードはカメラ回転 + `base_yaw` 補正で、Mixamo の -Y 向きを "down" に合わせている。
- **pixel-per-unit を一定に**: キャラごとに `ortho_scale = height*1.15` で fit させると PPU が変わる。ゲーム内で複数キャラを並べるなら **`ortho_scale` を固定** (例: 2.4 m を 128 px に → 53.3 px/m) して、`ppu = res / ortho_scale` を JSON に書き出す。
  - 高さ H のキャラを N px 正方形に収めるなら `ortho_scale = H*(1+margin)` だが、仰角 e では投影高さは `H*cos(e) + depth*sin(e)` になるので、`margin` は 25° で 15〜20% 見ておく。
- **ピボット**: 既存コードは `target = (hips.x, hips.y, ground_hips_z)` = 腰の XY を追従しつつ Z は地面固定 (しゃがみが画面内で沈む)。ルートモーション込みでワールド固定にしたいなら `target = (0,0,ground)`。足元を固定行に置くには、ターゲットを地面から `ortho_scale*(0.5 - foot_ratio)` だけ上にずらす (foot_ratio = 足元を置きたい行の割合、例 0.85)。
- 正射影ではカメラ距離は見た目に影響しないが、`CAM_DIST=10` と `clip_start/end`、深度パスの `DEPTH_RANGE` は既存コードのまま流用できる。

### B-2. レンダ設定

| エンジン | ID (5.x) | 向き | 備考 |
|---|---|---|---|
| Workbench | `BLENDER_WORKBENCH` | フラット / 高速 / ヘッドレス最安定 | `scene.display.shading.light='FLAT'|'STUDIO'|'MATCAP'`, `color_type='TEXTURE'`, `show_object_outline=True` (アウトライン), `show_cavity`, `scene.display.render_aa='OFF'|'FXAA'|'5'...`。既存の depth 用エンジン |
| EEVEE (Next) | `BLENDER_EEVEE` (4.2〜4.x は `BLENDER_EEVEE_NEXT`) **[要検証: 5.x の enum 名]** | トゥーン / 影 / ノーマルパス | `scene.eevee.taa_render_samples` (pixel art は 1〜4, HD は 16〜64), `scene.render.filter_size` (既定 1.5 px; 0 でシャープ。4.3+ はビューポートだけ blur するがレンダはピクセル化される [#130669](https://projects.blender.org/blender/blender/issues/130669); 0.70 px が 2×2 アーティファクト回避の妥協点) |
| Cycles | `CYCLES` | 正確なノーマル / shadow catcher 内蔵 | 遅い。`obj.is_shadow_catcher=True` で影だけを別出力に出せる |

- **透過背景**: `scene.render.film_transparent=True`, `image_settings.color_mode='RGBA'`, PNG は premultiplied alpha で書き出される。
- **アンチエイリアス**: ピクセルアート向けは OFF (`filter_size=0`, samples=1, Workbench `render_aa='OFF'`) か **4× でレンダして nearest/area で縮小** (後述)。HD スプライトは通常の AA。
- **アウトライン**: (a) Workbench の `show_object_outline` (1 px、色は `scene.display.shading.object_outline_color`)、(b) Freestyle (`scene.render.use_freestyle`、EEVEE/Cycles、太さ調整可だが遅い)、(c) inverted hull = Solidify modifier + 裏面材質 (EEVEE、4/5 で有効 [KTCG](https://ktcg.art/creating-solid-outlines-in-blender))、(d) **後処理**: 既存 TS pixelate モジュールでアルファ境界から 1 px 縁取り — これが最も制御しやすい。
- **トゥーン**: EEVEE のみ `ShaderNodeShaderToRGB` → `ColorRamp` (Constant) → Emission。Tripo 材質 (Principled + テクスチャ) を走査して差し替えるヘルパを bpy で書く。
- **ライティングを 8 方向で一定にするか**:
  - *カメラに親子付け* (`light.parent = cam`): 画面上の光の向きが常に同じ (例: 左上から)。**2D ゲームの可読性・タイル整合は最良**。Diablo 2 流。欠点: 物理的には「キャラが回ると光も回る」ので背面の陰影がない。
  - *ワールド固定*: 「上向き」と「下向き」で明るさが変わり、方向をプレイヤーが読み取りやすい反面、暗い方向の frame が潰れる。
  - 推奨: **キー光をカメラ親子、弱いフィル/リムをワールド固定**の混合。動的ライティングが欲しければ後述のノーマルパスを別出力。
- **影**: 本体レンダには落ち影を含めず (`light.use_shadow=False` or 地面を置かない)、影は (a) エンジン側で楕円ブロブ、(b) Cycles shadow catcher 平面のみを別パスで `shadow/<dir>/<k>.png` に出す、のどちらか。EEVEE には shadow catcher が無く、Shader-to-RGB トリックが要る ([Artisticrender](https://artisticrender.com/how-to-create-a-shadow-catcher-with-eevee-in-blender/))。
- **解像度**: 最終 128 px なら 512 px でレンダ (`resolution_percentage=100`, AA ON) → TS 側で area 縮小 → nearest。Blender 内で完結させたいなら compositor の Scale (nearest) ×0.25 → ×4 / Pixelate ノード ([Artisticrender: pixelate](https://artisticrender.com/how-to-pixelate-an-image-using-the-compositor-in-blender/))。Blender Studio の 4.2 記事 ([3D Pixel Art in Blender](https://studio.blender.org/blog/3d-pixel-art-in-blender/)) と Lucas Roedel の無料アドオン (EEVEE, Bayer dithering, 5.0 対応 [Gumroad](https://lucasroedel.gumroad.com/l/pixel_art)) は「低解像度で直接レンダ + filter_size 0」派。

### B-3. アニメーション

- 既存: `action.frame_range` → `frame_times(start, end, n, loop)` で等間隔サンプル → `scene.frame_set(int(t), subframe=frac)` → `view_layer.update()` → `render.render(write_still=True)`。この構造はそのまま使える。
- **NLA / コンストレイント使用時**: リターゲットをコンストレイントで行った場合は先に `nla.bake(frame_start, frame_end, visual_keying=True, clear_constraints=True, bake_types={'POSE'}, use_current_action=False)` で Action 化してから同じループに乗せる。
- **出力命名**: `<out>/<motion>/<dir>/<k>.png` (既存の depth/json と同じ階層に `k.png`, `k.normal.png`, `k.shadow.png` を追加)。`dir` は既存の `DIRS8 = down, downright, right, upright, up, upleft, left, downleft`。
- **高速化**: フレームごとの `render.render(write_still=True)` は起動オーバーヘッドが大きい。方向ごとに `scene.frame_start/end/step` を設定して `render.render(animation=True)` + `render.filepath = ".../<dir>/"` にすると 1 回の呼び出しで連番が出る (等間隔サンプルは `frame_step` で近似するか、事前に Action を bake し直す)。
- **速度の目安 [要検証: 公開ベンチ無し]**: 512² / EEVEE / samples 4 / RTX 4080 で 0.1〜0.5 s/frame、Workbench はさらに速い、Cycles は数秒/frame。8 方向 × 10 モーション × 8 frame = 640 枚 → EEVEE で数分、Cycles で 30 分前後の見積り。Blender 起動 (~3〜5 s) と FBX/GLB import が固定費なので **1 プロセスで全モーションを回す** (既存設計どおり)。
- EEVEE を `-b` で回す時は前述のとおりデスクトップセッションが必要。CI/サービス化するなら Workbench か Cycles に落とす。

### B-4. 既存ツール / スクリプト / 参照パイプライン

**スクリプト・アドオン** (いずれも「カメラかキャラを 45° 刻みで回してフレームループ」という同じ構造。Blender 5.x 対応を明記しているものは無い):

| 名前 | 内容 | 対応 |
|---|---|---|
| [FoozleCC/blender_scripts render_8_direction_sprites](https://github.com/FoozleCC/blender_scripts/blob/main/render_8_direction_sprites) | オブジェクト回転、256², `run_0_001.png` 命名、ノーマルマップ出力オプション | 版不明 (itch に有償チュートリアル) |
| [Maghwyn/blender_directional_spritesheets](https://github.com/Maghwyn/blender_directional_spritesheets) | FoozleCC 派生、4/8/16/32 方向、Rust 製シート結合 + Unity importer | MIT |
| [chrishayesmu/Blender-Spritesheet-Renderer](https://github.com/chrishayesmu/Blender-Spritesheet-Renderer) | 回転 + アニメ + マテリアル切替 (normal/AO 等)、JSON メタ | Blender 2.9、ImageMagick 必須 |
| [chronicleroflegends/DirectionalSpriteBatchRender](https://github.com/chronicleroflegends/DirectionalSpriteBatchRender) | ターンテーブル Empty、1/8/16/任意方向、Doom 命名、AA 切替 | GPL-3 |
| [Duckonaut/spriteinator](https://github.com/Duckonaut/spriteinator) | Action ごと × N 方向、Godot 4.1 リソース出力 | 3.6 で確認、MIT |
| [Zeerus/blender_sprite_maker](https://github.com/Zeerus/blender_sprite_maker) | 8 台の ortho カメラ (45° 上, 45° 刻み) の .blend 例 | |
| [PaulBenMarsh/BlenderAPI-IsometricSpritesheet](https://github.com/PaulBenMarsh/BlenderAPI-IsometricSpritesheet) | アイソメ投影スプライトシート | |
| [johnferley/Game-Sprite-Creator](https://github.com/johnferley/Game-Sprite-Creator) | 2.8 アドオン | |
| [Pre Render Creator (PRC)](https://viniguerrero.itch.io/pre-render-creator) | 有償 $17.99、4/8 方向プリセット、シート化 | 2.8x/2.9x |
| [8 Directions Render Plugin](https://auteddy.gumroad.com/l/8d_blender_plugin) | 有償 | |
| [Lucas Roedel Pixel Art Rendering](https://lucasroedel.gumroad.com/l/pixel_art) | 無料、EEVEE、Bayer ディザ、複数光源 | **5.0 対応** |
| [Tramshy/pixel-art-addon-mod](https://github.com/Tramshy/pixel-art-addon-mod) | 上記の改造版 | |

**Aseprite 連携**: CLI は `aseprite -b frames/*.png --sheet out.png --data out.json` でシート化できる ([Aseprite CLI docs](https://www.aseprite.org/docs/cli/))。逆方向 (シート → .aseprite) は CLI オプションが無く、Lua スクリプト (`app.command.ImportSpriteSheet`) で行う ([API](https://aseprite.org/api/command/ImportSpriteSheet))。本プロジェクトは TS で PNG を扱えるので Aseprite は任意。

**参照パイプライン**:
- **Donkey Kong Country (1994, Rare)**: SGI ワークステーション + Alias でモデリング/レンダし、SNES 用にキーフレームをスプライト化 ([GameGrin](https://www.gamegrin.com/articles/why-donkey-kong-country-was-a-technical-marvel/))。サイドビュー (方向は左右のみ)。
- **Diablo 2 (2000)**: 3DS Max、アイソメ視点で 8/16 方向、ライトもカメラと一緒に回転 ([Autodesk forum](https://forums.autodesk.com/t5/3ds-max-forum/rendering-character-animation-sprites-diablo-2-style/td-p/7057434), [GameDev.net](https://www.gamedev.net/forums/topic/44506-diablo2-graphics/))。
- **Fallout 1/2**: プリレンダ、ヘクスグリッドに合わせて **6 方向** **[要検証: 本調査では裏取りせず、一般知識]**。
- **Dead Cells (2017)**: 3DS Max でラフなモデル → 自作レンダラで **AA 無し**の小サイズ描画 + **ノーマルマップ**を同時出力して 2D 側で動的ライティング、フレーム毎に手直し最小限 ([Game Developer deep dive](https://www.gamedeveloper.com/production/art-design-deep-dive-using-a-3d-pipeline-for-2d-animation-in-i-dead-cells-i-), [80.lv](https://80.lv/articles/case-study-dead-cells-character-art-pipeline))。
- **Enter the Gungeon**: 手描きピクセルアートで 3D プリレンダではない (質問の「?」への回答)。

### B-5. ピクセルアート化の後処理 (既に TS pixelate モジュールがある前提で要点のみ)

- **縮小**: 4× → 1× は area (box) 平均で縮小 → その後は nearest のみ。透過はプリマルチプライで平均しないと縁が黒ずむ。
- **パレット量子化**: Oklab 距離で最近傍、ディザ無し (スプライトはチラつくため)。方向・フレーム間で同じパレットを使う (モーション全体で一括してパレット抽出)。
- **アウトライン**: アルファ境界の外側 1 px に最暗色。
- **ノーマルマップ・スプライト** (Dead Cells 方式):
  - `view_layer.use_pass_normal=True` → Render Layers の `Normal` 出力 (EEVEE/Cycles とも **ワールド空間**、[Manual: Passes](https://docs.blender.org/manual/en/latest/render/layers/passes.html))。2D エンジンは **ビュー空間**を期待するので、compositor で扱うより **OpenEXR で生ベクトルを保存 → TS 側で `cam.matrix_world.inverted()` の回転成分を掛けて `n*0.5+0.5` にエンコード**する方が確実。G 反転 (OpenGL/DirectX 規約) もエンジンに合わせて TS で。
  - PNG に直接出す場合は `view_settings.view_transform='Standard'`, `display_settings`/色管理を無効化、16 bit ([Koder: normal map sprites](https://games.kodera.pl/dev/render-sprites-with-normal-maps-in-blender/))。
  - ノーマルは縮小後に再正規化する。カメラ回転で 8 方向ぶん法線が変わるので、方向ごとに変換行列が異なる点に注意。
  - 既存の `setup_depth_compositor` (`scene.compositing_node_group` = 5.x の compositor API) と同じやり方で Normal 用ノードグループを追加できる。

### B-6. 既存資産 (`pixel-2d-game-art/scripts/mixamo_poses.py`) からの拡張方針

そのまま流用できるもの: `parse_args`, `clear_scene`, `import_armature`, `setup_camera` (ORTHO), `place_camera(az, el)`, `rest_height`, `base_yaw`, `frame_times`, `RIGS` 辞書 (mixamo/quaternius)、Action の名前解決 (`Armature|Armature|Walk_Loop`)、`DIRS8/AZIMUTH`、`--` 以降の引数規約、`SystemExit`/traceback で exit 1。

追加が必要なもの:
1. `RIGS["tripo"]` (Tripo native 名) — 実物のボーン名を MCP で読んでから作る。`spec: "mixamo"` で取得したなら `RIGS["mixamo"]` に `prefix` 調整で乗る。
2. `--mesh path.glb` (Tripo リグ済み GLB を `import_scene.gltf` で読み、Action は Mixamo/UAL FBX から持ってくる) と、コンストレイント + `nla.bake` のリターゲット関数。Slotted Actions の `action_slot` 明示。
3. `--pass color|depth|normal|shadow` と `--engine workbench|eevee|cycles` の切替。color は `RGBA`, `film_transparent`, `filter_size`, `taa_render_samples` を CLI から設定。
4. ライトリグ (`light.parent = cam`) と、`--ortho-scale` 固定 (指定が無ければ従来の `height*1.15`)。
5. 出力 `<out>/<id>/<dir>/<k>.png` + `meta.json` (ppu, ortho_scale, elev, frame times, ボーン名一覧)。

---

## 推奨構成

### 1. Blender ヘッドレススクリプト計画 (`scripts/render_sprites.py` を `mixamo_poses.py` から派生)

1. **入力**: `--mesh <tripo_rigged.glb|fbx>`、`--motions motions.json` (既存形式: `{id, fbx|action, frames, loop}` に `source: "tripo"|"mixamo"|"ual"` を追加)、`--fbx-dir`、`--out`、`--size 512`、`--elev 25`、`--engine eevee`、`--ortho-scale 2.4` (省略時は fit)、`--passes color,depth,normal`、`--gpu-backend opengl` は Bun 側で `blender` の引数に付ける。
2. **起動**: Bun から `Bun.spawn([BLENDER, "-b", "--gpu-backend", "opengl", "--python", script, "--", ...args], {stdout: "pipe"})`。stdout の `[render_sprites]` 行を進捗として中継、exit code で失敗判定 (`.env` の `BLENDER` 解決は既に `paths.ts` の設計に含まれる)。
3. **シーン構築**: `clear_scene` → GLB/FBX import → armature/mesh 取得 → `rest_height`, `base_yaw` → ORTHO カメラ + カメラ親子のキー光 (Sun, `use_shadow=False`) + 弱いワールド固定フィル → `film_transparent`, `RGBA`, `filter_size` (0 or 0.7), `taa_render_samples` (4)。Tripo 材質をトゥーン化するなら `ShaderToRGB+ColorRamp` に差し替えるヘルパを `--toon` で有効化。
4. **アニメーション適用**: `source=="tripo"` → GLB 内 Action を名前で `animation_data.action` + `action_slot` 明示。`source=="mixamo"/"ual"` → 該当 FBX を import、ボーン対応表で `COPY_ROTATION`/`COPY_LOCATION` を張り、`nla.bake(...clear_constraints=True)` → 補助アーマチュア削除。
5. **ループ**: motion → dir (8) → frame (等間隔 `frame_times`) → `frame_set` → `place_camera(AZIMUTH[d]+yaw, elev)` → pass ごとに `render.filepath` を切替えて `render.render(write_still=True)`。Normal は EXR (`image_settings.file_format='OPEN_EXR'`, `color_depth='16'`) で出し、Depth は既存 compositor をそのまま。
6. **メタ出力**: `<out>/meta.json` に `ppu`, `ortho_scale`, `elev`, `size`, `dirs`, motion ごとの frame times、ボーン名一覧、Blender バージョン。
7. **後処理 (TS)**: 既存 pixelate モジュールで 4× → 1× area 縮小、パレット量子化 (Oklab)、アウトライン、Normal のビュー空間変換 + G 反転、影パスの合成 or ブロブ生成、シート化 (`sharp` で結合、Aseprite 形式 JSON 互換のフレームメタ)。
8. **検証**: `--dry-run` で 1 motion × 2 dir × 1 frame だけレンダして PNG の alpha bbox と足元行を assert。Workbench でまず通し、EEVEE に切り替えてトゥーン/影を詰める。

### 2. MCP 利用計画

- **設定**: `.mcp.json` の `args` を `["blender-mcp@1.9.1"]` に固定し `--with "mcp[cli]<2"` は外す (上流が `mcp<2` をピン済み)。`DISABLE_TELEMETRY=true` 維持、`BLENDER_MCP_SAFE_MODE=1` 追加。ポート 9876 が塞がれたら `BLENDER_PORT=9001` を両側に設定。
- **アドオン整理**: `%APPDATA%\Blender Foundation\Blender\5.2\scripts\addons\` の `blender_mcp.py`, `addon.py.bak`, `blender-mcp-main/` を削除し `addon.py` (protocol 5) だけ残す → Blender 5.2 で "Interface: MCP for Blender" を再有効化 → `get_addon_status` が `up_to_date: true, blender_version: "5.2.1 LTS"` を返すことを確認 (5.x 互換性の実地確認になる)。
- **使う場面** (すべて短いコマンドで、180 秒以内):
  1. Tripo GLB を MCP で import して `get_object_info` / `execute_blender_code` で **ボーン名・レストポーズ・高さ・Action 一覧** を取得 → `RIGS["tripo"]` を確定。
  2. 仰角 (25/30/35°)、`ortho_scale`、ライト方向を `execute_blender_code` で変えながら `get_viewport_screenshot` で見比べて数値を決める。
  3. トゥーン材質差し替え・アウトラインの見た目を 1 フレームで確認。
  4. リターゲットのコンストレイント設定を 1 ボーンずつ試し、破綻 (ロール違い) を目視。
- **使わない場面**: 8 方向 × 全モーションのレンダ、NLA bake の一括処理、リメッシュ/ベイク。これらは Bun → `blender -b` のスクリプトに落として再現性を確保する。
- **セーフティ**: MCP セッションの Blender は作業用の別 .blend にし、スクリプトで生成する成果物は常にヘッドレス経由で作り直せる状態を保つ。

---

## 主要出典一覧

- blender-mcp: [GitHub](https://github.com/ahujasid/blender-mcp) / [PyPI](https://pypi.org/project/blender-mcp/) / [pyproject.toml](https://raw.githubusercontent.com/ahujasid/blender-mcp/main/pyproject.toml) / [commits (pyproject)](https://github.com/ahujasid/blender-mcp/commits/main/pyproject.toml) / [Issue #185](https://github.com/ahujasid/blender-mcp/issues/185) / [Issue #193](https://github.com/ahujasid/blender-mcp/issues/193) / [Issue #219](https://github.com/ahujasid/blender-mcp/issues/219) / [DeepWiki troubleshooting](https://deepwiki.com/ahujasid/blender-mcp/6.2-error-handling-and-troubleshooting)
- MCP SDK 2.0: [What's new in v2](https://py.sdk.modelcontextprotocol.io/v2/whats-new/) / [Zuplo](https://zuplo.com/learn/mcp/errors/no-module-named-mcp-server-fastmcp)
- 代替 MCP: [RFingAdam/mcp-blender](https://github.com/RFingAdam/mcp-blender) / [glonorce/Blender_mcp](https://github.com/glonorce/Blender_mcp) / [PoBruno/mcp-blender-agent](https://github.com/PoBruno/mcp-blender-agent) / [6xvl/blender-mcp](https://github.com/6xvl/blender-mcp) / [Oli97430/blender-mcp-addon](https://github.com/Oli97430/blender-mcp-addon) / [StraySpark comparison](https://www.strayspark.studio/blog/blender-mcp-vs-ai-addons-comparison-2026)
- Blender 5.x: [5.2 LTS](https://www.blender.org/download/releases/5-2/) / [5.2 release notes](https://developer.blender.org/docs/release_notes/5.2/) / [5.0 Python API](https://developer.blender.org/docs/release_notes/5.0/python_api/) / [5.1 Python API](https://developer.blender.org/docs/release_notes/5.1/python_api/) / [Slotted Actions upgrading](https://developer.blender.org/docs/release_notes/4.4/upgrading/slotted_actions/) / [Add-ons (legacy)](https://docs.blender.org/manual/en/latest/advanced/extensions/addons.html) / [Command line args](https://docs.blender.org/manual/en/latest/advanced/command_line/arguments.html) / [EEVEE limitations](https://docs.blender.org/manual/en/latest/render/eevee/limitations/limitations.html) / [EEVEE headless (Medium)](https://medium.com/@jjziets/how-to-rendering-blender-eevee-on-a-headless-system-d3054ced8ec) / [Vulkan default in 5.3](https://developer.blender.org/docs/release_notes/5.3/eevee/) / [#157029 Vulkan crash](https://projects.blender.org/blender/blender/issues/157029) / [#130669 filter_size 0](https://projects.blender.org/blender/blender/issues/130669) / [Passes](https://docs.blender.org/manual/en/latest/render/layers/passes.html) / [BakeSettings](https://docs.blender.org/api/current/bpy.types.BakeSettings.html) / [#151027 bake cage](https://projects.blender.org/blender/blender/issues/151027) / [nla.bake](https://docs.blender.org/api/current/bpy.ops.nla.html) / [#124004 quadriflow crash](https://projects.blender.org/blender/blender/issues/124004) / [Remeshing manual](https://docs.blender.org/manual/en/latest/modeling/meshes/retopology.html)
- Tripo: [Auto Rig](https://developers.tripo3d.ai/en/docs/animations-rig) / [Models: Rig](https://developers.tripo3d.ai/en/models/rig) / [Animation Retarget](https://developers.tripo3d.ai/en/docs/animations-retarget) / [python-sdk API.md](https://github.com/VAST-AI-Research/tripo-python-sdk/blob/master/docs/API.md) / [StraySpark auto-rigging showdown](https://www.strayspark.studio/blog/ai-auto-rigging-showdown-2026-tripo-meshy-cascadeur-mixamo) / [Cinevva rigging guide](https://app.cinevva.com/guides/free-character-animations-rigging)
- リターゲット: [Rokoko 本家](https://github.com/Rokoko/rokoko-studio-live-blender) / [abaqDev fork (5.x)](https://github.com/abaqDev/Rokoko-Blender-Addon) / [Retarget extension](https://extensions.blender.org/add-ons/retarget/) / [Mwni retargeting](https://github.com/Mwni/blender-animation-retargeting) / [mixaify-retarget](https://github.com/netherby/mixaify-retarget) / [Rigify from Python](https://blenderartists.org/t/rigify-using-python-to-run-the-generate-rig-operation/1517713) / [Auto-Rig Pro](https://superhivemarket.com/products/auto-rig-pro)
- リメッシュ: [Instant Meshes main.cpp](https://github.com/wjakob/instant-meshes/blob/master/src/main.cpp) / [AutoRemesher](https://github.com/huxingyi/autoremesher) / [QRemeshify](https://github.com/ksami/QRemeshify) / [MutaMesh](https://superhivemarket.com/products/mutamesh/docs) / [Gachoki retopo addons 2026](https://gachoki.com/best-blender-addons-for-retopology/)
- スプライト: [FoozleCC](https://github.com/FoozleCC/blender_scripts/blob/main/render_8_direction_sprites) / [Maghwyn](https://github.com/Maghwyn/blender_directional_spritesheets) / [chrishayesmu](https://github.com/chrishayesmu/Blender-Spritesheet-Renderer) / [DirectionalSpriteBatchRender](https://github.com/chronicleroflegends/DirectionalSpriteBatchRender) / [spriteinator](https://github.com/Duckonaut/spriteinator) / [Zeerus](https://github.com/Zeerus/blender_sprite_maker) / [PaulBenMarsh](https://github.com/PaulBenMarsh/BlenderAPI-IsometricSpritesheet) / [Pre Render Creator](https://viniguerrero.itch.io/pre-render-creator) / [Lucas Roedel Pixel Art](https://lucasroedel.gumroad.com/l/pixel_art) / [Blender Studio pixel art](https://studio.blender.org/blog/3d-pixel-art-in-blender/) / [Artisticrender pixelate](https://artisticrender.com/how-to-pixelate-an-image-using-the-compositor-in-blender/) / [Artisticrender EEVEE shadow catcher](https://artisticrender.com/how-to-create-a-shadow-catcher-with-eevee-in-blender/) / [Koder normal-map sprites](https://games.kodera.pl/dev/render-sprites-with-normal-maps-in-blender/) / [Aseprite CLI](https://www.aseprite.org/docs/cli/)
- パイプライン史: [Dead Cells (Game Developer)](https://www.gamedeveloper.com/production/art-design-deep-dive-using-a-3d-pipeline-for-2d-animation-in-i-dead-cells-i-) / [Dead Cells (80.lv)](https://80.lv/articles/case-study-dead-cells-character-art-pipeline) / [Diablo 2 (Autodesk forum)](https://forums.autodesk.com/t5/3ds-max-forum/rendering-character-animation-sprites-diablo-2-style/td-p/7057434) / [DKC (GameGrin)](https://www.gamegrin.com/articles/why-donkey-kong-country-was-a-technical-marvel/)
