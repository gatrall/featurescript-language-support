import * as vscode from "vscode";
import stdlibSymbolsJson from "../generated/stdlibSymbols.json";
import type { Token } from "../lexer/tokens";
import type { ParsedProgram, StdlibSymbol } from "../parser/symbols";
import type { FeatureScriptParseCache } from "./parseCache";
import { extractLeadingDocComment } from "./docComments";
import { buildSymbolIndex, definitionAtOffset, tokenAtOffset, type FeatureScriptSymbolIndex, type IndexedDeclaration } from "./symbolIndex";

const stdlibSymbols = stdlibSymbolsJson as StdlibSymbol[];
const stdlibByName = new Map<string, StdlibSymbol[]>();
const stdlibEnums = new Set<string>();

for (const symbol of stdlibSymbols) {
  const existing = stdlibByName.get(symbol.name) ?? [];
  existing.push(symbol);
  stdlibByName.set(symbol.name, existing);
  if (symbol.kind === "enum") {
    stdlibEnums.add(symbol.name);
  }
}

export class FeatureScriptHoverProvider implements vscode.HoverProvider {
  constructor(private readonly cache: FeatureScriptParseCache) {}

  provideHover(document: vscode.TextDocument, position: vscode.Position, cancellationToken: vscode.CancellationToken): vscode.ProviderResult<vscode.Hover> {
    if (cancellationToken.isCancellationRequested) {
      return undefined;
    }
    const parsed = this.cache.get(document);
    const index = buildSymbolIndex(parsed);
    const offset = document.offsetAt(position);
    const token = tokenAtOffset(index, offset);
    if (!token || index.ignoredOffsets.has(token.offset)) {
      return undefined;
    }

    const local = definitionAtOffset(index, offset);
    if (local) {
      return new vscode.Hover(localMarkdown(document.getText(), local), rangeFromToken(token));
    }

    const stdlib = stdlibSymbolForToken(parsed, index, token);
    if (stdlib) {
      return new vscode.Hover(stdlibMarkdown(stdlib), rangeFromToken(token));
    }

    return undefined;
  }
}

function localMarkdown(source: string, declaration: IndexedDeclaration): vscode.MarkdownString {
  const markdown = new vscode.MarkdownString(undefined, true);
  markdown.isTrusted = false;
  markdown.appendMarkdown(`**FeatureScript ${kindLabel(declaration.kind)}**\n\n`);
  markdown.appendCodeblock(localSignature(source, declaration), "featurescript");
  const doc = extractLeadingDocComment(source, declaration.token.line);
  if (doc) {
    markdown.appendMarkdown("\n\n");
    markdown.appendText(doc);
  }
  return markdown;
}

function stdlibMarkdown(symbol: StdlibSymbol): vscode.MarkdownString {
  const markdown = new vscode.MarkdownString(undefined, true);
  markdown.isTrusted = false;
  markdown.appendMarkdown(`**FeatureScript stdlib ${symbol.kind}**\n\n`);
  markdown.appendCodeblock(symbol.signature ?? stdlibFallbackSignature(symbol), "featurescript");
  const details: string[] = [];
  if (symbol.parent) {
    details.push(`Parent: ${symbol.parent}`);
  }
  if (symbol.module) {
    details.push(`Module: ${symbol.module}`);
  }
  if (details.length > 0) {
    markdown.appendMarkdown("\n\n");
    markdown.appendText(details.join("\n"));
  }
  return markdown;
}

function localSignature(source: string, declaration: IndexedDeclaration): string {
  if (declaration.kind === "definitionProperty") {
    return `definition.${declaration.name}`;
  }
  if (declaration.kind === "enumMember" && declaration.parent) {
    return `${declaration.parent}.${declaration.name}`;
  }
  const line = source.split(/\r?\n/)[declaration.token.line]?.trim();
  return line && line.length > 0 ? line : declaration.name;
}

function stdlibFallbackSignature(symbol: StdlibSymbol): string {
  if (symbol.parent) {
    return `${symbol.parent}.${symbol.name}`;
  }
  return symbol.name;
}

function stdlibSymbolForToken(parsed: ParsedProgram, index: FeatureScriptSymbolIndex, token: Token): StdlibSymbol | undefined {
  const tokenIndex = index.tokenIndexByOffset.get(token.offset);
  if (tokenIndex === undefined) {
    return undefined;
  }
  const previous = previousSignificant(index.tokens, tokenIndex);
  const parent = previous ? previousSignificant(index.tokens, index.tokens.indexOf(previous)) : undefined;
  const next = nextSignificant(index.tokens, tokenIndex);

  if ((previous?.value === "." || previous?.value === "?.") && parent && stdlibEnums.has(parent.value)) {
    return chooseStdlibSymbol(stdlibByName.get(token.value)?.filter((symbol) => symbol.parent === parent.value), next);
  }

  if (!parsed.importsStdlib && !builtInType(token.value)) {
    return undefined;
  }
  return chooseStdlibSymbol(stdlibByName.get(token.value), next) ?? builtInType(token.value);
}

function chooseStdlibSymbol(candidates: StdlibSymbol[] | undefined, next: Token | undefined): StdlibSymbol | undefined {
  if (!candidates || candidates.length === 0) {
    return undefined;
  }
  if (next?.value === "(") {
    return candidates.find((symbol) => symbol.kind === "function" || symbol.kind === "predicate") ?? candidates[0];
  }
  return candidates.find((symbol) => symbol.kind !== "function" && symbol.kind !== "predicate") ?? candidates[0];
}

function builtInType(name: string): StdlibSymbol | undefined {
  if (["undefined", "boolean", "number", "string", "array", "map", "box", "builtin", "function"].includes(name)) {
    return { name, kind: "type" };
  }
  return undefined;
}

function kindLabel(kind: IndexedDeclaration["kind"]): string {
  switch (kind) {
    case "definitionProperty":
      return "feature parameter";
    case "enumMember":
      return "enum member";
    default:
      return kind;
  }
}

function rangeFromToken(token: Token): vscode.Range {
  return new vscode.Range(token.line, token.character, token.endLine, token.endCharacter);
}

function previousSignificant(tokens: readonly Token[], index: number): Token | undefined {
  for (let i = index - 1; i >= 0; i -= 1) {
    const token = tokens[i];
    if (token && token.kind !== "eof") {
      return token;
    }
  }
  return undefined;
}

function nextSignificant(tokens: readonly Token[], index: number): Token | undefined {
  for (let i = index + 1; i < tokens.length; i += 1) {
    const token = tokens[i];
    if (token && token.kind !== "eof") {
      return token;
    }
  }
  return undefined;
}
