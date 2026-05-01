import assert from "node:assert/strict";
import { completionDataAtOffset } from "../src/language/completionData";
import { parseFeatureScript } from "../src/parser/parser";

function completionAt(source: string, marker: string) {
  const offset = source.indexOf(marker);
  assert.notEqual(offset, -1, `Missing marker ${marker}`);
  const cleanSource = source.slice(0, offset) + source.slice(offset + marker.length);
  return completionDataAtOffset(parseFeatureScript(cleanSource), cleanSource, offset);
}

describe("FeatureScript completion data", () => {
  it("suggests stdlib and local enum members after enum access", () => {
    const source = [
      "FeatureScript 2909;",
      "import(path : \"onshape/std/geometry.fs\", version : \"2909.0\");",
      "export enum MyOption",
      "{",
      "    ONE,",
      "    TWO",
      "}"
    ].join("\n");

    const stdlibSource = `${source}\nconst a = BoundingType.<>;`;
    const stdlibData = completionAt(stdlibSource, "<>");
    assert.equal(stdlibData?.kind, "enumMember");
    assert.ok(stdlibData?.kind === "enumMember" && stdlibData.members.some((member) => member.name === "THROUGH_ALL"));

    const localSource = `${source}\nconst b = MyOption.<>;`;
    const localData = completionAt(localSource, "<>");
    assert.equal(localData?.kind, "enumMember");
    assert.deepEqual(localData?.kind === "enumMember" ? localData.members.map((member) => member.name) : [], ["ONE", "TWO"]);
  });

  it("suggests generated stdlib feature definition-map keys", () => {
    const prefix = [
      "FeatureScript 2909;",
      "import(path : \"onshape/std/geometry.fs\", version : \"2909.0\");",
      "function run(context is Context, id is Id)",
      "{"
    ].join("\n");
    const suffix = "\n}";

    const extrude = completionAt(`${prefix}\n    extrude(context, id + "extrude", { <> });${suffix}`, "<>");
    assert.equal(extrude?.kind, "featureMapKey");
    assert.ok(extrude?.kind === "featureMapKey" && extrude.fields.some((field) => field.name === "entities"));
    assert.ok(extrude?.kind === "featureMapKey" && extrude.fields.some((field) => field.name === "endBound"));

    const frame = completionAt(`${prefix}\n    frame(context, id + "frame", { <> });${suffix}`, "<>");
    assert.equal(frame?.kind, "featureMapKey");
    assert.ok(frame?.kind === "featureMapKey" && frame.fields.some((field) => field.name === "profileSketch"));

    const enclose = completionAt(`${prefix}\n    enclose(context, id + "enclose", { <> });${suffix}`, "<>");
    assert.equal(enclose?.kind, "featureMapKey");
    assert.ok(enclose?.kind === "featureMapKey" && enclose.fields.some((field) => field.name === "keepTools"));
    assert.ok(enclose?.kind === "featureMapKey" && enclose.fields.some((field) => field.name === "operationType"));

    const quoted = completionAt(`${prefix}\n    extrude(context, id + "extrude", { "<> });${suffix}`, "<>");
    assert.equal(quoted?.kind, "featureMapKey");
    assert.equal(quoted?.replacementEnd, quoted?.replacementStart === undefined ? undefined : quoted.replacementStart + 1);
  });

  it("suggests local feature fields and suppresses duplicate map keys", () => {
    const source = [
      "FeatureScript 2909;",
      "export const slot = defineFeature(function(context is Context, id is Id, definition is map)",
      "precondition",
      "{",
      "    definition.width is number;",
      "    isLength(definition.depth, LENGTH_BOUNDS);",
      "}",
      "{",
      "});",
      "function run(context is Context, id is Id)",
      "{",
      "    slot(context, id + \"slot\", { \"width\" : 1, <> });",
      "}"
    ].join("\n");

    const data = completionAt(source, "<>");
    assert.equal(data?.kind, "featureMapKey");
    assert.ok(data?.kind === "featureMapKey" && !data.fields.some((field) => field.name === "width"));
    assert.ok(data?.kind === "featureMapKey" && data.fields.some((field) => field.name === "depth"));
  });

  it("does not suggest completions in comments or ordinary strings", () => {
    const source = [
      "FeatureScript 2909;",
      "import(path : \"onshape/std/geometry.fs\", version : \"2909.0\");",
      "// BoundingType.<>",
      "const text = \"BoundingType.<>\";"
    ].join("\n");

    assert.equal(completionAt(source, "<>"), undefined);
    assert.equal(completionAt(source.replace("// BoundingType.<>", "// BoundingType.BLIND"), "<>"), undefined);
  });
});
