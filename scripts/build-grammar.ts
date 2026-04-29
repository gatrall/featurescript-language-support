import { readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import YAML from "yaml";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, "..");
const sourcePath = resolve(root, "syntaxes/featurescript.tmLanguage.yaml");
const outputPath = resolve(root, "syntaxes/featurescript.tmLanguage.json");

async function main(): Promise<void> {
  const source = await readFile(sourcePath, "utf8");
  const grammar = YAML.parse(source);
  await writeFile(outputPath, JSON.stringify(grammar, null, 2) + "\n", "utf8");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

