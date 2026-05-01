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

export type StdlibSymbol = {
  name: string;
  kind: StdlibKind;
  module?: string;
  signature?: string;
  parent?: string;
};

export type StdlibEnumMember = {
  name: string;
  module?: string;
  doc?: string;
};

export type StdlibEnum = {
  name: string;
  module?: string;
  members: StdlibEnumMember[];
};

export type FeatureFieldSource = "docblock" | "precondition" | "predicate";

export type FeatureField = {
  name: string;
  type?: string;
  label?: string;
  description?: string;
  required?: boolean;
  source: FeatureFieldSource;
  predicate?: string;
  nestedPath?: string[];
  enumType?: string;
  defaultValue?: string;
  condition?: string;
};

export type FeatureMetadata = {
  name: string;
  module?: string;
  signature?: string;
  description?: string;
  fields: FeatureField[];
};

export type StdlibMetadata = {
  enums: StdlibEnum[];
  features: FeatureMetadata[];
};

export type SourceFile = {
  module: string;
  text: string;
};

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, "..");
const defaultMirror = resolve(root, "../onshape-std-library-mirror");
const defaultFsDoc = resolve(root, "../reference/fsdoc/library.latest.html");
const outputSymbolsPath = resolve(root, "src/generated/stdlibSymbols.json");
const outputMetadataPath = resolve(root, "src/generated/stdlibMetadata.json");
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

const validatorTypes = new Map<string, string>([
  ["isLength", "ValueWithUnits"],
  ["isAngle", "ValueWithUnits"],
  ["isInteger", "number"],
  ["isReal", "number"],
  ["isRealInRange", "number"],
  ["isNonNegativeInteger", "number"],
  ["isPositiveInteger", "number"]
]);

