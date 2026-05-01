import assert from "node:assert/strict";
import { extractFromSource, extractMetadataFromSourceFiles, type SourceFile } from "../scripts/update-stdlib-symbols";

const source = [
  "FeatureScript 2909;",
  "export enum MyEnum",
  "{",
  "    ONE,",
  "    TWO",
  "}",
  "export predicate extraFields(booleanDefinition is map)",
  "{",
  "    annotation { \"Name\" : \"Merge scope\" }",
  "    booleanDefinition.mergeScope is Query;",
  "}",
  "/**",
  " * Build a test feature.",
  " *",
  " * @param definition {{",
  " *      @field width {ValueWithUnits} : @optional Width field docs.",
  " * }}",
  " */",
  "export const testFeature = defineFeature(function(context is Context, id is Id, definition is map)",
  "precondition",
  "{",
  "    annotation { \"Name\" : \"Entities\", \"Description\" : \"Input faces\" }",
  "    definition.entities is Query;",
  "    annotation { \"Name\" : \"Depth\" }",
  "    isLength(definition.depth, LENGTH_BOUNDS);",
  "    extraFields(definition);",
  "}",
  "{",
  "});"
].join("\n");

describe("FeatureScript stdlib metadata extraction", () => {
  it("extracts enum variants and feature fields from docs, preconditions, validators, and predicates", () => {
    const files: SourceFile[] = [{ module: "fixture.fs", text: source }];
    const symbols = extractFromSource(source, "fixture.fs");
    const metadata = extractMetadataFromSourceFiles(files, symbols);

    assert.deepEqual(metadata.enums.find((entry) => entry.name === "MyEnum")?.members.map((member) => member.name), ["ONE", "TWO"]);

    const feature = metadata.features.find((entry) => entry.name === "testFeature");
    assert.ok(feature);
    assert.equal(feature.description, "Build a test feature.");

    const width = feature.fields.find((field) => field.name === "width");
    assert.equal(width?.source, "docblock");
    assert.equal(width?.type, "ValueWithUnits");
    assert.equal(width?.required, false);

    const entities = feature.fields.find((field) => field.name === "entities");
    assert.equal(entities?.source, "precondition");
    assert.equal(entities?.label, "Entities");
    assert.equal(entities?.description, "Input faces");

    const depth = feature.fields.find((field) => field.name === "depth");
    assert.equal(depth?.type, "ValueWithUnits");

    const mergeScope = feature.fields.find((field) => field.name === "mergeScope");
    assert.equal(mergeScope?.source, "predicate");
    assert.equal(mergeScope?.predicate, "extraFields");
  });
});
