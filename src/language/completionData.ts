import { isIdentifierToken, type Token } from "../lexer/tokens";
import type { AstNode } from "../parser/ast";
import type { ParsedProgram } from "../parser/symbols";
import {
  dedupeFeatureFields,
  getStdlibEnum,
  getStdlibFeature,
  topLevelFeatureFields,
  type FeatureField,
  type StdlibEnumMember
} from "./stdlibMetadata";

export type EnumCompletionData = {
  kind: "enumMember";
  enumName: string;
  members: StdlibEnumMember[];
  replacementStart: number;
  replacementEnd: number;
};

export type FeatureMapCompletionData = {
  kind: "featureMapKey";
  featureName: string;
  fields: FeatureField[];
  replacementStart: number;
  replacementEnd: number;
};

export type FeatureScriptCompletionData = EnumCompletionData | FeatureMapCompletionData;

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

export function completionDataAtOffset(parsed: ParsedProgram, source: string, offset: number): FeatureScriptCompletionData | undefined {
  const lexicalState = lexicalStateAtOffset(source, offset);
  if (lexicalState === "comment") {
    return undefined;
  }

  const tokens = parsed.tokens.filter((token) => token.kind !== "eof");
  const mapContext = featureMapContext(parsed, tokens, offset);
  if (mapContext) {
    return mapContext;
  }

  if (lexicalState === "string") {
    return undefined;
  }

  return enumCompletionContext(parsed, tokens, offset);
}

export function enumMembersForName(parsed: ParsedProgram, enumName: string): StdlibEnumMember[] {
  const members: StdlibEnumMember[] = [];
  for (const member of parsed.enumMembers.get(enumName) ?? []) {
    members.push({ name: member });
  }
  if (parsed.importsStdlib) {
    members.push(...(getStdlibEnum(enumName)?.members ?? []));
  }
  const seen = new Set<string>();
  return members.filter((member) => {
    if (seen.has(member.name)) {
      return false;
    }
    seen.add(member.name);
    return true;
  }).sort((a, b) => a.name.localeCompare(b.name));
}

export function featureFieldsForName(parsed: ParsedProgram, featureName: string): FeatureField[] {
  const fields: FeatureField[] = [];
  fields.push(...localFeatureFields(parsed, featureName));
  if (parsed.importsStdlib) {
    const stdlibFeature = getStdlibFeature(featureName);
    if (stdlibFeature) {
      fields.push(...topLevelFeatureFields(stdlibFeature));
    }
  }
  return dedupeFeatureFields(fields);
}

function enumCompletionContext(parsed: ParsedProgram, tokens: readonly Token[], offset: number): EnumCompletionData | undefined {
  const current = tokenAtCursor(tokens, offset);
  const currentIndex = current ? tokens.indexOf(current) : -1;
  let dotIndex = -1;
  let replacementStart = offset;
  let replacementEnd = offset;

  if (current && isIdentifierToken(current) && currentIndex > 0) {
    const previous = previousSignificant(tokens, currentIndex);
    if (previous?.value === "." || previous?.value === "?.") {
      dotIndex = tokens.indexOf(previous);
      replacementStart = current.offset;
      replacementEnd = current.end;
    }
  }

  if (dotIndex < 0) {
    const previous = previousSignificantBeforeOffset(tokens, offset);
    if (previous?.value === "." || previous?.value === "?.") {
      dotIndex = tokens.indexOf(previous);
    }
  }

  if (dotIndex < 1) {
    return undefined;
  }

  const enumToken = previousSignificant(tokens, dotIndex);
  if (!enumToken || !isIdentifierToken(enumToken)) {
    return undefined;
  }

  const members = enumMembersForName(parsed, enumToken.value);
  if (members.length === 0) {
    return undefined;
  }

  return {
    kind: "enumMember",
    enumName: enumToken.value,
    members,
    replacementStart,
    replacementEnd
  };
}

function featureMapContext(parsed: ParsedProgram, tokens: readonly Token[], offset: number): FeatureMapCompletionData | undefined {
  const openIndex = currentOpenBrace(tokens, offset);
  if (openIndex < 0 || !expectingMapKey(tokens, openIndex, offset)) {
    return undefined;
  }

  const call = callForMap(tokens, openIndex);
  if (!call || call.argumentIndex !== 2) {
    return undefined;
  }

  const fields = featureFieldsForName(parsed, call.name);
  if (fields.length === 0) {
    return undefined;
  }

  const existing = existingTopLevelKeys(tokens, openIndex);
  const replacement = replacementRangeForMapKey(tokens, openIndex, offset);
  const availableFields = fields.filter((field) => !existing.has(field.name));
  if (availableFields.length === 0) {
    return undefined;
  }

  return {
    kind: "featureMapKey",
    featureName: call.name,
    fields: availableFields,
    replacementStart: replacement.start,
    replacementEnd: replacement.end
  };
}