const nonEnumTypes = new Set([
  "Context",
  "Id",
  "Query",
  "Vector",
  "Transform",
  "Line",
  "Plane",
  "ValueWithUnits",
  "LengthBoundSpec",
  "PartStudioData",
  "boolean",
  "number",
  "string",
  "array",
  "map",
  "box",
  "function"
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

function constKind(name: string, module: string, line: string): StdlibKind {
  if (name === "defineFeature" || /=\s*(?:function\b|defineFeature\s*\()/.test(line)) {
    return "function";
  }
  if (unitNames.has(name)) {
    return "unit";
  }
  if (module.endsWith("units.fs") && /^[a-z][A-Za-z0-9_]*$/.test(name)) {
    return "unit";
  }
  return "constant";
}

export function extractFromSource(text: string, module: string): StdlibSymbol[] {
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
      symbols.push({ name, kind: constKind(name, module, line), module, signature: line.trim() });
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

async function readMirrorSources(mirrorRoot: string): Promise<SourceFile[]> {
  const sources: SourceFile[] = [];
  for (const file of await walkFsFiles(mirrorRoot)) {
    const module = relative(mirrorRoot, file).replaceAll("\\", "/");
    sources.push({ module, text: await readFile(file, "utf8") });
  }
  return sources;
}

async function extractFromMirror(mirrorRoot: string): Promise<StdlibSymbol[]> {
  const symbols: StdlibSymbol[] = [];
  for (const source of await readMirrorSources(mirrorRoot)) {
    symbols.push(...extractFromSource(source.text, source.module));
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

export function extractMetadataFromSourceFiles(files: readonly SourceFile[], symbols: readonly StdlibSymbol[]): StdlibMetadata {
  const enumMap = new Map<string, StdlibEnum>();
  for (const symbol of symbols) {
    if (symbol.kind === "enum") {
      enumMap.set(symbol.name, { name: symbol.name, ...(symbol.module ? { module: symbol.module } : {}), members: [] });
    }
  }
  for (const symbol of symbols) {
    if (symbol.kind !== "enumMember" || !symbol.parent) {
      continue;
    }
    const parent = enumMap.get(symbol.parent) ?? { name: symbol.parent, ...(symbol.module ? { module: symbol.module } : {}), members: [] };
    if (!parent.members.some((member) => member.name === symbol.name)) {
      parent.members.push({ name: symbol.name, ...(symbol.module ? { module: symbol.module } : {}) });
    }
    enumMap.set(symbol.parent, parent);
  }

  const predicateFields = new Map<string, FeatureField[]>();
  for (const file of files) {
    for (const predicate of extractPredicateBlocks(file.text)) {
      const fields = extractFieldsFromBlock(predicate.body, [predicate.parameter], {
        source: "precondition",
        module: file.module
      });
      predicateFields.set(predicate.name, dedupeFields(fields));
    }
  }

  const features: FeatureMetadata[] = [];
  for (const file of files) {
    for (const feature of extractFeatureBlocks(file.text, file.module)) {
      const docFields = feature.doc ? extractFieldsFromDocComment(feature.doc) : [];
      const preconditionFields = extractFieldsFromBlock(feature.precondition ?? "", ["definition"], {
        source: "precondition",
        module: file.module
      });
      const inlinedPredicateFields = inlinePredicateFields(feature.precondition ?? "", predicateFields);
      const fields = dedupeFields([...docFields, ...preconditionFields, ...inlinedPredicateFields]);
      features.push({
        name: feature.name,
        module: file.module,
        signature: feature.signature,
        ...(feature.description ? { description: feature.description } : {}),
        fields
      });
    }
  }

  return {
    enums: [...enumMap.values()].sort((a, b) => a.name.localeCompare(b.name)).map((entry) => ({
      ...entry,
      members: [...entry.members].sort((a, b) => a.name.localeCompare(b.name))
    })),
    features: features.sort((a, b) => a.name.localeCompare(b.name))
  };
}

export function extractFieldsFromDocComment(comment: string): FeatureField[] {
  const lines = cleanBlockComment(comment).split(/\r?\n/);
  const fields: FeatureField[] = [];
  let current: FeatureField | undefined;
  for (const rawLine of lines) {
    const line = rawLine.trim();
    const match = /^@field\s+([A-Za-z_][A-Za-z0-9_]*)\s+\{([^}]+)\}\s*:?\s*(.*)$/.exec(line);
    if (match?.[1]) {
      if (current) {
        fields.push(cleanField(current));
      }
      const rest = match[3] ?? "";
      current = {
        name: match[1],
        type: match[2]?.trim(),
        source: "docblock",
        required: !/@optional\b/.test(rest)
      };
      if (current.type && /^[A-Z][A-Za-z0-9_]*$/.test(current.type) && !nonEnumTypes.has(current.type)) {
        current.enumType = current.type;
      }
      const condition = /@requiredif\s+\{([^}]+)\}/.exec(rest)?.[1];
      if (condition) {
        current.condition = condition.replaceAll("`", "").trim();
      }
      const description = cleanDocFieldDescription(rest);
      if (description) {
        current.description = description;
      }
      continue;
    }
    if (!current || line.startsWith("@field") || line.startsWith("@param")) {
      continue;
    }
    const description = cleanDocFieldDescription(line);
    if (description) {
      current.description = [current.description, description].filter(Boolean).join(" ");
    }
  }
  if (current) {
    fields.push(cleanField(current));
  }
  return dedupeFields(fields);
}

function extractPredicateBlocks(text: string): Array<{ name: string; parameter: string; body: string }> {
  const predicates: Array<{ name: string; parameter: string; body: string }> = [];
  const pattern = /export\s+predicate\s+([A-Za-z_][A-Za-z0-9_]*)\s*\(\s*([A-Za-z_][A-Za-z0-9_]*)\b/g;
  for (const match of text.matchAll(pattern)) {
    if (!match.index || !match[1] || !match[2]) {
      continue;
    }
    const bodyOpen = text.indexOf("{", match.index);
    const bodyClose = bodyOpen >= 0 ? findMatchingBrace(text, bodyOpen) : -1;
    if (bodyOpen >= 0 && bodyClose > bodyOpen) {
      predicates.push({ name: match[1], parameter: match[2], body: text.slice(bodyOpen + 1, bodyClose) });
    }
  }
  return predicates;
}

function extractFeatureBlocks(text: string, module: string): Array<{ name: string; module: string; signature: string; doc?: string; description?: string; precondition?: string }> {
  const features: Array<{ name: string; module: string; signature: string; doc?: string; description?: string; precondition?: string }> = [];
  const lines = text.split(/\r?\n/);
  const lineOffsets = lineStartOffsets(text);
  const pattern = /export\s+const\s+([A-Za-z_][A-Za-z0-9_]*)\s*=\s*defineFeature\s*\(\s*function\s*\(/g;
  for (const match of text.matchAll(pattern)) {
    if (match.index === undefined || !match[1]) {
      continue;
    }
    const startLine = lineIndexForOffset(lineOffsets, match.index);
    const doc = leadingDocBlock(text, match.index);
    const precondition = extractPreconditionBlock(text, match.index);
    features.push({
      name: match[1],
      module,
      signature: readSignature(lines, startLine),
      ...(doc ? { doc } : {}),
      ...(doc ? { description: docSummary(doc) } : {}),
      ...(precondition ? { precondition } : {})
    });
  }
  return features;
}

function extractPreconditionBlock(text: string, startOffset: number): string | undefined {
  const preconditionIndex = text.indexOf("precondition", startOffset);
  if (preconditionIndex < 0) {
    return undefined;
  }
  const bodyOpen = text.indexOf("{", preconditionIndex);
  const bodyClose = bodyOpen >= 0 ? findMatchingBrace(text, bodyOpen) : -1;
  if (bodyOpen < 0 || bodyClose <= bodyOpen) {
    return undefined;
  }
  return text.slice(bodyOpen + 1, bodyClose);
}

function extractFieldsFromBlock(
  block: string,
  rootNames: readonly string[],
  options: { source: FeatureFieldSource; module?: string; predicate?: string; nestedPath?: string[] }
): FeatureField[] {
  if (block.length === 0 || rootNames.length === 0) {
    return [];
  }
  const rootPattern = rootNames.map(escapeRegExp).join("|");
  const fields: FeatureField[] = [];
  const directPattern = new RegExp(`\\b(?:${rootPattern})\\.([A-Za-z_][A-Za-z0-9_]*)\\s+is\\s+([A-Za-z_][A-Za-z0-9_]*)`, "g");
  for (const match of block.matchAll(directPattern)) {
    if (match.index === undefined || !match[1]) {
      continue;
    }
    fields.push(fieldFromMatch(block, match.index, match[1], options, match[2]));
  }

  const validatorPattern = new RegExp(`\\b([A-Za-z_][A-Za-z0-9_]*)\\s*\\(\\s*(?:${rootPattern})\\.([A-Za-z_][A-Za-z0-9_]*)\\s*,`, "g");
  for (const match of block.matchAll(validatorPattern)) {
    if (match.index === undefined || !match[1] || !match[2] || !validatorTypes.has(match[1])) {
      continue;
    }
    fields.push(fieldFromMatch(block, match.index, match[2], options, validatorTypes.get(match[1])));
  }

  if (rootNames.includes("definition")) {
    fields.push(...extractNestedLoopFields(block, options));
  }

  return dedupeFields(fields);
}

function extractNestedLoopFields(block: string, options: { source: FeatureFieldSource; module?: string; predicate?: string }): FeatureField[] {
  const fields: FeatureField[] = [];
  const pattern = /for\s*\(\s*var\s+([A-Za-z_][A-Za-z0-9_]*)\s+in\s+definition\.([A-Za-z_][A-Za-z0-9_]*)\s*\)/g;
  for (const match of block.matchAll(pattern)) {
    if (match.index === undefined || !match[1] || !match[2]) {
      continue;
    }
    const bodyOpen = block.indexOf("{", match.index);
    const bodyClose = bodyOpen >= 0 ? findMatchingBrace(block, bodyOpen) : -1;
    if (bodyOpen < 0 || bodyClose <= bodyOpen) {
      continue;
    }
    fields.push(...extractFieldsFromBlock(block.slice(bodyOpen + 1, bodyClose), [match[1]], {
      ...options,
      nestedPath: [match[2]]
    }));
  }
  return fields;
}

function inlinePredicateFields(block: string, predicateFields: ReadonlyMap<string, FeatureField[]>): FeatureField[] {
  const fields: FeatureField[] = [];
  const seenPredicates = new Set<string>();
  const pattern = /\b([A-Za-z_][A-Za-z0-9_]*)\s*\(\s*definition\s*\)/g;
  for (const match of block.matchAll(pattern)) {
    const predicate = match[1];
    if (!predicate || seenPredicates.has(predicate)) {
      continue;
    }
    seenPredicates.add(predicate);
    for (const field of predicateFields.get(predicate) ?? []) {
      fields.push(cleanField({ ...field, source: "predicate", predicate }));
    }
  }
  return fields;
}

function fieldFromMatch(
  block: string,
  matchIndex: number,
  name: string,
  options: { source: FeatureFieldSource; module?: string; predicate?: string; nestedPath?: string[] },
  type?: string
): FeatureField {
  const annotation = annotationBefore(block, matchIndex);
  return cleanField({
    name,
    ...(type ? { type } : {}),
    ...(annotation.label ? { label: annotation.label } : {}),
    ...(annotation.description ? { description: annotation.description } : {}),
    ...(annotation.defaultValue ? { defaultValue: annotation.defaultValue } : {}),
    source: options.source,
    ...(options.predicate ? { predicate: options.predicate } : {}),
    ...(options.nestedPath ? { nestedPath: options.nestedPath } : {}),
    ...(type && /^[A-Z][A-Za-z0-9_]*$/.test(type) && !nonEnumTypes.has(type) ? { enumType: type } : {})
  });
}

function annotationBefore(block: string, offset: number): { label?: string; description?: string; defaultValue?: string } {
  const windowStart = Math.max(0, offset - 1200);
  const prefix = block.slice(windowStart, offset);
  const annotationIndex = prefix.lastIndexOf("annotation");
  if (annotationIndex < 0) {
    return {};
  }
  const absoluteAnnotationIndex = windowStart + annotationIndex;
  const open = block.indexOf("{", absoluteAnnotationIndex);
  if (open < 0 || open > offset) {
    return {};
  }
  const close = findMatchingBrace(block, open);
  if (close < open || close > offset) {
    return {};
  }
  const between = block.slice(close + 1, offset);
  if (/\b(?:definition|isLength|isAngle|isInteger|isReal|annotation)\b/.test(between)) {
    return {};
  }
  const body = block.slice(open + 1, close);
  return {
    ...stringMapValue(body, "Name", "label"),
    ...stringMapValue(body, "Description", "description"),
    ...rawMapValue(body, "Default", "defaultValue")
  };
}

function stringMapValue(body: string, key: string, outKey: "label" | "description"): { label?: string; description?: string } {
  const match = new RegExp(`["']${escapeRegExp(key)}["']\\s*:\\s*["']([^"']+)["']`).exec(body);
  if (!match?.[1]) {
    return {};
  }
  return outKey === "label" ? { label: match[1] } : { description: match[1] };
}

function rawMapValue(body: string, key: string, outKey: "defaultValue"): { defaultValue?: string } {
  const match = new RegExp(`["']${escapeRegExp(key)}["']\\s*:\\s*([^,}\\n]+)`).exec(body);
  if (!match?.[1]) {
    return {};
  }
  return outKey === "defaultValue" ? { defaultValue: match[1].trim() } : {};
}

function cleanBlockComment(comment: string): string {
  return comment
    .replace(/^\/\*\*?/, "")
    .replace(/\*\/$/, "")
    .split(/\r?\n/)
    .map((line) => line.replace(/^\s*\*\s?/, "").trimEnd())
    .join("\n")
    .trim();
}

function docSummary(comment: string): string | undefined {
  const lines = cleanBlockComment(comment)
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
  const firstParagraph: string[] = [];
  for (const line of lines) {
    if (line.startsWith("@")) {
      break;
    }
    firstParagraph.push(line);
  }
  return firstParagraph.join(" ").replace(/\s+/g, " ").trim() || undefined;
}

function cleanDocFieldDescription(text: string): string {
  return text
    .replace(/@optional\b/g, "")
    .replace(/@requiredif\s+\{[^}]+\}/g, "")
    .replace(/@ex\b/g, "")
    .replace(/`/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^:\s*/, "");
}

function cleanField(field: FeatureField): FeatureField {
  const cleaned: FeatureField = {
    name: field.name,
    source: field.source
  };
  if (field.type) cleaned.type = field.type;
  if (field.label) cleaned.label = field.label;
  if (field.description) cleaned.description = field.description.replace(/\s+/g, " ").trim();
  if (field.required !== undefined) cleaned.required = field.required;
  if (field.predicate) cleaned.predicate = field.predicate;
  if (field.nestedPath && field.nestedPath.length > 0) cleaned.nestedPath = field.nestedPath;
  if (field.enumType) cleaned.enumType = field.enumType;
  if (field.defaultValue) cleaned.defaultValue = field.defaultValue;
  if (field.condition) cleaned.condition = field.condition;
  return cleaned;
}

function dedupeFields(fields: readonly FeatureField[]): FeatureField[] {
  const map = new Map<string, FeatureField>();
  for (const field of fields) {
    const key = `${field.nestedPath?.join(".") ?? ""}\0${field.name}`;
    const existing = map.get(key);
    if (!existing) {
      map.set(key, cleanField(field));
      continue;
    }
    map.set(key, cleanField({
      ...existing,
      ...field,
      description: existing.description ?? field.description,
      label: existing.label ?? field.label,
      type: existing.type ?? field.type,
      required: existing.required ?? field.required
    }));
  }
  return [...map.values()].sort((a, b) => {
    const pathCompare = (a.nestedPath?.join(".") ?? "").localeCompare(b.nestedPath?.join(".") ?? "");
    return pathCompare || a.name.localeCompare(b.name);
  });
}

function leadingDocBlock(text: string, offset: number): string | undefined {
  const prefix = text.slice(0, offset);
  const start = prefix.lastIndexOf("/**");
  if (start < 0) {
    return undefined;
  }
  const end = text.indexOf("*/", start);
  if (end < 0 || end + 2 > offset) {
    return undefined;
  }
  const between = text.slice(end + 2, offset);
  if (/\bexport\s+(?:const|function|predicate|enum|type)\b/.test(between)) {
    return undefined;
  }
  return text.slice(start, end + 2);
}

function findMatchingBrace(text: string, openOffset: number): number {
  let depth = 0;
  let quote: string | undefined;
  for (let i = openOffset; i < text.length; i += 1) {
    const char = text[i];
    if (quote) {
      if (char === "\\") {
        i += 1;
      } else if (char === quote) {
        quote = undefined;
      }
      continue;
    }
    if (char === "\"" || char === "'") {
      quote = char;
      continue;
    }
    if (char === "/" && text[i + 1] === "/") {
      const next = text.indexOf("\n", i + 2);
      i = next < 0 ? text.length : next;
      continue;
    }
    if (char === "/" && text[i + 1] === "*") {
      const next = text.indexOf("*/", i + 2);
      i = next < 0 ? text.length : next + 1;
      continue;
    }
    if (char === "{") {
      depth += 1;
    } else if (char === "}") {
      depth -= 1;
      if (depth === 0) {
        return i;
      }
    }
  }
  return -1;
}

function lineStartOffsets(text: string): number[] {
  const offsets = [0];
  for (let i = 0; i < text.length; i += 1) {
    if (text[i] === "\n") {
      offsets.push(i + 1);
    }
  }
  return offsets;
}

function lineIndexForOffset(offsets: readonly number[], offset: number): number {
  let low = 0;
  let high = offsets.length - 1;
  while (low <= high) {
    const mid = Math.floor((low + high) / 2);
    const value = offsets[mid] ?? 0;
    if (value <= offset && (offsets[mid + 1] ?? Number.POSITIVE_INFINITY) > offset) {
      return mid;
    }
    if (value <= offset) {
      low = mid + 1;
    } else {
      high = mid - 1;
    }
  }
  return 0;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
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
  let sources: SourceFile[] = [];

  if (await exists(defaultMirror)) {
    sources = await readMirrorSources(defaultMirror);
    for (const source of sources) {
      symbols.push(...extractFromSource(source.text, source.module));
    }
  } else {
    symbols.push(...await extractFallbackFromFsDoc(offline));
  }

  const dedupedSymbols = dedupe(symbols);
  const metadata = extractMetadataFromSourceFiles(sources, dedupedSymbols);

  await mkdir(dirname(outputSymbolsPath), { recursive: true });
  await writeFile(outputSymbolsPath, JSON.stringify(dedupedSymbols, null, 2) + "\n", "utf8");
  await writeFile(outputMetadataPath, JSON.stringify(metadata, null, 2) + "\n", "utf8");
}

function isMain(): boolean {
  return process.argv[1] ? resolve(process.argv[1]) === fileURLToPath(import.meta.url) : false;
}

if (isMain()) {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
