import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { parseFeatureScript } from "../src/parser/parser";
import type { AstNodeType } from "../src/parser/ast";

const root = process.cwd();

function fixture(name: string): string {
  return readFileSync(resolve(root, "test/fixtures", name), "utf8");
}

function nodeTypes(name: string): Set<AstNodeType> {
  return new Set(parseFeatureScript(fixture(name)).nodes.map((node) => node.type));
}

describe("FeatureScript parser", () => {
  it("recognizes headers, imports, namespaced imports, and custom features", () => {
    const parsed = parseFeatureScript(fixture("semantic.fs"));
    const types = new Set(parsed.nodes.map((node) => node.type));
    assert.ok(types.has("VersionDirective"));
    assert.ok(types.has("ImportDeclaration"));
    assert.ok(types.has("NamespacedImportDeclaration"));
    assert.ok(types.has("FeatureDeclaration"));
    assert.ok(parsed.importsStdlib);
  });

  it("recognizes annotations, maps, blocks, and preconditions", () => {
    const types = nodeTypes("annotations.fs");
    assert.ok(types.has("AnnotationStatement"));
    assert.ok(types.has("AnnotationMap"));
    assert.ok(types.has("MapLiteral"));
    assert.ok(types.has("Block"));
    assert.ok(types.has("PreconditionBlock"));
  });

  it("recognizes predicates, custom types, operators, and enum members", () => {
    const predicateTypes = nodeTypes("predicates.fs");
    const operatorTypes = nodeTypes("operators.fs");
    const semanticTypes = nodeTypes("semantic.fs");
    assert.ok(predicateTypes.has("PredicateDeclaration"));
    assert.ok(predicateTypes.has("TypeDeclaration"));
    assert.ok(operatorTypes.has("OperatorDeclaration"));
    assert.ok(semanticTypes.has("EnumDeclaration"));
    assert.ok(semanticTypes.has("EnumMember"));
  });

  it("recognizes lambdas, function expressions, safe access, box access, and type expressions", () => {
    const operatorTypes = nodeTypes("operators.fs");
    const mapTypes = nodeTypes("maps-vs-blocks.fs");
    assert.ok(operatorTypes.has("ArrowFunction"));
    assert.ok(operatorTypes.has("FunctionExpression"));
    assert.ok(mapTypes.has("SafeMemberAccess"));
    assert.ok(mapTypes.has("SafeIndexAccess"));
    assert.ok(mapTypes.has("BoxAccess"));
    assert.ok(mapTypes.has("SafeBoxAccess"));
    assert.ok(mapTypes.has("TypeConversion"));
    assert.ok(mapTypes.has("TypeCheck"));
  });
});

