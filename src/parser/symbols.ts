import type { Token } from "../lexer/tokens";
import type { AstNode, Program } from "./ast";

export type SemanticTokenType =
  | "namespace"
  | "enum"
  | "enumMember"
  | "type"
  | "function"
  | "variable"
  | "parameter"
  | "property"
  | "decorator"
  | "keyword"
  | "string"
  | "number"
  | "operator"
  | "feature"
  | "predicate"
  | "annotationKey"
  | "mapKey";

export type SemanticTokenModifier =
  | "declaration"
  | "definition"
  | "readonly"
  | "modification"
  | "documentation"
  | "defaultLibrary";

export type SemanticHint = {
  token: Token;
  type: SemanticTokenType;
  modifiers: SemanticTokenModifier[];
};

export type SymbolKind =
  | "feature"
  | "function"
  | "predicate"
  | "enum"
  | "enumMember"
  | "type"
  | "variable"
  | "parameter"
  | "namespace";

export type SymbolInfo = {
  name: string;
  kind: SymbolKind;
  token: Token;
  readonly?: boolean;
  parent?: string;
};

export type ParsedProgram = {
  ast: Program;
  tokens: Token[];
  nodes: AstNode[];
  hints: SemanticHint[];
  symbols: Map<string, SymbolInfo>;
  variables: Map<string, SymbolInfo>;
  parameters: Map<string, SymbolInfo>;
  enums: Set<string>;
  enumMembers: Map<string, Set<string>>;
  importsStdlib: boolean;
};

export type StdlibSymbolKind =
  | "function"
  | "predicate"
  | "type"
  | "enum"
  | "enumMember"
  | "constant"
  | "unit"
  | "unknown";

export type StdlibSymbol = {
  name: string;
  kind: StdlibSymbolKind;
  module?: string;
  signature?: string;
  parent?: string;
};

