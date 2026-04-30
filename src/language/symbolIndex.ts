import { isIdentifierToken, type Token } from "../lexer/tokens";
import type { AstNode, AstNodeType } from "../parser/ast";
import type { ParsedProgram, SemanticHint, SemanticTokenType } from "../parser/symbols";

export type IndexedSymbolKind =
  | "feature"
  | "function"
  | "predicate"
  | "operator"
  | "enum"
  | "enumMember"
  | "type"
  | "variable"
  | "parameter"
  | "definitionProperty";

export type IndexedDeclaration = {
  key: string;
  name: string;
  kind: IndexedSymbolKind;
  token: Token;
  scopeStart: number;
  scopeEnd: number;
  visibleFrom: number;
  parent?: string;
};

export type IndexedReference = {
  key: string;
  name: string;
  kind: IndexedSymbolKind;
  token: Token;
  declaration: IndexedDeclaration;
};

export type FeatureScriptSymbolIndex = {
  declarations: IndexedDeclaration[];
  references: IndexedReference[];
  tokens: Token[];
  ignoredOffsets: Set<number>;
  declarationByOffset: Map<number, IndexedDeclaration>;
  tokenIndexByOffset: Map<number, number>;
};

const fileScopedNodeTypes = new Set<AstNodeType>([
  "FeatureDeclaration",
  "FunctionDeclaration",
  "PredicateDeclaration",
  "OperatorDeclaration",
  "EnumDeclaration",
  "TypeDeclaration",
  "TopLevelConst"
]);

const localScopeNodeTypes = new Set<AstNodeType>([
  "FeatureDeclaration",
  "FunctionDeclaration",
  "PredicateDeclaration",
  "OperatorDeclaration",
  "FunctionExpression",
  "PreconditionBlock",
  "Block"
]);

export function buildSymbolIndex(parsed: ParsedProgram): FeatureScriptSymbolIndex {
  const tokens = parsed.tokens.filter((token) => token.kind !== "eof");
  const ignoredOffsets = new Set<number>();
  const tokenIndexByOffset = new Map<number, number>();
  for (let index = 0; index < tokens.length; index += 1) {
    tokenIndexByOffset.set(tokens[index]!.offset, index);
  }
  for (const hint of parsed.hints) {
    if (hint.type === "mapKey" || hint.type === "annotationKey") {
      ignoredOffsets.add(hint.token.offset);
    }
  }

  const declarations = declarationHints(parsed, ignoredOffsets);
  declarations.push(...definitionPropertyDeclarations(parsed, tokens, tokenIndexByOffset, ignoredOffsets));
  declarations.sort((a, b) => a.token.offset - b.token.offset);

  const declarationByOffset = new Map<number, IndexedDeclaration>();
  for (const declaration of declarations) {
    if (!declarationByOffset.has(declaration.token.offset)) {
      declarationByOffset.set(declaration.token.offset, declaration);
    }
  }

  const index: FeatureScriptSymbolIndex = {
    declarations,
    references: [],
    tokens,
    ignoredOffsets,
    declarationByOffset,
    tokenIndexByOffset
  };

  index.references = tokens.flatMap((token) => {
    const declaration = declarationForToken(index, token);
    return declaration ? [{ key: declaration.key, name: declaration.name, kind: declaration.kind, token, declaration }] : [];
  });

  return index;
}

export function definitionAtOffset(index: FeatureScriptSymbolIndex, offset: number): IndexedDeclaration | undefined {
  const token = tokenAtOffset(index, offset);
  return token ? declarationForToken(index, token) : undefined;
}

export function referencesAtOffset(index: FeatureScriptSymbolIndex, offset: number, includeDeclaration: boolean): IndexedReference[] {
  const declaration = definitionAtOffset(index, offset);
  if (!declaration) {
    return [];
  }
  const references = index.references.filter((reference) => reference.key === declaration.key);
  return includeDeclaration ? references : references.filter((reference) => reference.token.offset !== declaration.token.offset);
}

export function tokenAtOffset(index: FeatureScriptSymbolIndex, offset: number): Token | undefined {
  return index.tokens.find((token) => offset >= token.offset && offset < token.end)
    ?? index.tokens.find((token) => offset === token.end && offset > token.offset);
}

