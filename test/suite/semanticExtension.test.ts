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

function completionLabels(completions: vscode.CompletionList | undefined): string[] {
  return completions?.items.map((item) => typeof item.label === "string" ? item.label : item.label.label) ?? [];
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
      "{ opExtrude(context, id + \"op1\", { \"endBound\" : BoundingType.THROUGH_ALL }); extrude(context, id + \"feature\", { \"entities\" : qEverything(EntityType.EDGE) }); helper(context); });"
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

    const enumHovers = await vscode.commands.executeCommand<vscode.Hover[]>(
      "vscode.executeHoverProvider",
      document.uri,
      positionOf(document, content, "BoundingType.THROUGH_ALL")
    );
    const enumText = hoverText(enumHovers);
    assert.match(enumText, /BoundingType variants/);
    assert.match(enumText, /THROUGH_ALL/);

    const featureHovers = await vscode.commands.executeCommand<vscode.Hover[]>(
      "vscode.executeHoverProvider",
      document.uri,
      positionOf(document, content, "extrude(context")
    );
    const featureText = hoverText(featureHovers);
    assert.match(featureText, /Definition fields/);
    assert.match(featureText, /entities/);
    assert.match(featureText, /endBound/);
  });

  it("returns deterministic enum-member and feature-map completions", async () => {
    const extension = vscode.extensions.getExtension("onshape-fs.featurescript-language-support");
    assert.ok(extension);
    await extension.activate();

    const rawContent = [
      "FeatureScript 2909;",
      "import(path : \"onshape/std/geometry.fs\", version : \"2909.0\");",
      "export enum MyOption",
      "{",
      "    ONE,",
      "    TWO",
      "}",
      "export const slot = defineFeature(function(context is Context, id is Id, definition is map)",
      "precondition { definition.width is number; isLength(definition.depth, LENGTH_BOUNDS); }",
      "{",
      "    const a = BoundingType.<>;",
      "    const b = MyOption.<>;",
      "    extrude(context, id + \"extrude\", { <> });",
      "    slot(context, id + \"slot\", { \"width\" : 1, <> });",
      "});"
    ].join("\n");
    const markerOffsets: number[] = [];
    let content = rawContent;
    while (content.includes("<>")) {
      const offset = content.indexOf("<>");
      markerOffsets.push(offset);
      content = content.slice(0, offset) + content.slice(offset + 2);
    }
    const document = await vscode.workspace.openTextDocument({ language: "featurescript", content });

    const stdlibEnum = await vscode.commands.executeCommand<vscode.CompletionList>(
      "vscode.executeCompletionItemProvider",
      document.uri,
      document.positionAt(markerOffsets[0] ?? 0),
      "."
    );
    assert.ok(completionLabels(stdlibEnum).includes("THROUGH_ALL"));

    const localEnum = await vscode.commands.executeCommand<vscode.CompletionList>(
      "vscode.executeCompletionItemProvider",
      document.uri,
      document.positionAt(markerOffsets[1] ?? 0),
      "."
    );
    assert.ok(completionLabels(localEnum).includes("ONE"));

    const extrudeMap = await vscode.commands.executeCommand<vscode.CompletionList>(
      "vscode.executeCompletionItemProvider",
      document.uri,
      document.positionAt(markerOffsets[2] ?? 0),
      "{"
    );
    assert.ok(completionLabels(extrudeMap).includes("entities"));
    assert.ok(completionLabels(extrudeMap).includes("endBound"));

    const localFeatureMap = await vscode.commands.executeCommand<vscode.CompletionList>(
      "vscode.executeCompletionItemProvider",
      document.uri,
      document.positionAt(markerOffsets[3] ?? 0),
      ","
    );
    assert.ok(!completionLabels(localFeatureMap).includes("width"));
    assert.ok(completionLabels(localFeatureMap).includes("depth"));
  });
});
