import * as vscode from "vscode";
import type { Token } from "../lexer/tokens";
import type { AstNode, AstNodeType } from "../parser/ast";
import type { ParsedProgram } from "../parser/symbols";
import type { FeatureScriptParseCache } from "./parseCache";

const documentSymbolNodeTypes = new Set<AstNodeType>([
  "FeatureDeclaration",
  "FunctionDeclaration",
  "PredicateDeclaration",
  "OperatorDeclaration",
  "EnumDeclaration",
  "TypeDeclaration",
  "TopLevelConst"
]);

const foldingNodeTypes = new Set<AstNodeType>([
  "FeatureDeclaration",
  "FunctionDeclaration",
  "PredicateDeclaration",
  "OperatorDeclaration",
  "EnumDeclaration",
  "TopLevelConst",
  "PreconditionBlock",
  "Block",
  "MapLiteral",
  "AnnotationMap"
]);

export class FeatureScriptDocumentSymbolProvider implements vscode.DocumentSymbolProvider {
  constructor(private readonly cache: FeatureScriptParseCache) {}

  provideDocumentSymbols(document: vscode.TextDocument, cancellationToken: vscode.CancellationToken): vscode.ProviderResult<vscode.DocumentSymbol[]> {
    if (cancellationToken.isCancellationRequested) {
      return [];
    }
    return buildDocumentSymbols(this.cache.get(document));
  }
}

export class FeatureScriptFoldingRangeProvider implements vscode.FoldingRangeProvider {
  constructor(private readonly cache: FeatureScriptParseCache) {}

  provideFoldingRanges(document: vscode.TextDocument, _context: vscode.FoldingContext, cancellationToken: vscode.CancellationToken): vscode.ProviderResult<vscode.FoldingRange[]> {
    if (cancellationToken.isCancellationRequested) {
      return [];
    }
    return buildFoldingRanges(this.cache.get(document));
  }
}

export function buildDocumentSymbols(parsed: ParsedProgram): vscode.DocumentSymbol[] {
  const symbols: vscode.DocumentSymbol[] = [];
  for (const node of parsed.nodes) {
    if (!documentSymbolNodeTypes.has(node.type) || !node.name) {
      continue;
    }
    const symbol = createDocumentSymbol(parsed, node);
    if (!symbol) {
      continue;
    }
    if (node.type === "EnumDeclaration") {
      symbol.children.push(...enumMemberSymbols(parsed, node));
    }
    symbols.push(symbol);
  }
  return dedupeSymbols(symbols);
}

