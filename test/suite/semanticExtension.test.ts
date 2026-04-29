import assert from "node:assert/strict";
import * as vscode from "vscode";
import { tokenModifiers, tokenTypes } from "../../src/semantic/legend";

type DecodedToken = {
  line: number;
  character: number;
  length: number;
  type: string;
  modifiers: string[];
};

function decode(tokens: vscode.SemanticTokens): DecodedToken[] {
  const decoded: DecodedToken[] = [];
  let line = 0;
  let character = 0;
  for (let index = 0; index < tokens.data.length; index += 5) {
    line += tokens.data[index] ?? 0;
    character = (tokens.data[index] ?? 0) === 0 ? character + (tokens.data[index + 1] ?? 0) : tokens.data[index + 1] ?? 0;
    const length = tokens.data[index + 2] ?? 0;
    const type = tokenTypes[tokens.data[index + 3] ?? -1] ?? "unknown";
    const modifierBits = tokens.data[index + 4] ?? 0;
    const modifiers = tokenModifiers.filter((_, bit) => (modifierBits & (1 << bit)) !== 0);
    decoded.push({ line, character, length, type, modifiers });
  }
  return decoded;
}

describe("VS Code semantic token provider", () => {
  it("returns semantic tokens for a FeatureScript document", async () => {
    const extension = vscode.extensions.getExtension("onshape-fs.featurescript-language-support");
    assert.ok(extension);
    await extension.activate();

    const document = await vscode.workspace.openTextDocument({
      language: "featurescript",
      content: [
        "FeatureScript 2909;",
        "import(path : \"onshape/std/geometry.fs\", version : \"2909.0\");",
        "annotation { \"Feature Type Name\" : \"Slot\" }",
        "export const slot = defineFeature(function(context is Context, id is Id, definition is map)",
        "precondition { annotation { \"Name\" : \"Width\" } isLength(definition.width, LENGTH_BOUNDS); }",
        "{ opExtrude(context, id + \"op1\", { \"endBound\" : BoundingType.THROUGH_ALL }); });"
      ].join("\n")
    });
    const tokens = await vscode.commands.executeCommand<vscode.SemanticTokens>("vscode.provideDocumentSemanticTokens", document.uri);
    assert.ok(tokens);
    const decoded = decode(tokens);
    assert.ok(decoded.some((token) => token.type === "feature" && token.modifiers.includes("declaration")));
    assert.ok(decoded.some((token) => token.type === "annotationKey"));
    assert.ok(decoded.some((token) => token.type === "enumMember" && token.modifiers.includes("defaultLibrary")));
  });

  it("returns symbols and folding ranges for navigation and sticky scroll", async () => {
    const extension = vscode.extensions.getExtension("onshape-fs.featurescript-language-support");
    assert.ok(extension);
    await extension.activate();

    const document = await vscode.workspace.openTextDocument({
      language: "featurescript",
      content: [
        "FeatureScript 2909;",
        "import(path : \"onshape/std/geometry.fs\", version : \"2909.0\");",
        "function helper(context is Context) returns Query",
        "{",
        "    return qEverything(EntityType.EDGE);",
        "}",
        "const zero = function()",
        "{",
        "    return 0;",
        "};",
        "annotation { \"Feature Type Name\" : \"Slot\" }",
        "export const slot = defineFeature(function(context is Context, id is Id, definition is map)",
        "precondition { annotation { \"Name\" : \"Width\" } isLength(definition.width, LENGTH_BOUNDS); }",
        "{ opExtrude(context, id + \"op1\", { \"endBound\" : BoundingType.THROUGH_ALL }); });"
      ].join("\n")
    });
    const symbols = await vscode.commands.executeCommand<vscode.DocumentSymbol[]>("vscode.executeDocumentSymbolProvider", document.uri);
    assert.ok(symbols?.some((symbol) => symbol.name === "helper"));
    assert.ok(symbols?.some((symbol) => symbol.name === "zero"));
    assert.ok(symbols?.some((symbol) => symbol.name === "slot"));

    const foldingRanges = await vscode.commands.executeCommand<vscode.FoldingRange[]>("vscode.executeFoldingRangeProvider", document.uri);
    assert.ok(foldingRanges?.some((range) => range.start === 2 && range.end >= 5), "helper fold should start on the function header");
    assert.ok(foldingRanges?.some((range) => range.start === 6 && range.end >= 9), "const function fold should start on the const header");
    assert.ok(foldingRanges?.some((range) => range.start === 11 && range.end >= 13), "feature fold should start on the export const header");
  });
});
