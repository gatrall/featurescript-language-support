import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { createRequire } from "node:module";
import type { IGrammar, StateStack } from "vscode-textmate";

const root = process.cwd();
const require = createRequire(import.meta.url);
const oniguruma = require("vscode-oniguruma") as typeof import("vscode-oniguruma");
const textmate = require("vscode-textmate") as typeof import("vscode-textmate");

async function loadGrammar(): Promise<IGrammar> {
  const wasmPath = require.resolve("vscode-oniguruma/release/onig.wasm");
  const wasm = await readFile(wasmPath);
  await oniguruma.loadWASM(wasm.buffer);
  const registry = new textmate.Registry({
    onigLib: Promise.resolve({ createOnigScanner: oniguruma.createOnigScanner, createOnigString: oniguruma.createOnigString }),
    loadGrammar: async (scopeName) => {
      if (scopeName !== "source.featurescript") return null;
      const grammarPath = resolve(root, "syntaxes/featurescript.tmLanguage.json");
      const grammar = await readFile(grammarPath, "utf8");
      return textmate.parseRawGrammar(grammar, grammarPath);
    }
  });
  const grammar = await registry.loadGrammar("source.featurescript");
  assert.ok(grammar);
  return grammar;
}

async function fixture(name: string): Promise<string> {
  return readFile(resolve(root, "test/fixtures", name), "utf8");
}

function scopesForNeedle(grammar: IGrammar, source: string, needle: string): string[] {
  let ruleStack: StateStack | null = null;
  for (const line of source.split(/\r?\n/)) {
    const result = grammar.tokenizeLine(line, ruleStack);
    const index = line.indexOf(needle);
    if (index >= 0) {
      const token = result.tokens.find((candidate) => candidate.startIndex <= index && candidate.endIndex >= index + needle.length);
      assert.ok(token, `No TextMate token found for ${needle}`);
      return token.scopes;
    }
    ruleStack = result.ruleStack;
  }
  assert.fail(`Needle not found: ${needle}`);
}

describe("FeatureScript TextMate grammar", () => {
  let grammar: IGrammar;

  before(async () => {
    grammar = await loadGrammar();
  });

  it("highlights the FeatureScript version directive", async () => {
    const source = await fixture("slot.fs");
    assert.ok(scopesForNeedle(grammar, source, "FeatureScript").includes("storage.type.featurescript"));
    assert.ok(scopesForNeedle(grammar, source, "2909").includes("constant.numeric.featurescript"));
  });

  it("highlights comments, strings, escapes, support calls, and punctuation", async () => {
    const source = await fixture("slot.fs");
    assert.ok(scopesForNeedle(grammar, source, "//").includes("punctuation.definition.comment.featurescript"));
    assert.ok(scopesForNeedle(grammar, source, "Slot").includes("string.quoted.double.featurescript"));
    assert.ok(scopesForNeedle(grammar, await fixture("annotations.fs"), "\\n").includes("constant.character.escape.featurescript"));
    assert.ok(scopesForNeedle(grammar, source, "opExtrude").includes("support.function.featurescript"));
    assert.ok(scopesForNeedle(grammar, source, "{").includes("punctuation.section.block.begin.featurescript"));
    assert.ok(scopesForNeedle(grammar, source, ":").includes("punctuation.separator.colon.featurescript"));
  });

  it("highlights declarations and namespace access", async () => {
    const imports = await fixture("imports.fs");
    const operators = await fixture("operators.fs");
    assert.ok(scopesForNeedle(grammar, imports, "::").includes("punctuation.accessor.namespace.featurescript"));
    assert.ok(scopesForNeedle(grammar, imports, "importedValue").includes("variable.other.constant.featurescript"));
    assert.ok(scopesForNeedle(grammar, operators, "*").includes("entity.name.function.operator.featurescript"));
  });

  it("marks unsupported increment and decrement operators invalid", async () => {
    const source = await fixture("operators.fs");
    assert.ok(scopesForNeedle(grammar, source, "++").includes("invalid.illegal.operator.increment.featurescript"));
    assert.ok(scopesForNeedle(grammar, source, "--").includes("invalid.illegal.operator.increment.featurescript"));
  });
});