function declarationHints(parsed: ParsedProgram, ignoredOffsets: Set<number>): IndexedDeclaration[] {
  const declarations: IndexedDeclaration[] = [];
  const seen = new Set<number>();
  for (const hint of parsed.hints) {
    if (!hint.modifiers.includes("declaration") || ignoredOffsets.has(hint.token.offset) || seen.has(hint.token.offset)) {
      continue;
    }
    const kind = declarationKind(parsed, hint);
    if (!kind) {
      continue;
    }
    const parent = kind === "enumMember" ? enclosingEnum(parsed, hint.token)?.name : undefined;
    const scope = declarationScope(parsed, hint.token, kind);
    declarations.push({
      key: declarationKey(kind, hint.token.value, scope.scopeStart, parent),
      name: hint.token.value,
      kind,
      token: hint.token,
      scopeStart: scope.scopeStart,
      scopeEnd: scope.scopeEnd,
      visibleFrom: scope.visibleFrom,
      ...(parent ? { parent } : {})
    });
    seen.add(hint.token.offset);
  }
  return declarations;
}

function declarationKind(parsed: ParsedProgram, hint: SemanticHint): IndexedSymbolKind | undefined {
  if (hint.type === "function" && previousToken(parsed.tokens, hint.token)?.value === "operator") {
    return "operator";
  }
  switch (hint.type as SemanticTokenType) {
    case "feature":
      return "feature";
    case "function":
      return "function";
    case "predicate":
      return "predicate";
    case "enum":
      return "enum";
    case "enumMember":
      return "enumMember";
    case "type":
      return "type";
    case "variable":
      return "variable";
    case "parameter":
      return "parameter";
    default:
      return undefined;
  }
}

function definitionPropertyDeclarations(
  parsed: ParsedProgram,
  tokens: Token[],
  tokenIndexByOffset: Map<number, number>,
  ignoredOffsets: Set<number>
): IndexedDeclaration[] {
  const declarations: IndexedDeclaration[] = [];
  const seen = new Set<string>();
  for (const token of tokens) {
    const index = tokenIndexByOffset.get(token.offset);
    if (index === undefined || ignoredOffsets.has(token.offset) || !isIdentifierToken(token)) {
      continue;
    }
    const previous = previousSignificant(tokens, index);
    const parent = previous ? previousSignificant(tokens, tokens.indexOf(previous)) : undefined;
    const next = nextSignificant(tokens, index);
    if ((previous?.value !== "." && previous?.value !== "?.") || parent?.value !== "definition" || next?.value !== "is") {
      continue;
    }
    const scopeNode = enclosingNode(parsed, token, new Set<AstNodeType>(["FeatureDeclaration"]))
      ?? enclosingNode(parsed, token, new Set<AstNodeType>(["FunctionExpression", "FunctionDeclaration", "PredicateDeclaration", "OperatorDeclaration"]));
    const scopeStart = scopeNode?.start ?? parsed.ast.start;
    const scopeEnd = scopeNode?.end ?? parsed.ast.end;
    const seenKey = `${scopeStart}:${token.value}`;
    if (seen.has(seenKey)) {
      continue;
    }
    declarations.push({
      key: declarationKey("definitionProperty", token.value, scopeStart),
      name: token.value,
      kind: "definitionProperty",
      token,
      scopeStart,
      scopeEnd,
      visibleFrom: scopeStart,
      parent: "definition"
    });
    seen.add(seenKey);
  }
  return declarations;
}

function declarationForToken(index: FeatureScriptSymbolIndex, token: Token): IndexedDeclaration | undefined {
  const direct = index.declarationByOffset.get(token.offset);
  if (direct) {
    return direct;
  }
  if (index.ignoredOffsets.has(token.offset) || !isIdentifierToken(token)) {
    return undefined;
  }
  const tokenIndex = index.tokenIndexByOffset.get(token.offset);
  if (tokenIndex === undefined) {
    return undefined;
  }
  const previous = previousSignificant(index.tokens, tokenIndex);
  const beforePrevious = previous ? previousSignificant(index.tokens, index.tokens.indexOf(previous)) : undefined;
  if (previous?.value === "." || previous?.value === "?.") {
    if (beforePrevious?.value === "definition") {
      return chooseDefinitionProperty(index, token);
    }
    if (beforePrevious) {
      return chooseEnumMember(index, beforePrevious.value, token);
    }
    return undefined;
  }
  if (nextSignificant(index.tokens, tokenIndex)?.value === "::") {
    return undefined;
  }
  return chooseNamedDeclaration(index, token);
}

