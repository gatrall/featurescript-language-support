import { mkdir, readFile, readdir, stat, writeFile } from "node:fs/promises";
import { dirname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

type StdlibKind =
  | "function"
  | "predicate"
  | "type"
  | "enum"
  | "enumMember"
  | "constant"
  | "unit"
  | "unknown";

type StdlibSymbol = {
  name: string;
  kind: StdlibKind;
  module?: string;
  signature?: string;
  parent?: string;
};

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, "..");
const defaultMirror = resolve(root, "../onshape-std-library-mirror");
const defaultFsDoc = resolve(root, "../reference/fsdoc/library.latest.html");
const outputPath = resolve(root, "src/generated/stdlibSymbols.json");
const fsDocUrl = "https://cad.onshape.com/FsDoc/library.html";

const unitNames = new Set([
  "unitless",
  "meter",
  "centimeter",
  "millimeter",
  "micrometer",
  "nanometer",
  "inch",
  "foot",
  "yard",
  "degree",
  "radian",
  "second",
  "minute",
  "hour",
  "kilogram",
  "gram",
  "newton",
  "pound",
  "pascal",
  "psi"
]);

const manualBuiltins: StdlibSymbol[] = [
  "undefined",
  "boolean",
  "number",
  "string",
  "array",
  "map",
  "box",
  "builtin",
  "function",
  "Context",
  "Id",
  "Query",
  "Vector",
  "Transform",
  "Line",
  "Plane",
  "ValueWithUnits",
  "LengthBoundSpec"
].map((name) => ({ name, kind: "type" as const }));

const manualRequiredSymbols: StdlibSymbol[] = [
  { name: "defineFeature", kind: "function", module: "feature.fs" },
  { name: "opExtrude", kind: "function", module: "extrude.fs" },
  { name: "evOwnerSketchPlane", kind: "function", module: "evaluate.fs" },
  { name: "qCreatedBy", kind: "function", module: "query.fs" },
  { name: "isLength", kind: "predicate", module: "valueBounds.fs" },
  { name: "PI", kind: "constant", module: "math.fs" },
  { name: "LENGTH_BOUNDS", kind: "constant", module: "valueBounds.fs" },
  { name: "inch", kind: "unit", module: "units.fs" },
  { name: "meter", kind: "unit", module: "units.fs" },
  { name: "EntityType", kind: "enum", module: "entitytype.gen.fs" },
  { name: "EDGE", kind: "enumMember", module: "entitytype.gen.fs", parent: "EntityType" },
  { name: "BodyType", kind: "enum", module: "bodytype.gen.fs" },
  { name: "BoundingType", kind: "enum", module: "boundingtype.gen.fs" },
  { name: "THROUGH_ALL", kind: "enumMember", module: "boundingtype.gen.fs", parent: "BoundingType" }
];

async function exists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

async function walkFsFiles(rootPath: string): Promise<string[]> {
  const entries = await readdir(rootPath, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const entryPath = resolve(rootPath, entry.name);
    if (entry.isDirectory()) {
      files.push(...await walkFsFiles(entryPath));
    } else if (entry.isFile() && entry.name.endsWith(".fs")) {
      files.push(entryPath);
    }
  }
  return files.sort();
}

function readSignature(lines: string[], startIndex: number): string {
  const parts: string[] = [];
  let depth = 0;
  for (let i = startIndex; i < Math.min(lines.length, startIndex + 12); i += 1) {
    const line = lines[i] ?? "";
    const beforeBody = line.split("{", 1)[0] ?? "";
    parts.push(beforeBody.trim());
    for (const char of beforeBody) {
      if (char === "(") depth += 1;
      if (char === ")") depth -= 1;
    }
    if (depth <= 0 && /\)/.test(beforeBody)) {
      break;
    }
  }
  return parts.join(" ").replace(/\s+/g, " ").trim();
}

function constKind(name: string, module: string): StdlibKind {
  if (unitNames.has(name)) {
    return "unit";
  }
  if (module.endsWith("units.fs") && /^[a-z][A-Za-z0-9_]*$/.test(name)) {
    return "unit";
  }
  return "constant";
}

