import stdlibSymbolsJson from "../generated/stdlibSymbols.json";
import { assignmentOperators, isIdentifierToken, type Token } from "../lexer/tokens";
import type { ParsedProgram, SemanticHint, SemanticTokenModifier, SemanticTokenType, StdlibSymbol } from "../parser/symbols";

type BuildCancellation = {
  isCancellationRequested: boolean;
};

export type BuiltSemanticToken = {
  token: Token;
  type: SemanticTokenType;
  modifiers: SemanticTokenModifier[];
};

type StdlibIndex = {
  byName: Map<string, StdlibSymbol[]>;
  enums: Set<string>;
  enumMembers: Map<string, Set<string>>;
};

const stdlibSymbols = stdlibSymbolsJson as StdlibSymbol[];
const stdlibIndex = createStdlibIndex(stdlibSymbols);

export function buildSemanticTokens(parsed: ParsedProgram, cancellation?: BuildCancellation): BuiltSemanticToken[] {
  const explicit = new Map<number, SemanticHint>();
  for (const hint of parsed.hints) {
    explicit.set(hint.token.offset, withDefaultLibraryIfNeeded(hint, parsed));
  }

  const built: BuiltSemanticToken[] = [];
  const emitted = new Set<number>();
  for (let index = 0; index < parsed.tokens.length; index += 1) {
    if (cancellation?.isCancellationRequested) {
      break;
    }
    const token = parsed.tokens[index];
    if (!token || token.kind === "eof") {
      continue;
    }
    const hint = explicit.get(token.offset);
    if (hint) {
      built.push(upgradeExplicitHint(parsed, hint, index));
      emitted.add(token.offset);
      continue;
    }
    const inferred = inferToken(parsed, token, index);
    if (inferred && !emitted.has(token.offset)) {
      built.push(inferred);
      emitted.add(token.offset);
    }
  }

  return built.sort((a, b) => a.token.offset - b.token.offset);
}

function inferToken(parsed: ParsedProgram, token: Token, index: number): BuiltSemanticToken | undefined {
  if (token.kind === "number") {
    return { token, type: "number", modifiers: [] };
  }
  if (token.kind === "string") {
    return { token, type: "string", modifiers: [] };
  }
  if (token.kind === "operator") {
    return { token, type: "operator", modifiers: [] };
  }
  if (token.kind === "keyword" && !["false", "true", "undefined", "inf"].includes(token.value)) {
    return { token, type: "keyword", modifiers: [] };
  }
  if (!isIdentifierToken(token)) {
    return undefined;
  }

  const previous = previousSignificant(parsed.tokens, index);
  const beforePrevious = previous ? previousSignificant(parsed.tokens, parsed.tokens.indexOf(previous)) : undefined;
  const next = nextSignificant(parsed.tokens, index);
  const modifiers = modificationModifiers(next);

  if (next?.value === "::") {
    return { token, type: "namespace", modifiers };
  }

  if (previous?.value === "." || previous?.value === "?.") {
    const parent = beforePrevious?.value;
    if (parent && (parsed.enums.has(parent) || stdlibIndex.enums.has(parent))) {
      return {
        token,
        type: "enumMember",
        modifiers: uniqueModifiers(["readonly", ...(stdlibIndex.enums.has(parent) ? ["defaultLibrary" as const] : []), ...modifiers])
      };
    }
    return { token, type: "property", modifiers };
  }

  if (previous?.value === "is" || previous?.value === "as" || previous?.value === "returns") {
    return typeToken(token, modifiers, parsed);
  }

  const parameter = parsed.parameters.get(token.value);
  if (parameter) {
    return { token, type: "parameter", modifiers };
  }

  const variable = parsed.variables.get(token.value);
  if (variable) {
    return {
      token,
      type: variable.kind === "feature" ? "feature" : "variable",
      modifiers: uniqueModifiers([...(variable.readonly ? ["readonly" as const] : []), ...modifiers])
    };
  }

  const symbol = parsed.symbols.get(token.value);
  if (symbol) {
    return {
      token,
      type: symbolType(symbol.kind),
      modifiers: uniqueModifiers([...(symbol.readonly ? ["readonly" as const] : []), ...modifiers])
    };
  }

  const stdlib = parsed.importsStdlib ? chooseStdlibSymbol(stdlibIndex.byName.get(token.value), next) : builtInType(token.value);
  if (stdlib) {
    return stdlibToken(token, stdlib, modifiers);
  }

  if (next?.value === "(") {
    return { token, type: "function", modifiers };
  }

  return undefined;
}

function upgradeExplicitHint(parsed: ParsedProgram, hint: SemanticHint, index: number): BuiltSemanticToken {
  if (hint.type !== "property") {
    return hint;
  }
  const previous = previousSignificant(parsed.tokens, index);
  const beforePrevious = previous ? previousSignificant(parsed.tokens, parsed.tokens.indexOf(previous)) : undefined;
  const parent = beforePrevious?.value;
  if (parent && (parsed.enums.has(parent) || stdlibIndex.enums.has(parent))) {
    return {
      token: hint.token,
      type: "enumMember",
      modifiers: uniqueModifiers(["readonly", ...(stdlibIndex.enums.has(parent) ? ["defaultLibrary" as const] : []), ...hint.modifiers])
    };
  }
  return hint;
}

