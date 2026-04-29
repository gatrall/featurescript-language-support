import * as vscode from "vscode";
import { parseFeatureScript } from "../parser/parser";
import type { ParsedProgram } from "../parser/symbols";

type CacheEntry = {
  version: number;
  parsed: ParsedProgram;
};

export class FeatureScriptParseCache {
  private readonly entries = new Map<string, CacheEntry>();

  get(document: vscode.TextDocument): ParsedProgram {
    const key = document.uri.toString();
    const existing = this.entries.get(key);
    if (existing?.version === document.version) {
      return existing.parsed;
    }
    const parsed = parseFeatureScript(document.getText());
    this.entries.set(key, { version: document.version, parsed });
    return parsed;
  }

  delete(document: vscode.TextDocument): void {
    this.entries.delete(document.uri.toString());
  }

  clear(): void {
    this.entries.clear();
  }
}