function chooseNamedDeclaration(index: FeatureScriptSymbolIndex, token: Token): IndexedDeclaration | undefined {
  const candidates = index.declarations
    .filter((declaration) =>
      declaration.name === token.value
      && declaration.kind !== "enumMember"
      && declaration.kind !== "operator"
      && declaration.kind !== "definitionProperty"
      && token.offset >= declaration.visibleFrom
      && token.offset <= declaration.scopeEnd
    )
    .sort(declarationSort);
  return candidates[0];
}

function chooseDefinitionProperty(index: FeatureScriptSymbolIndex, token: Token): IndexedDeclaration | undefined {
  const candidates = index.declarations
    .filter((declaration) =>
      declaration.kind === "definitionProperty"
      && declaration.name === token.value
      && token.offset >= declaration.scopeStart
      && token.offset <= declaration.scopeEnd
    )
    .sort(declarationSort);
  return candidates[0];
}

function chooseEnumMember(index: FeatureScriptSymbolIndex, enumName: string, token: Token): IndexedDeclaration | undefined {
  const candidates = index.declarations
    .filter((declaration) =>
      declaration.kind === "enumMember"
      && declaration.parent === enumName
      && declaration.name === token.value
      && token.offset >= declaration.scopeStart
      && token.offset <= declaration.scopeEnd
    )
    .sort(declarationSort);
  return candidates[0];
}

function declarationScope(parsed: ParsedProgram, token: Token, kind: IndexedSymbolKind): Pick<IndexedDeclaration, "scopeStart" | "scopeEnd" | "visibleFrom"> {
  if (kind === "parameter") {
    const functionNode = enclosingNode(parsed, token, new Set<AstNodeType>(["FunctionDeclaration", "PredicateDeclaration", "OperatorDeclaration", "FunctionExpression", "FeatureDeclaration"]));
    return {
      scopeStart: functionNode?.start ?? parsed.ast.start,
      scopeEnd: functionNode?.end ?? parsed.ast.end,
      visibleFrom: functionNode?.start ?? parsed.ast.start
    };
  }

  if (isFileScopedDeclaration(parsed, token, kind)) {
    return { scopeStart: parsed.ast.start, scopeEnd: parsed.ast.end, visibleFrom: parsed.ast.start };
  }

  const scopeNode = enclosingNode(parsed, token, localScopeNodeTypes);
  return {
    scopeStart: scopeNode?.start ?? token.offset,
    scopeEnd: scopeNode?.end ?? parsed.ast.end,
    visibleFrom: token.offset
  };
}

function isFileScopedDeclaration(parsed: ParsedProgram, token: Token, kind: IndexedSymbolKind): boolean {
  if (kind === "enumMember" || kind === "operator") {
    return true;
  }
  return parsed.nodes.some((node) =>
    fileScopedNodeTypes.has(node.type)
    && node.name === token.value
    && token.offset >= node.start
    && token.end <= node.end
  );
}

function declarationKey(kind: IndexedSymbolKind, name: string, scopeStart: number, parent?: string): string {
  if (kind === "enumMember") {
    return `enumMember:${parent ?? ""}.${name}`;
  }
  if (kind === "definitionProperty") {
    return `definition:${scopeStart}.${name}`;
  }
  if (kind === "parameter" || kind === "variable") {
    return `${kind}:${scopeStart}.${name}`;
  }
  return `${kind}:${name}`;
}

function declarationSort(a: IndexedDeclaration, b: IndexedDeclaration): number {
  const span = (a.scopeEnd - a.scopeStart) - (b.scopeEnd - b.scopeStart);
  if (span !== 0) {
    return span;
  }
  return b.visibleFrom - a.visibleFrom;
}

function enclosingEnum(parsed: ParsedProgram, token: Token): AstNode | undefined {
  return enclosingNode(parsed, token, new Set<AstNodeType>(["EnumDeclaration"]));
}

function enclosingNode(parsed: ParsedProgram, token: Token, types: Set<AstNodeType>): AstNode | undefined {
  return parsed.nodes
    .filter((node) =>
      types.has(node.type)
      && token.offset >= node.start
      && token.end <= node.end
      && !(node.type === "Block" && node.name)
    )
    .sort((a, b) => (a.end - a.start) - (b.end - b.start))[0];
}

function previousToken(tokens: readonly Token[], token: Token): Token | undefined {
  const index = tokens.findIndex((candidate) => candidate.offset === token.offset);
  return index > 0 ? tokens[index - 1] : undefined;
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
