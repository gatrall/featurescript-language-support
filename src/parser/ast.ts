import type { Token } from "../lexer/tokens";

export type AstNodeType =
  | "Program"
  | "VersionDirective"
  | "ImportDeclaration"
  | "NamespacedImportDeclaration"
  | "AnnotationStatement"
  | "AnnotationMap"
  | "TopLevelConst"
  | "FeatureDeclaration"
  | "FunctionDeclaration"
  | "FunctionExpression"
  | "ArrowFunction"
  | "PredicateDeclaration"
  | "OperatorDeclaration"
  | "EnumDeclaration"
  | "EnumMember"
  | "TypeDeclaration"
  | "PreconditionBlock"
  | "Block"
  | "MapLiteral"
  | "ArrayLiteral"
  | "FunctionCall"
  | "MemberAccess"
  | "SafeMemberAccess"
  | "IndexAccess"
  | "SafeIndexAccess"
  | "BoxAccess"
  | "SafeBoxAccess"
  | "NamespaceAccess"
  | "TypeCheck"
  | "TypeConversion";

export type AstNode = {
  type: AstNodeType;
  start: number;
  end: number;
  name?: string;
  token?: Token;
  children?: AstNode[];
};

export type Program = AstNode & {
  type: "Program";
  tokens: Token[];
  children: AstNode[];
};

