import { copyFile, mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const workerSource = resolve(
  projectRoot,
  "node_modules/maplibre-gl/dist/maplibre-gl-worker.mjs",
);
const workerDestination = resolve(
  projectRoot,
  "public/assets/maplibre-gl-worker.mjs",
);

await mkdir(dirname(workerDestination), { recursive: true });
await copyFile(workerSource, workerDestination);
