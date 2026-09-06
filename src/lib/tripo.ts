/**
 * Tripo AI (API v3) via the official `@vastai/tripo-sdk`. This file only adds
 * what every stage wants on top of the SDK: env-based construction, upload
 * from a path, run-with-progress, download-to-path. API reference and credit
 * costs: docs/research/tripo-ai.md.
 *
 * Auth: TRIPO_API_KEY (`tsk_...`). Output URLs expire ~5 minutes after success,
 * so download right after waiting.
 */

import { basename, extname } from "node:path";
import { TripoClient, type Task, type WaitForTaskOptions } from "@vastai/tripo-sdk";

export { Animation, ModelVersion, RigSpec, RigType, type Task } from "@vastai/tripo-sdk";

export function tripoClient(): TripoClient {
  const apiKey = process.env.TRIPO_API_KEY;
  if (!apiKey) throw new Error("TRIPO_API_KEY is not set (see .env.example)");
  return new TripoClient({
    apiKey,
    ...(process.env.TRIPO_BASE ? { baseUrl: process.env.TRIPO_BASE } : {}),
  });
}

const MIME: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".glb": "model/gltf-binary",
  ".fbx": "application/octet-stream",
};

/** Upload a local file; returns the file_token to pass as `file` / `files[]`. */
export async function uploadFile(client: TripoClient, path: string): Promise<string> {
  const contentType = MIME[extname(path).toLowerCase()];
  if (!contentType) throw new Error(`tripo upload: unsupported file type ${path}`);
  const { file_token } = await client.uploadFile(await Bun.file(path).arrayBuffer(), {
    filename: basename(path),
    contentType,
  });
  return file_token;
}

/** Create + poll with a one-line progress readout. Throws on failed/cancelled. */
export async function runTask<P>(
  client: TripoClient,
  create: (params: P) => Promise<string>,
  params: P,
  label: string,
  wait: WaitForTaskOptions = {},
): Promise<Task> {
  const taskId = await create.call(client, params);
  console.log(`[tripo] ${label}: task ${taskId}`);
  const task = await client.waitForTask(taskId, {
    pollingIntervalMs: 3000,
    timeoutMs: 30 * 60_000,
    throwOnFailure: true,
    onProgress: (t) => {
      const q = t.queuing_num ? ` queue ${t.queuing_num}` : "";
      process.stdout.write(`\r[tripo] ${label}: ${t.status} ${t.progress ?? 0}%${q}   `);
    },
    ...wait,
  });
  const credits = task.credits_consumed !== undefined ? ` (${task.credits_consumed} credits)` : "";
  process.stdout.write(`\r[tripo] ${label}: ${task.status}${credits}            \n`);
  return task;
}

/** The single model URL of a finished task, across v2/v3 field names. */
export function modelUrl(task: Task): string {
  const o = task.output ?? {};
  const url = o.model_url ?? o.pbr_model ?? o.model ?? o.base_model ?? o.model_urls?.[0];
  if (!url)
    throw new Error(
      `tripo task ${task.task_id} (${task.type}) has no model url: ${JSON.stringify(o)}`,
    );
  return url;
}

export async function download(url: string, dest: string): Promise<void> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`tripo download: HTTP ${res.status} ${url}`);
  // Streaming the Response straight into Bun.write spun at 100% CPU forever on
  // a 42MB glb (bun 1.3.14, Windows) while curl fetched the same URL in
  // seconds. Buffer it: these are tens of megabytes, not gigabytes.
  await Bun.write(dest, await res.arrayBuffer());
}