function localFeatureFields(parsed: ParsedProgram, featureName: string): FeatureField[] {
  const featureNode = parsed.nodes.find((node) => node.type === "FeatureDeclaration" && node.name === featureName);
  if (!featureNode) {
    return [];
  }
  return fieldsFromDefinitionTokens(parsed.tokens, featureNode);
}

function fieldsFromDefinitionTokens(tokens: readonly Token[], node: AstNode): FeatureField[] {
  const fields: FeatureField[] = [];
  const scoped = tokens.filter((token) => token.offset >= node.start && token.end <= node.end);
  for (let index = 0; index < scoped.length; index += 1) {
    const token = scoped[index];
    if (!token) {
      continue;
    }
    if (token.value === "definition") {
      const dot = scoped[index + 1];
      const property = scoped[index + 2];
      const operator = scoped[index + 3];
      const type = scoped[index + 4];
      if ((dot?.value === "." || dot?.value === "?.") && property && isIdentifierToken(property) && operator?.value === "is" && type && isIdentifierToken(type)) {
        fields.push(definitionField(property.value, type.value));
      }
    }
    if (validatorTypes.has(token.value) && scoped[index + 1]?.value === "(" && scoped[index + 2]?.value === "definition") {
      const dot = scoped[index + 3];
      const property = scoped[index + 4];
      if ((dot?.value === "." || dot?.value === "?.") && property && isIdentifierToken(property)) {
        fields.push(definitionField(property.value, validatorTypes.get(token.value)));
      }
    }
  }
  return dedupeFeatureFields(fields);
}

function definitionField(name: string, type?: string): FeatureField {
  const field: FeatureField = { name, source: "precondition" };
  if (type) {
    field.type = type;
  }
  if (type && /^[A-Z][A-Za-z0-9_]*$/.test(type) && !nonEnumTypes.has(type)) {
    field.enumType = type;
  }
  return field;
}

function currentOpenBrace(tokens: readonly Token[], offset: number): number {
  const stack: number[] = [];
  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index];
    if (!token || token.offset >= offset) {
      break;
    }
    if (token.value === "{") {
      stack.push(index);
    } else if (token.value === "}") {
      stack.pop();
    }
  }
  return stack.at(-1) ?? -1;
}

function expectingMapKey(tokens: readonly Token[], openIndex: number, offset: number): boolean {
  let expectingKey = true;
  let parenDepth = 0;
  let bracketDepth = 0;
  let braceDepth = 0;
  for (let index = openIndex + 1; index < tokens.length; index += 1) {
    const token = tokens[index];
    if (!token || token.offset >= offset) {
      break;
    }
    if (token.value === "{" ) {
      braceDepth += 1;
    } else if (token.value === "}") {
      if (braceDepth === 0) {
        break;
      }
      braceDepth -= 1;
    } else if (token.value === "(") {
      parenDepth += 1;
    } else if (token.value === ")") {
      parenDepth = Math.max(0, parenDepth - 1);
    } else if (token.value === "[") {
      bracketDepth += 1;
    } else if (token.value === "]") {
      bracketDepth = Math.max(0, bracketDepth - 1);
    } else if (parenDepth === 0 && bracketDepth === 0 && braceDepth === 0 && token.value === ":") {
      expectingKey = false;
    } else if (parenDepth === 0 && bracketDepth === 0 && braceDepth === 0 && token.value === ",") {
      expectingKey = true;
    }
  }
  return expectingKey;
}

function callForMap(tokens: readonly Token[], openIndex: number): { name: string; argumentIndex: number } | undefined {
  let parenDepth = 0;
  let callOpenIndex = -1;
  for (let index = openIndex - 1; index >= 0; index -= 1) {
    const token = tokens[index];
    if (!token) {
      continue;
    }
    if (token.value === ")") {
      parenDepth += 1;
    } else if (token.value === "(") {
      if (parenDepth === 0) {
        callOpenIndex = index;
        break;
      }
      parenDepth -= 1;
    }
  }
  if (callOpenIndex < 1) {
    return undefined;
  }
  const callToken = previousSignificant(tokens, callOpenIndex);
  if (!callToken || !isIdentifierToken(callToken)) {
    return undefined;
  }
  return {
    name: callToken.value,
    argumentIndex: argumentIndexBefore(tokens, callOpenIndex, openIndex)
  };
}

function argumentIndexBefore(tokens: readonly Token[], openParenIndex: number, targetIndex: number): number {
  let argumentIndex = 0;
  let parenDepth = 0;
  let bracketDepth = 0;
  let braceDepth = 0;
  for (let index = openParenIndex + 1; index < targetIndex; index += 1) {
    const token = tokens[index];
    if (!token) {
      continue;
    }
    if (token.value === "(") parenDepth += 1;
    else if (token.value === ")") parenDepth = Math.max(0, parenDepth - 1);
    else if (token.value === "[") bracketDepth += 1;
    else if (token.value === "]") bracketDepth = Math.max(0, bracketDepth - 1);
    else if (token.value === "{") braceDepth += 1;
    else if (token.value === "}") braceDepth = Math.max(0, braceDepth - 1);
    else if (token.value === "," && parenDepth === 0 && bracketDepth === 0 && braceDepth === 0) argumentIndex += 1;
  }
  return argumentIndex;
}

