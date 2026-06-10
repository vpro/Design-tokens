import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { loadEnvFile } from "node:process";
import { fileURLToPath } from "node:url";

import { createTokenFiles, writeTokenFiles } from "./figma-tokens.ts";

const FILE_KEY = "Td0HFPqpgpMrGTHBeu4acX";
const API_URL = `https://api.figma.com/v1/files/${FILE_KEY}/variables/local`;
const rootDirectory = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const envFile = resolve(rootDirectory, ".env.local");
const hasEnvironmentToken = Boolean(
  process.env.FIGMA_VARIABLES_ACCESS_TOKEN,
);
const hasEnvFile = existsSync(envFile);

if (hasEnvFile) {
  loadEnvFile(envFile);
}

const accessToken = process.env.FIGMA_VARIABLES_ACCESS_TOKEN;

if (!accessToken) {
  throw new Error("FIGMA_VARIABLES_ACCESS_TOKEN is required");
}

const response = await fetch(API_URL, {
  headers: {
    "X-Figma-Token": accessToken,
  },
  signal: AbortSignal.timeout(30_000),
});

if (!response.ok) {
  throw new Error(`Figma request failed with HTTP ${response.status}`);
}

const credentialSource =
  process.env.GITHUB_ACTIONS === "true"
    ? "GitHub Actions secret FIGMA_VARIABLES_ACCESS_TOKEN"
    : hasEnvironmentToken
      ? "the FIGMA_VARIABLES_ACCESS_TOKEN environment variable"
      : ".env.local";
console.log(`Figma authentication succeeded using ${credentialSource}.`);

const files = createTokenFiles(await response.json());
const changed = writeTokenFiles(rootDirectory, files);
console.log(
  changed
    ? `Updated ${files.size} Figma token files.`
    : `${files.size} Figma token files are already up to date.`,
);
