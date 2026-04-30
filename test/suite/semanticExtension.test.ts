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

function positionOf(document: vscode.TextDocument, content: string, needle: string, after = 0): vscode.Position {
  const offset = content.indexOf(needle);
  assert.notEqual(offset, -1, `Missing source fragment ${needle}`);
  return document.positionAt(offset + after);
}

function resultStartLine(location: vscode.Location | vscode.LocationLink): number {
  return "targetUri" in location ? (location.targetSelectionRange ?? location.targetRange).start.line : location.range.start.line;
}

function hoverText(hovers: readonly vscode.Hover[] | undefined): string {
  return hovers?.flatMap((hover) => hover.contents.map((content) => {
    if (typeof content === "string") {
      return content;
    }
    return content.value;
  })).join("\n") ?? "";
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

  it("returns current-file definitions and references", async () => {
    const extension = vscode.extensions.getExtension("onshape-fs.featurescript-language-support");
    assert.ok(extension);
    await extension.activate();

    const content = [
      "FeatureScript 2909;",
      "function helper(context is Context) returns Query",
      "{",
      "    return context;",
      "}",
      "export enum MyOption",
      "{",
      "    ONE,",
      "    TWO",
      "}",
      "export const slot = defineFeature(function(context is Context, id is Id, definition is map)",
      "precondition { definition.width is number; }",
      "{ helper(context, definition.width); const selected = MyOption.ONE; const again = slot; });"
    ].join("\n");
    const document = await vscode.workspace.openTextDocument({ language: "featurescript", content });

    const helperDefinitions = await vscode.commands.executeCommand<Array<vscode.Location | vscode.LocationLink>>(
      "vscode.executeDefinitionProvider",
      document.uri,
      positionOf(document, content, "helper(context, definition.width)")
    );
    assert.ok(helperDefinitions?.some((location) => resultStartLine(location) === 1));

    const widthDefinitions = await vscode.commands.executeCommand<Array<vscode.Location | vscode.LocationLink>>(
      "vscode.executeDefinitionProvider",
      document.uri,
      positionOf(document, content, "helper(context, definition.width)", "helper(context, definition.".length)
    );
    assert.ok(widthDefinitions?.some((location) => resultStartLine(location) === 11));

    const enumMemberDefinitions = await vscode.commands.executeCommand<Array<vscode.Location | vscode.LocationLink>>(
      "vscode.executeDefinitionProvider",
      document.uri,
      positionOf(document, content, "MyOption.ONE", "MyOption.".length)
    );
    assert.ok(enumMemberDefinitions?.some((location) => resultStartLine(location) === 7));

    const helperDeclarations = await vscode.commands.executeCommand<Array<vscode.Location | vscode.LocationLink>>(
      "vscode.executeDeclarationProvider",
      document.uri,
      positionOf(document, content, "helper(context, definition.width)")
    );
    assert.ok(helperDeclarations?.some((location) => resultStartLine(location) === 1));

    const helperReferences = await vscode.commands.executeCommand<vscode.Location[]>(
      "vscode.executeReferenceProvider",
      document.uri,
      positionOf(document, content, "helper(context is Context")
    );
    assert.ok(helperReferences?.some((location) => location.range.start.line === 1));
    assert.ok(helperReferences?.some((location) => location.range.start.line === 12));
  });

  it("returns local doc-comment and stdlib hovers", async () => {
    const extension = vscode.extensions.getExtension("onshape-fs.featurescript-language-support");
    assert.ok(extension);
    await extension.activate();

    const content = [
      "FeatureScript 2909;",
      "import(path : \"onshape/std/geometry.fs\", version : \"2909.0\");",
      "/// Returns the query to use for the operation.",
      "function helper(context is Context) returns Query",
      "{",
      "    return qEverything(EntityType.EDGE);",
      "}",
      "export const slot = defineFeature(function(context is Context, id is Id, definition is map)",
      "{ opExtrude(context, id + \"op1\", { \"endBound\" : BoundingType.THROUGH_ALL }); helper(context); });"
    ].join("\n");
    const document = await vscode.workspace.openTextDocument({ language: "featurescript", content });

    const helperHovers = await vscode.commands.executeCommand<vscode.Hover[]>(
      "vscode.executeHoverProvider",
      document.uri,
      positionOf(document, content, "helper(context);")
    );
    const helperText = hoverText(helperHovers).replace(/&nbsp;/g, " ");
    assert.match(helperText, /Returns the query to use for the operation/);
    assert.match(helperText, /function helper/);

    const stdlibHovers = await vscode.commands.executeCommand<vscode.Hover[]>(
      "vscode.executeHoverProvider",
      document.uri,
      positionOf(document, content, "opExtrude(context")
    );
    const stdlibText = hoverText(stdlibHovers);
    assert.match(stdlibText, /FeatureScript stdlib function/);
    assert.match(stdlibText, /opExtrude/);
    assert.match(stdlibText, /geomOperations\.fs/);
  });
});
