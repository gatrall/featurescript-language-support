import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { parseFeatureScript } from "../src/parser/parser";
import { buildSemanticTokens } from "../src/semantic/classifier";
import type { SemanticTokenModifier, SemanticTokenType } from "../src/parser/symbols";

const root = process.cwd();

type FoundToken = {
  value: string;
  type: SemanticTokenType;
  modifiers: SemanticTokenModifier[];
};

function semanticFixtureTokens(): FoundToken[] {
  const source = readFileSync(resolve(root, "test/fixtures/semantic.fs"), "utf8");
  const parsed = parseFeatureScript(source);
  return buildSemanticTokens(parsed).map((entry) => ({
    value: entry.token.value,
    type: entry.type,
    modifiers: entry.modifiers
  }));
}

function find(tokens: FoundToken[], value: string, type?: SemanticTokenType): FoundToken {
  const token = tokens.find((candidate) => candidate.value === value && (!type || candidate.type === type));
  assert.ok(token, `Missing semantic token ${value}${type ? ` as ${type}` : ""}`);
  return token;
}

function findWithModifier(tokens: FoundToken[], value: string, type: SemanticTokenType, modifier: SemanticTokenModifier): FoundToken {
  const token = tokens.find((candidate) => candidate.value === value && candidate.type === type && candidate.modifiers.includes(modifier));
  assert.ok(token, `Missing semantic token ${value} as ${type} with ${modifier}`);
  return token;
}

function hasModifiers(token: FoundToken, ...modifiers: SemanticTokenModifier[]): void {
  for (const modifier of modifiers) {
    assert.ok(token.modifiers.includes(modifier), `${token.value} missing modifier ${modifier}`);
  }
}

describe("FeatureScript semantic tokens", () => {
  it("classifies declarations and parameters", () => {
    const tokens = semanticFixtureTokens();
    hasModifiers(find(tokens, "slot", "feature"), "declaration", "readonly");
    hasModifiers(find(tokens, "helper", "function"), "declaration");
    hasModifiers(findWithModifier(tokens, "canBePerson", "predicate", "declaration"), "declaration");
    hasModifiers(find(tokens, "Person", "type"), "declaration");
    hasModifiers(find(tokens, "MyOption", "enum"), "declaration");
    hasModifiers(find(tokens, "definition", "parameter"), "declaration");
  });

  it("classifies annotation keys, map keys, properties, and namespaces", () => {
    const tokens = semanticFixtureTokens();
    assert.equal(find(tokens, "\"Feature Type Name\"").type, "annotationKey");
    assert.equal(find(tokens, "\"entities\"").type, "mapKey");
    assert.equal(find(tokens, "unquotedKey").type, "mapKey");
    assert.equal(find(tokens, "width", "property").type, "property");
    assert.equal(find(tokens, "foo").type, "namespace");
  });

  it("classifies stdlib symbols and enum members", () => {
    const tokens = semanticFixtureTokens();
    hasModifiers(find(tokens, "Context", "type"), "defaultLibrary");
    hasModifiers(find(tokens, "defineFeature", "function"), "defaultLibrary");
    hasModifiers(find(tokens, "opExtrude", "function"), "defaultLibrary");
    hasModifiers(find(tokens, "qCreatedBy", "function"), "defaultLibrary");
    hasModifiers(find(tokens, "LENGTH_BOUNDS", "variable"), "readonly", "defaultLibrary");
    hasModifiers(find(tokens, "inch", "variable"), "readonly", "defaultLibrary");
    hasModifiers(find(tokens, "BoundingType", "enum"), "defaultLibrary");
    hasModifiers(find(tokens, "THROUGH_ALL", "enumMember"), "readonly", "defaultLibrary");
    hasModifiers(find(tokens, "ONE", "enumMember"), "readonly");
    assert.ok(tokens.some((token) => token.value === "ONE" && token.type === "enumMember" && !token.modifiers.includes("declaration")));
  });
});
