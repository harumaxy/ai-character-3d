---
name: comfyui-sdk
description: Use when writing or debugging TypeScript/Bun scripts that drive ComfyUI through @saintno/comfyui-sdk - building workflow graphs in code, queueing prompts, reading generated images, regenerating node types with cfli codegen, or fixing "no output"/onFailed/websocket-drop errors from a generation script.
---

# @saintno/comfyui-sdk

Typed client for ComfyUI. Build the prompt graph in TypeScript, queue it, await the
images. Two ways to build a graph — prefer the first:

1. **`WorkflowBuilder`** (codegen) — node classes and inputs are generated from a
   *running* ComfyUI instance, so `w.KSampler({...})` autocompletes and typos fail at
   compile time. Use for everything written in this repo.
2. **`PromptBuilder`** — wraps an exported `workflow_api.json` and patches values by
   path (`"3.inputs.seed"`). Use only when the graph must stay a JSON file (someone
   edits it in the ComfyUI web UI).

## This repo

- Generated types live in `src/types/nodes.ts`.
- Regenerate after installing models or custom nodes — ComfyUI must be running:
  ```bash
  bun run codegen      # cfli codegen -H http://127.0.0.1:8188
  bun run typecheck    # tsc --noEmit; catches every node/value name the regen invalidated
  ```
- Reference script: `src/workflows/anime-charsheet/turnaround.ts`, run with `bun run turnaround -- side`.
  Copy its shape for new generators. Connection, flag parsing, seeds, and the
  enqueue/collect cycle live in `src/lib/comfy.ts` — import it
  instead of reimplementing.
- Outputs go under `out/` (see CLAUDE.md); pass the subpath as `filename_prefix`.

## Script skeleton

```ts
import { CallWrapper, ComfyApi } from "@saintno/comfyui-sdk";
import { WorkflowBuilder } from "../../types/nodes";

const w = new WorkflowBuilder();
const ckpt = w.CheckpointLoaderSimple({ ckpt_name: "v1-5-pruned-emaonly-fp16.safetensors" });
const pos = w.CLIPTextEncode({ text: "a cat", clip: ckpt.CLIP });
const neg = w.CLIPTextEncode({ text: "blurry", clip: ckpt.CLIP });
const lat = w.EmptyLatentImage({ width: 1024, height: 1024, batch_size: 1 });
const smp = w.KSampler({
  model: ckpt.MODEL,
  positive: pos.CONDITIONING,
  negative: neg.CONDITIONING,
  latent_image: lat.LATENT,
  seed: 771001, steps: 20, cfg: 7,
  sampler_name: "euler", scheduler: "normal", denoise: 1,
});
const dec = w.VAEDecode({ samples: smp.LATENT, vae: ckpt.VAE });
const save = w.SaveImage({ images: dec.IMAGE, filename_prefix: "concepts/cat" });

// `outputs` maps a name -> node id; that name is the key on the result.
const workflow = w.build({ outputs: { images: save.__id } });

const api = await new ComfyApi(process.env.COMFY_URL ?? "http://127.0.0.1:8188")
  .init()
  .waitForReady();

const result = await new CallWrapper(api, workflow)
  .onProgress((p) => process.stdout.write(`\r${p.value}/${p.max}   `))
  .run();

// `run()` resolves to `false`/`undefined` on failure — narrow before reading outputs.
const files = (result ? (result.images.images ?? []) : []).map((f) =>
  [f.subfolder, f.filename].filter(Boolean).join("/"),
);
console.log(files);
api.destroy();
```

Wiring rule: an output slot (`ckpt.MODEL`, `smp.LATENT`) is a `NodeRef` tuple — pass it
straight into the next node's matching input. `node.__id` is the node id string, needed
only for `build({ outputs })`.

## Gotchas

- **`run()` resolves to `undefined` or `false` on failure**, never throws. Check the
  result, not a try/catch.
- **`onFailed` also fires on a websocket drop the job survives.** Treat it as fatal only
  when no image came back — stash the error and decide after `run()` resolves (see
  `runWorkflow` in `src/lib/comfy.ts`).
- **Codegen snapshots value lists**, so `LoadImage({ image })` only accepts filenames
  that existed in ComfyUI's `input/` at codegen time. For a freshly staged file, cast
  (`opts.image as LoadImageInputs["image"]`) rather than regenerating.
- **Always `api.destroy()`** — the websocket keeps the process alive otherwise.
- **`.init()` is sync, `.waitForReady()` is the await.** `init(maxTries, delayMs)` for a
  server that is still booting.
- Add a `--dry` flag that prints `workflow.prompt` instead of enqueueing; it is the
  fastest way to diff a graph against the ComfyUI UI export.

## Other pieces

- **Images**: `api.getPathImage(info)` → URL, `api.getImage(info)` → Blob,
  `api.uploadImage(bufferOrBlob, "name.png")` → puts a file in `input/` for `LoadImage`.
- **Inputs at run time**: `w.build({ inputs: { seed: smp.inputs.seed }, outputs: {...} })`,
  then `workflow.input("seed", seed())`. `seed()` is exported by the SDK. Only worth it
  when reusing one built graph across many calls — otherwise just rebuild the graph.
- **Bypassing nodes**: `workflow.bypass("12")` / `.reinstate("12")`.
- **Several GPUs**: `new ComfyPool([apiA, apiB], EQueueMode.PICK_ZERO)`, then
  `pool.run(fn)` / `pool.batch(fns)` where `fn = (api: ComfyApi) => Promise<T>`.
- **Server info**: `getCheckpoints()`, `getLoras()`, `getSamplerInfo()`, `getNodeDefs()`,
  `getSystemStats()`, `freeMemory(true, true)`, `interrupt()`.
- **Extensions**: `api.ext.manager` (ComfyUI-Manager), `api.ext.monitor` (Crystools GPU
  stats) — guard with `.isSupported`.
- **CLI**: `cfli -f workflow.json -i 4.inputs.ckpt_name=... -p 6.inputs.text="cat"` runs
  an exported workflow without writing a script.
- **Auth**: third `ComfyApi` arg — `{ credentials: { type: "basic" | "bearer_token" | "custom", ... } }`.