function withDefaultLibraryIfNeeded(hint: SemanticHint, parsed: ParsedProgram): SemanticHint {
  if (hint.type !== "type" && hint.type !== "predicate" && hint.type !== "function" && hint.type !== "enum" && hint.type !== "enumMember" && hint.type !== "variable") {
    return hint;
  }
  if (!parsed.importsStdlib && !builtInType(hint.token.value)) {
    return hint;
  }
  const stdlib = stdlibIndex.byName.get(hint.token.value)?.[0] ?? builtInType(hint.token.value);
  if (!stdlib) {
    return hint;
  }
  return {
    ...hint,
    modifiers: uniqueModifiers([...hint.modifiers, "defaultLibrary", ...(stdlib.kind === "enumMember" || stdlib.kind === "constant" || stdlib.kind === "unit" ? ["readonly" as const] : [])])
  };
}

function typeToken(token: Token, modifiers: SemanticTokenModifier[], parsed: ParsedProgram): BuiltSemanticToken {
  const stdlib = parsed.importsStdlib ? stdlibIndex.byName.get(token.value)?.find((symbol) => symbol.kind === "type") : builtInType(token.value);
  return {
    token,
    type: "type",
    modifiers: uniqueModifiers([...modifiers, ...(stdlib ? ["defaultLibrary" as const] : [])])
  };
}

function stdlibToken(token: Token, symbol: StdlibSymbol, modifiers: SemanticTokenModifier[]): BuiltSemanticToken {
  switch (symbol.kind) {
    case "function":
      return { token, type: "function", modifiers: uniqueModifiers([...modifiers, "defaultLibrary"]) };
    case "predicate":
      return { token, type: "predicate", modifiers: uniqueModifiers([...modifiers, "defaultLibrary"]) };
    case "type":
      return { token, type: "type", modifiers: uniqueModifiers([...modifiers, "defaultLibrary"]) };
    case "enum":
      return { token, type: "enum", modifiers: uniqueModifiers([...modifiers, "defaultLibrary"]) };
    case "enumMember":
      return { token, type: "enumMember", modifiers: uniqueModifiers([...modifiers, "readonly", "defaultLibrary"]) };
    case "constant":
    case "unit":
      return { token, type: "variable", modifiers: uniqueModifiers([...modifiers, "readonly", "defaultLibrary"]) };
    default:
      return { token, type: "variable", modifiers: uniqueModifiers([...modifiers, "defaultLibrary"]) };
  }
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

function symbolType(kind: string): SemanticTokenType {
  switch (kind) {
    case "feature":
      return "feature";
    case "predicate":
      return "predicate";
    case "enum":
      return "enum";
    case "enumMember":
      return "enumMember";
    case "type":
      return "type";
    case "function":
      return "function";
    case "parameter":
      return "parameter";
    default:
      return "variable";
  }
}

function modificationModifiers(next: Token | undefined): SemanticTokenModifier[] {
  if (next && assignmentOperators.has(next.value)) {
    return ["modification"];
  }
  return [];
}

function previousSignificant(tokens: readonly Token[], index: number): Token | undefined {
  for (let i = index - 1; i >= 0; i -= 1) {
    const token = tokens[i];
    if (token?.kind !== "eof") {
      return token;
    }
  }
  return undefined;
}

function nextSignificant(tokens: readonly Token[], index: number): Token | undefined {
  for (let i = index + 1; i < tokens.length; i += 1) {
    const token = tokens[i];
    if (token?.kind !== "eof") {
      return token;
    }
  }
  return undefined;
}

function createStdlibIndex(symbols: readonly StdlibSymbol[]): StdlibIndex {
  const byName = new Map<string, StdlibSymbol[]>();
  const enums = new Set<string>();
  const enumMembers = new Map<string, Set<string>>();
  for (const symbol of symbols) {
    const existing = byName.get(symbol.name) ?? [];
    existing.push(symbol);
    byName.set(symbol.name, existing);
    if (symbol.kind === "enum") {
      enums.add(symbol.name);
    }
    if (symbol.kind === "enumMember" && symbol.parent) {
      const members = enumMembers.get(symbol.parent) ?? new Set<string>();
      members.add(symbol.name);
      enumMembers.set(symbol.parent, members);
    }
  }
  return { byName, enums, enumMembers };
}

function builtInType(name: string): StdlibSymbol | undefined {
  if (["undefined", "boolean", "number", "string", "array", "map", "box", "builtin", "function"].includes(name)) {
    return { name, kind: "type" };
  }
  return undefined;
}

function uniqueModifiers(modifiers: readonly SemanticTokenModifier[]): SemanticTokenModifier[] {
  return [...new Set(modifiers)];
}
