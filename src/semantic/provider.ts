import * as vscode from "vscode";
import type { FeatureScriptParseCache } from "../language/parseCache";
import type { ParsedProgram } from "../parser/symbols";
import { buildSemanticTokens } from "./classifier";
import { encodeModifiers, legend, tokenTypes } from "./legend";

export class FeatureScriptSemanticTokensProvider implements vscode.DocumentSemanticTokensProvider {
  private readonly emitter = new vscode.EventEmitter<void>();
  private readonly debounceTimers = new Map<string, NodeJS.Timeout>();

  readonly onDidChangeSemanticTokens = this.emitter.event;

  constructor(private readonly cache: FeatureScriptParseCache) {}

  scheduleRefresh(document: vscode.TextDocument): void {
    if (document.languageId !== "featurescript") {
      return;
    }
    const key = document.uri.toString();
    const existing = this.debounceTimers.get(key);
    if (existing) {
      clearTimeout(existing);
    }
    const timer = setTimeout(() => {
      this.debounceTimers.delete(key);
      this.emitter.fire();
    }, 150);
    this.debounceTimers.set(key, timer);
  }

  provideDocumentSemanticTokens(document: vscode.TextDocument, cancellationToken: vscode.CancellationToken): vscode.ProviderResult<vscode.SemanticTokens> {
    if (cancellationToken.isCancellationRequested) {
      return new vscode.SemanticTokens(new Uint32Array());
    }
    const parsed: ParsedProgram = this.cache.get(document);

    const builder = new vscode.SemanticTokensBuilder(legend);
    for (const semanticToken of buildSemanticTokens(parsed, cancellationToken)) {
      if (cancellationToken.isCancellationRequested) {
        return new vscode.SemanticTokens(new Uint32Array());
      }
      if (semanticToken.token.line !== semanticToken.token.endLine) {
        continue;
      }
      builder.push(
        semanticToken.token.line,
        semanticToken.token.character,
        Math.max(1, semanticToken.token.endCharacter - semanticToken.token.character),
        tokenTypes.indexOf(semanticToken.type),
        encodeModifiers(semanticToken.modifiers)
      );
    }
    return builder.build();
  }

  dispose(): void {
    for (const timer of this.debounceTimers.values()) {
      clearTimeout(timer);
    }
    this.debounceTimers.clear();
    this.emitter.dispose();
  }
}
