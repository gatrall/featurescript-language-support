import * as vscode from "vscode";
import type { SemanticTokenModifier, SemanticTokenType } from "../parser/symbols";

export const tokenTypes: SemanticTokenType[] = [
  "namespace",
  "enum",
  "enumMember",
  "type",
  "function",
  "variable",
  "parameter",
  "property",
  "decorator",
  "keyword",
  "string",
  "number",
  "operator",
  "feature",
  "predicate",
  "annotationKey",
  "mapKey"
];

export const tokenModifiers: SemanticTokenModifier[] = [
  "declaration",
  "definition",
  "readonly",
  "modification",
  "documentation",
  "defaultLibrary"
];

export const legend = new vscode.SemanticTokensLegend(tokenTypes, tokenModifiers);

export function encodeModifiers(modifiers: readonly SemanticTokenModifier[]): number {
  let encoded = 0;
  for (const modifier of modifiers) {
    const index = tokenModifiers.indexOf(modifier);
    if (index >= 0) {
      encoded |= 1 << index;
    }
  }
  return encoded;
}

