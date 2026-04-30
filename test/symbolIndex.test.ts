import assert from "node:assert/strict";
import { parseFeatureScript } from "../src/parser/parser";
import { buildSymbolIndex, definitionAtOffset, referencesAtOffset } from "../src/language/symbolIndex";

const source = [
  "FeatureScript 2909;",
  "import(path : \"onshape/std/geometry.fs\", version : \"2909.0\");",
  "export enum MyOption",
  "{",
  "    ONE,",
  "    TWO",
  "}",
  "export type Person typecheck canBePerson;",
  "export predicate canBePerson(value)",
  "{",
  "    value is map;",
  "}",
  "function helper(context is Context, query is Query) returns Query",
  "{",
  "    const local = query;",
  "    return local;",
  "}",
  "const shared = 1;",
  "function scopeA(x is number)",
  "{",
  "    const shared = x;",
  "    return shared;",
  "}",
  "function scopeB(x is number)",
  "{",
  "    return shared;",
  "}",
  "const keyName = 1;",
  "const ordinaryMap = { keyName : keyName };",
  "annotation { keyName : \"Ignored\" }",
  "annotation { \"Feature Type Name\" : \"Slot\" }",
  "export const slot = defineFeature(function(context is Context, id is Id, definition is map)",
  "precondition",
  "{",
  "    annotation { \"Name\" : \"Width\" }",
  "    definition.width is number;",
  "    definition.mode is MyOption;",
  "}",
  "{",
  "    helper(context, definition.width);",
  "    const selected = MyOption.ONE;",
  "    const again = slot;",
  "});"
].join("\n");

const parsed = parseFeatureScript(source);
const index = buildSymbolIndex(parsed);

function offsetOf(needle: string, after = 0): number {
  const offset = source.indexOf(needle);
  assert.notEqual(offset, -1, `Missing source fragment ${needle}`);
  return offset + after;
}

function definitionAt(needle: string, after = 0) {
  return definitionAtOffset(index, offsetOf(needle, after));
}

describe("FeatureScript symbol index", () => {
  it("resolves local functions, features, and typecheck predicates", () => {
    assert.equal(definitionAt("helper(context, definition.width)")?.token.offset, offsetOf("helper(context is Context"));
    assert.equal(definitionAt("slot;", 0)?.token.offset, offsetOf("slot = defineFeature"));
    assert.equal(definitionAt("typecheck canBePerson", "typecheck ".length)?.token.offset, offsetOf("predicate canBePerson", "predicate ".length));
  });

  it("resolves enum member references from qualified enum access", () => {
    const oneDefinition = definitionAt("MyOption.ONE", "MyOption.".length);
    assert.equal(oneDefinition?.kind, "enumMember");
    assert.equal(oneDefinition?.parent, "MyOption");
    assert.equal(oneDefinition?.token.offset, offsetOf("ONE,"));
  });

  it("prefers scoped parameters and local consts over top-level declarations", () => {
    assert.equal(definitionAt("const local = query", "const local = ".length)?.token.offset, offsetOf("query is Query"));
    assert.equal(definitionAt("return local", "return ".length)?.token.offset, offsetOf("local = query"));
    assert.equal(definitionAt("return shared;", "return ".length)?.token.offset, offsetOf("shared = x"));
    assert.equal(definitionAt("scopeB(x is number)\n{\n    return shared", "scopeB(x is number)\n{\n    return ".length)?.token.offset, offsetOf("shared = 1"));
  });

  it("resolves definition parameter properties to precondition declarations", () => {
    const widthDefinition = definitionAt("helper(context, definition.width)", "helper(context, definition.".length);
    assert.equal(widthDefinition?.kind, "definitionProperty");
    assert.equal(widthDefinition?.token.offset, offsetOf("definition.width is number", "definition.".length));

    const references = referencesAtOffset(index, offsetOf("definition.width is number", "definition.".length), true);
    assert.equal(references.filter((reference) => reference.name === "width").length, 2);
  });

  it("ignores map keys and annotation keys as definitions", () => {
    assert.equal(definitionAt("ordinaryMap = { keyName", "ordinaryMap = { ".length), undefined);
    assert.equal(definitionAt("keyName : keyName", "keyName : ".length)?.token.offset, offsetOf("keyName = 1"));
    assert.equal(definitionAt("annotation { keyName", "annotation { ".length), undefined);
  });

  it("honors includeDeclaration for current-file references", () => {
    const helperDeclarationOffset = offsetOf("helper(context is Context");
    const withDeclaration = referencesAtOffset(index, helperDeclarationOffset, true);
    const withoutDeclaration = referencesAtOffset(index, helperDeclarationOffset, false);
    assert.ok(withDeclaration.some((reference) => reference.token.offset === helperDeclarationOffset));
    assert.ok(withDeclaration.some((reference) => reference.token.offset === offsetOf("helper(context, definition.width)")));
    assert.ok(!withoutDeclaration.some((reference) => reference.token.offset === helperDeclarationOffset));
  });
});