export function buildFoldingRanges(parsed: ParsedProgram): vscode.FoldingRange[] {
  const ranges: vscode.FoldingRange[] = [];
  const seen = new Set<string>();
  for (const node of parsed.nodes) {
    if (!foldingNodeTypes.has(node.type)) {
      continue;
    }
    const start = node.token;
    const end = endTokenForNode(parsed, node);
    if (!start || !end || end.line <= start.line) {
      continue;
    }
    const key = `${start.line}:${end.line}:${node.type}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    ranges.push(new vscode.FoldingRange(start.line, end.line, foldingKind(node.type)));
  }
  return ranges.sort((a, b) => (a.start - b.start) || (b.end - a.end));
}

function createDocumentSymbol(parsed: ParsedProgram, node: AstNode): vscode.DocumentSymbol | undefined {
  const start = node.token;
  const end = endTokenForNode(parsed, node);
  if (!start || !end) {
    return undefined;
  }
  const selection = selectionRangeForNode(parsed, node);
  return new vscode.DocumentSymbol(
    labelForNode(node),
    detailForNode(node),
    symbolKindForNode(node.type),
    rangeFromTokens(start, end),
    selection ? rangeFromTokens(selection, selection) : rangeFromTokens(start, start)
  );
}

function enumMemberSymbols(parsed: ParsedProgram, enumNode: AstNode): vscode.DocumentSymbol[] {
  const members: vscode.DocumentSymbol[] = [];
  for (const memberNode of parsed.nodes) {
    if (memberNode.type !== "EnumMember" || !memberNode.name || memberNode.start < enumNode.start || memberNode.end > enumNode.end) {
      continue;
    }
    const token = memberNode.token;
    if (!token) {
      continue;
    }
    members.push(new vscode.DocumentSymbol(
      memberNode.name,
      "enum member",
      vscode.SymbolKind.EnumMember,
      rangeFromTokens(token, token),
      rangeFromTokens(token, token)
    ));
  }
  return members;
}

function labelForNode(node: AstNode): string {
  if (node.type === "OperatorDeclaration") {
    return `operator${node.name ?? ""}`;
  }
  return node.name ?? node.type;
}

function detailForNode(node: AstNode): string {
  switch (node.type) {
    case "FeatureDeclaration":
      return "FeatureScript feature";
    case "PredicateDeclaration":
      return "predicate";
    case "OperatorDeclaration":
      return "operator overload";
    case "EnumDeclaration":
      return "enum";
    case "TypeDeclaration":
      return "type";
    case "TopLevelConst":
      return "const";
    default:
      return "";
  }
}

function symbolKindForNode(type: AstNodeType): vscode.SymbolKind {
  switch (type) {
    case "FeatureDeclaration":
      return vscode.SymbolKind.Function;
    case "FunctionDeclaration":
      return vscode.SymbolKind.Function;
    case "PredicateDeclaration":
      return vscode.SymbolKind.Function;
    case "OperatorDeclaration":
      return vscode.SymbolKind.Operator;
    case "EnumDeclaration":
      return vscode.SymbolKind.Enum;
    case "TypeDeclaration":
      return vscode.SymbolKind.Struct;
    case "TopLevelConst":
      return vscode.SymbolKind.Constant;
    default:
      return vscode.SymbolKind.Object;
  }
}

function foldingKind(type: AstNodeType): vscode.FoldingRangeKind | undefined {
  switch (type) {
    case "FeatureDeclaration":
    case "FunctionDeclaration":
    case "PredicateDeclaration":
    case "OperatorDeclaration":
    case "EnumDeclaration":
    case "TopLevelConst":
      return vscode.FoldingRangeKind.Region;
    default:
      return undefined;
  }
}

function selectionRangeForNode(parsed: ParsedProgram, node: AstNode): Token | undefined {
  if (!node.name) {
    return node.token;
  }
  if (node.type === "OperatorDeclaration") {
    return parsed.tokens.find((token) => token.offset >= node.start && token.end <= node.end && token.value === node.name);
  }
  const symbol = [...parsed.symbols.values()].find((candidate) => candidate.name === node.name && candidate.token.offset >= node.start && candidate.token.end <= node.end);
  if (symbol) {
    return symbol.token;
  }
  return parsed.tokens.find((token) => token.offset >= node.start && token.end <= node.end && token.value === node.name) ?? node.token;
}

function endTokenForNode(parsed: ParsedProgram, node: AstNode): Token | undefined {
  let candidate: Token | undefined;
  for (const token of parsed.tokens) {
    if (token.kind === "eof" || token.offset > node.end) {
      break;
    }
    if (token.end <= node.end) {
      candidate = token;
    }
  }
  return candidate;
}

function rangeFromTokens(start: Token, end: Token): vscode.Range {
  return new vscode.Range(start.line, start.character, end.endLine, end.endCharacter);
}

function dedupeSymbols(symbols: vscode.DocumentSymbol[]): vscode.DocumentSymbol[] {
  const seen = new Set<string>();
  const unique: vscode.DocumentSymbol[] = [];
  for (const symbol of symbols) {
    const key = `${symbol.name}:${symbol.range.start.line}:${symbol.range.end.line}:${symbol.kind}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    unique.push(symbol);
  }
  return unique;
}
