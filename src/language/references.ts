import * as vscode from "vscode";
import type { Token } from "../lexer/tokens";
import type { FeatureScriptParseCache } from "./parseCache";
import { buildSymbolIndex, definitionAtOffset, referencesAtOffset } from "./symbolIndex";

export class FeatureScriptDefinitionProvider implements vscode.DefinitionProvider {
  constructor(private readonly cache: FeatureScriptParseCache) {}

  provideDefinition(document: vscode.TextDocument, position: vscode.Position, cancellationToken: vscode.CancellationToken): vscode.ProviderResult<vscode.Definition> {
    if (cancellationToken.isCancellationRequested) {
      return undefined;
    }
    const index = buildSymbolIndex(this.cache.get(document));
    const definition = definitionAtOffset(index, document.offsetAt(position));
    if (!definition || cancellationToken.isCancellationRequested) {
      return undefined;
    }
    return new vscode.Location(document.uri, rangeFromToken(definition.token));
  }
}

export class FeatureScriptReferenceProvider implements vscode.ReferenceProvider {
  constructor(private readonly cache: FeatureScriptParseCache) {}

  provideReferences(document: vscode.TextDocument, position: vscode.Position, context: vscode.ReferenceContext, cancellationToken: vscode.CancellationToken): vscode.ProviderResult<vscode.Location[]> {
    if (cancellationToken.isCancellationRequested) {
      return [];
    }
    const index = buildSymbolIndex(this.cache.get(document));
    const references = referencesAtOffset(index, document.offsetAt(position), context.includeDeclaration);
    if (cancellationToken.isCancellationRequested) {
      return [];
    }
    return references.map((reference) => new vscode.Location(document.uri, rangeFromToken(reference.token)));
  }
}

function rangeFromToken(token: Token): vscode.Range {
  return new vscode.Range(token.line, token.character, token.endLine, token.endCharacter);
}
