import stdlibMetadataJson from "../generated/stdlibMetadata.json";

export type StdlibEnumMember = {
  name: string;
  module?: string;
  doc?: string;
};

export type StdlibEnum = {
  name: string;
  module?: string;
  members: StdlibEnumMember[];
};

export type FeatureFieldSource = "docblock" | "precondition" | "predicate";

export type FeatureField = {
  name: string;
  type?: string;
  label?: string;
  description?: string;
  required?: boolean;
  source: FeatureFieldSource;
  predicate?: string;
  nestedPath?: string[];
  enumType?: string;
  defaultValue?: string;
  condition?: string;
};

export type FeatureMetadata = {
  name: string;
  module?: string;
  signature?: string;
  description?: string;
  fields: FeatureField[];
};

export type StdlibMetadata = {
  enums: StdlibEnum[];
  features: FeatureMetadata[];
};

const metadata = stdlibMetadataJson as StdlibMetadata;
const enumsByName = new Map(metadata.enums.map((entry) => [entry.name, entry]));
const featuresByName = new Map(metadata.features.map((entry) => [entry.name, entry]));

export function getStdlibEnum(name: string): StdlibEnum | undefined {
  return enumsByName.get(name);
}

export function getStdlibFeature(name: string): FeatureMetadata | undefined {
  return featuresByName.get(name);
}

export function stdlibEnumNames(): readonly string[] {
  return [...enumsByName.keys()];
}

export function topLevelFeatureFields(feature: FeatureMetadata): FeatureField[] {
  return feature.fields.filter((field) => !field.nestedPath || field.nestedPath.length === 0);
}

export function dedupeFeatureFields(fields: readonly FeatureField[]): FeatureField[] {
  const map = new Map<string, FeatureField>();
  for (const field of fields) {
    const key = `${field.nestedPath?.join(".") ?? ""}\0${field.name}`;
    const existing = map.get(key);
    if (!existing) {
      map.set(key, field);
      continue;
    }
    map.set(key, mergeFeatureField(existing, field));
  }
  return [...map.values()].sort((a, b) => {
    const pathCompare = (a.nestedPath?.join(".") ?? "").localeCompare(b.nestedPath?.join(".") ?? "");
    return pathCompare || a.name.localeCompare(b.name);
  });
}

function mergeFeatureField(existing: FeatureField, field: FeatureField): FeatureField {
  const merged: FeatureField = {
    name: field.name,
    source: field.source
  };
  const type = existing.type ?? field.type;
  const label = existing.label ?? field.label;
  const description = existing.description ?? field.description;
  const required = existing.required ?? field.required;
  if (type !== undefined) merged.type = type;
  if (label !== undefined) merged.label = label;
  if (description !== undefined) merged.description = description;
  if (required !== undefined) merged.required = required;
  if (field.predicate !== undefined) merged.predicate = field.predicate;
  if (field.nestedPath !== undefined) merged.nestedPath = field.nestedPath;
  if (field.enumType !== undefined) merged.enumType = field.enumType;
  if (field.defaultValue !== undefined) merged.defaultValue = field.defaultValue;
  if (field.condition !== undefined) merged.condition = field.condition;
  return merged;
}
