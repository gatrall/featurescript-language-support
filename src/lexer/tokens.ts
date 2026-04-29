export type TokenKind =
  | "identifier"
  | "atIdentifier"
  | "keyword"
  | "number"
  | "string"
  | "operator"
  | "punctuation"
  | "invalid"
  | "eof";

export type Token = {
  kind: TokenKind;
  value: string;
  offset: number;
  end: number;
  line: number;
  character: number;
  endLine: number;
  endCharacter: number;
};

export const keywords = new Set([
  "FeatureScript",
  "annotation",
  "enum",
  "export",
  "function",
  "import",
  "operator",
  "precondition",
  "predicate",
  "returns",
  "type",
  "typecheck",
  "typeconvert",
  "as",
  "is",
  "new",
  "if",
  "else",
  "break",
  "const",
  "continue",
  "for",
  "in",
  "return",
  "var",
  "while",
  "try",
  "catch",
  "throw",
  "false",
  "true",
  "undefined",
  "inf",
  "assert",
  "case",
  "default",
  "do",
  "switch"
]);

export const assignmentOperators = new Set([
  "=",
  "+=",
  "-=",
  "*=",
  "/=",
  "^=",
  "%=",
  "||=",
  "&&=",
  "??=",
  "~="
]);

export function isIdentifierToken(token: Token | undefined): token is Token {
  return token?.kind === "identifier" || token?.kind === "keyword";
}

export function isTriviaFreeToken(token: Token | undefined): token is Token {
  return token !== undefined && token.kind !== "eof";
}

