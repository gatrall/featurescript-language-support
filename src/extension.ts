import * as vscode from "vscode";
import { FeatureScriptParseCache } from "./language/parseCache";
import { FeatureScriptDocumentSymbolProvider, FeatureScriptFoldingRangeProvider } from "./language/navigation";
import { FeatureScriptSemanticTokensProvider } from "./semantic/provider";
import { legend } from "./semantic/legend";

export function activate(context: vscode.ExtensionContext): void {
  const parseCache = new FeatureScriptParseCache();
  const semanticProvider = new FeatureScriptSemanticTokensProvider(parseCache);
  context.subscriptions.push(semanticProvider);
  context.subscriptions.push(
    vscode.languages.registerDocumentSemanticTokensProvider(
      { language: "featurescript" },
      semanticProvider,
      legend
    )
  );
  context.subscriptions.push(
    vscode.languages.registerDocumentSymbolProvider(
      { language: "featurescript" },
      new FeatureScriptDocumentSymbolProvider(parseCache)
    )
  );
  context.subscriptions.push(
    vscode.languages.registerFoldingRangeProvider(
      { language: "featurescript" },
      new FeatureScriptFoldingRangeProvider(parseCache)
    )
  );
  context.subscriptions.push(
    vscode.workspace.onDidChangeTextDocument((event) => semanticProvider.scheduleRefresh(event.document))
  );
  context.subscriptions.push(
    vscode.workspace.onDidCloseTextDocument((document) => parseCache.delete(document))
  );
}

export function deactivate(): void {
  // Disposables are owned by the extension context.
}