function existingTopLevelKeys(tokens: readonly Token[], openIndex: number): Set<string> {
  const keys = new Set<string>();
  const closeIndex = matchingBraceIndex(tokens, openIndex);
  const stop = closeIndex < 0 ? tokens.length : closeIndex;
  let parenDepth = 0;
  let bracketDepth = 0;
  let braceDepth = 0;
  for (let index = openIndex + 1; index < stop; index += 1) {
    const token = tokens[index];
    if (!token) {
      continue;
    }
    if (token.value === "{") braceDepth += 1;
    else if (token.value === "}") braceDepth = Math.max(0, braceDepth - 1);
    else if (token.value === "(") parenDepth += 1;
    else if (token.value === ")") parenDepth = Math.max(0, parenDepth - 1);
    else if (token.value === "[") bracketDepth += 1;
    else if (token.value === "]") bracketDepth = Math.max(0, bracketDepth - 1);

    if (parenDepth !== 0 || bracketDepth !== 0 || braceDepth !== 0) {
      continue;
    }
    const next = nextSignificant(tokens, index);
    if ((token.kind === "string" || isIdentifierToken(token)) && next?.value === ":") {
      keys.add(unquoteKey(token.value));
    }
  }
  return keys;
}

function replacementRangeForMapKey(tokens: readonly Token[], openIndex: number, offset: number): { start: number; end: number } {
  const token = tokenAtCursor(tokens, offset);
  if (token && token.offset > (tokens[openIndex]?.offset ?? -1) && token.kind === "string") {
    const quote = token.value[0] ?? "";
    const hasClosingQuote = token.value.length > 1 && token.value.endsWith(quote);
    return { start: token.offset, end: hasClosingQuote ? token.end : offset };
  }
  if (token && token.offset > (tokens[openIndex]?.offset ?? -1) && isIdentifierToken(token)) {
    return { start: token.offset, end: token.end };
  }
  return { start: offset, end: offset };
}

function matchingBraceIndex(tokens: readonly Token[], openIndex: number): number {
  let depth = 0;
  for (let index = openIndex; index < tokens.length; index += 1) {
    const token = tokens[index];
    if (token?.value === "{") {
      depth += 1;
    } else if (token?.value === "}") {
      depth -= 1;
      if (depth === 0) {
        return index;
      }
    }
  }
  return -1;
}

function tokenAtCursor(tokens: readonly Token[], offset: number): Token | undefined {
  return tokens.find((token) => token.offset <= offset && offset <= token.end && token.end > token.offset);
}

function previousSignificantBeforeOffset(tokens: readonly Token[], offset: number): Token | undefined {
  for (let index = tokens.length - 1; index >= 0; index -= 1) {
    const token = tokens[index];
    if (token && token.end <= offset) {
      return token;
    }
  }
  return undefined;
}

function previousSignificant(tokens: readonly Token[], index: number): Token | undefined {
  for (let i = index - 1; i >= 0; i -= 1) {
    const token = tokens[i];
    if (token) {
      return token;
    }
  }
  return undefined;
}

function nextSignificant(tokens: readonly Token[], index: number): Token | undefined {
  for (let i = index + 1; i < tokens.length; i += 1) {
    const token = tokens[i];
    if (token) {
      return token;
    }
  }
  return undefined;
}

function unquoteKey(value: string): string {
  if ((value.startsWith("\"") && value.endsWith("\"")) || (value.startsWith("'") && value.endsWith("'"))) {
    return value.slice(1, -1);
  }
  return value;
}

function lexicalStateAtOffset(source: string, offset: number): "normal" | "comment" | "string" {
  let state: "normal" | "lineComment" | "blockComment" | "string" = "normal";
  let quote = "";
  for (let index = 0; index < offset && index < source.length; index += 1) {
    const char = source[index] ?? "";
    const next = source[index + 1] ?? "";
    if (state === "lineComment") {
      if (char === "\n") {
        state = "normal";
      }
      continue;
    }
    if (state === "blockComment") {
      if (char === "*" && next === "/") {
        index += 1;
        state = "normal";
      }
      continue;
    }
    if (state === "string") {
      if (char === "\\") {
        index += 1;
      } else if (char === quote) {
        state = "normal";
      }
      continue;
    }
    if (char === "/" && next === "/") {
      index += 1;
      state = "lineComment";
    } else if (char === "/" && next === "*") {
      index += 1;
      state = "blockComment";
    } else if (char === "\"" || char === "'") {
      quote = char;
      state = "string";
    }
  }
  return state === "lineComment" || state === "blockComment" ? "comment" : state;
}