function extractFromSource(text: string, module: string): StdlibSymbol[] {
  const symbols: StdlibSymbol[] = [];
  const lines = text.split(/\r?\n/);

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i] ?? "";
    let match = /^\s*export\s+function\s+([A-Za-z_][A-Za-z0-9_]*)\s*\(/.exec(line);
    if (match?.[1]) {
      symbols.push({ name: match[1], kind: "function", module, signature: readSignature(lines, i) });
      continue;
    }

    match = /^\s*export\s+predicate\s+([A-Za-z_][A-Za-z0-9_]*)\s*\(/.exec(line);
    if (match?.[1]) {
      symbols.push({ name: match[1], kind: "predicate", module, signature: readSignature(lines, i) });
      continue;
    }

    match = /^\s*export\s+type\s+([A-Za-z_][A-Za-z0-9_]*)\b/.exec(line);
    if (match?.[1]) {
      symbols.push({ name: match[1], kind: "type", module, signature: line.trim() });
      continue;
    }

    match = /^\s*export\s+const\s+([A-Za-z_][A-Za-z0-9_]*)\b/.exec(line);
    if (match?.[1]) {
      const name = match[1];
      const kind = name === "defineFeature" || /=\s*function\b/.test(line) ? "function" : constKind(name, module);
      symbols.push({ name, kind, module, signature: line.trim() });
      continue;
    }

    match = /^\s*export\s+enum\s+([A-Za-z_][A-Za-z0-9_]*)\b/.exec(line);
    if (match?.[1]) {
      const parent = match[1];
      symbols.push({ name: parent, kind: "enum", module, signature: line.trim() });
      let j = i + 1;
      while (j < lines.length && !/^\s*\{/.test(lines[j] ?? "")) {
        j += 1;
      }
      j += 1;
      for (; j < lines.length; j += 1) {
        const bodyLine = lines[j] ?? "";
        if (/^\s*\}/.test(bodyLine)) {
          break;
        }
        const member = /^\s*([A-Z][A-Z0-9_]*)\s*,?/.exec(bodyLine);
        if (member?.[1] && member[1] !== "annotation") {
          symbols.push({ name: member[1], kind: "enumMember", module, parent });
        }
      }
    }
  }

  return symbols;
}

async function extractFromMirror(mirrorRoot: string): Promise<StdlibSymbol[]> {
  const symbols: StdlibSymbol[] = [];
  for (const file of await walkFsFiles(mirrorRoot)) {
    const module = relative(mirrorRoot, file).replaceAll("\\", "/");
    const text = await readFile(file, "utf8");
    symbols.push(...extractFromSource(text, module));
  }
  return symbols;
}

function stripHtml(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");
}

async function readFsDoc(offline: boolean): Promise<string | undefined> {
  if (await exists(defaultFsDoc)) {
    return readFile(defaultFsDoc, "utf8");
  }
  if (offline) {
    return undefined;
  }
  const response = await fetch(fsDocUrl);
  if (!response.ok) {
    throw new Error(`Failed to fetch ${fsDocUrl}: ${response.status} ${response.statusText}`);
  }
  return response.text();
}

async function extractFallbackFromFsDoc(offline: boolean): Promise<StdlibSymbol[]> {
  const html = await readFsDoc(offline);
  if (!html) {
    return [];
  }
  const text = stripHtml(html);
  const symbols: StdlibSymbol[] = [];
  const patterns: Array<[StdlibKind, RegExp]> = [
    ["function", /\bfunction\s+([A-Za-z_][A-Za-z0-9_]*)\s*\(/g],
    ["predicate", /\bpredicate\s+([A-Za-z_][A-Za-z0-9_]*)\s*\(/g],
    ["type", /\btype\s+([A-Za-z_][A-Za-z0-9_]*)\b/g],
    ["enum", /\benum\s+([A-Za-z_][A-Za-z0-9_]*)\b/g]
  ];
  for (const [kind, pattern] of patterns) {
    for (const match of text.matchAll(pattern)) {
      if (match[1]) {
        symbols.push({ name: match[1], kind });
      }
    }
  }
  return symbols;
}

function dedupe(symbols: StdlibSymbol[]): StdlibSymbol[] {
  const map = new Map<string, StdlibSymbol>();
  for (const symbol of symbols) {
    const key = `${symbol.parent ?? ""}\0${symbol.name}\0${symbol.kind}`;
    const existing = map.get(key);
    if (!existing || (!existing.signature && symbol.signature) || (!existing.module && symbol.module)) {
      map.set(key, symbol);
    }
  }
  return [...map.values()].sort((a, b) => {
    const parentCompare = (a.parent ?? "").localeCompare(b.parent ?? "");
    if (parentCompare !== 0) return parentCompare;
    const nameCompare = a.name.localeCompare(b.name);
    if (nameCompare !== 0) return nameCompare;
    return a.kind.localeCompare(b.kind);
  });
}

async function main(): Promise<void> {
  const offline = process.argv.includes("--offline");
  const symbols: StdlibSymbol[] = [...manualBuiltins, ...manualRequiredSymbols];

  if (await exists(defaultMirror)) {
    symbols.push(...await extractFromMirror(defaultMirror));
  } else {
    symbols.push(...await extractFallbackFromFsDoc(offline));
  }

  await mkdir(dirname(outputPath), { recursive: true });
  await writeFile(outputPath, JSON.stringify(dedupe(symbols), null, 2) + "\n", "utf8");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
