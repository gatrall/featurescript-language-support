import assert from "node:assert/strict";
import { extractLeadingDocComment } from "../src/language/docComments";

describe("FeatureScript doc comments", () => {
  it("extracts contiguous line comments above declarations", () => {
    const source = [
      "FeatureScript 2909;",
      "/// First line.",
      "// Second line.",
      "function helper(context is Context)",
      "{",
      "}"
    ].join("\n");
    assert.equal(extractLeadingDocComment(source, 3), "First line.\nSecond line.");
  });

  it("extracts block comments above declarations", () => {
    const source = [
      "FeatureScript 2909;",
      "/**",
      " * Builds a slot.",
      " * Uses a path query.",
      " */",
      "export const slot = defineFeature(function(context is Context, id is Id, definition is map)",
      "{",
      "});"
    ].join("\n");
    assert.equal(extractLeadingDocComment(source, 5), "Builds a slot.\nUses a path query.");
  });

  it("skips FeatureScript annotations between docs and declarations", () => {
    const source = [
      "FeatureScript 2909;",
      "/// Width parameter docs.",
      "annotation",
      "{",
      "    \"Name\" : \"Width\"",
      "}",
      "definition.width is number;"
    ].join("\n");
    assert.equal(extractLeadingDocComment(source, 6), "Width parameter docs.");
  });
});
