import { scan } from "../lexer/scanner";
import { assignmentOperators, isIdentifierToken, type Token } from "../lexer/tokens";
import type { AstNode, AstNodeType, Program } from "./ast";
import type { ParsedProgram, SemanticHint, SemanticTokenModifier, SemanticTokenType, SymbolInfo, SymbolKind } from "./symbols";

const expressionStops = new Set([";", ",", "}", ")"]);

export function parseFeatureScript(source: string): ParsedProgram {
  return new Parser(scan(source)).parse();
}

export class Parser {
  private current = 0;
  private readonly nodes: AstNode[] = [];
  private readonly hints: SemanticHint[] = [];
  private readonly symbols = new Map<string, SymbolInfo>();
  private readonly variables = new Map<string, SymbolInfo>();
  private readonly parameters = new Map<string, SymbolInfo>();
  private readonly enums = new Set<string>();
  private readonly enumMembers = new Map<string, Set<string>>();
  private importsStdlib = false;

  constructor(private readonly tokens: Token[]) {}

  parse(): ParsedProgram {
    const start = this.peek();
    while (!this.isAtEnd()) {
      this.parseTopLevel();
    }
    const end = this.previous() ?? start;
    const ast: Program = {
      type: "Program",
      start: start.offset,
      end: end.end,
      tokens: this.tokens,
      children: this.nodes
    };
    return {
      ast,
      tokens: this.tokens,
      nodes: this.nodes,
      hints: this.hints,
      symbols: this.symbols,
      variables: this.variables,
      parameters: this.parameters,
      enums: this.enums,
      enumMembers: this.enumMembers,
      importsStdlib: this.importsStdlib
    };
  }

  private parseTopLevel(): void {
    if (this.matchValue("FeatureScript")) {
      const start = this.previousRequired();
      if (this.checkKind("number")) this.advance();
      this.consumeOptional(";");
      this.addNode("VersionDirective", start, this.previousRequired());
      return;
    }

    if (this.checkValue("annotation")) {
      this.parseAnnotation();
      return;
    }

    const exported = this.matchValue("export");
    if (this.checkIdentifierLike() && this.look(1)?.value === "::" && this.look(2)?.value === "import") {
      this.parseImport(exported, this.advance());
      return;
    }

    if (this.checkValue("import")) {
      this.parseImport(exported);
      return;
    }

    switch (this.peek().value) {
      case "const":
        this.parseVariableDeclaration(true, true);
        return;
      case "var":
        this.parseVariableDeclaration(false, true);
        return;
      case "function":
        this.parseFunctionDeclaration();
        return;
      case "predicate":
        this.parsePredicateDeclaration();
        return;
      case "operator":
        this.parseOperatorDeclaration();
        return;
      case "enum":
        this.parseEnumDeclaration();
        return;
      case "type":
        this.parseTypeDeclaration();
        return;
      default:
        if (exported) {
          this.synchronizeTopLevel();
        } else {
          this.parseStatement();
        }
    }
  }

  private parseImport(_exported: boolean, namespace?: Token): void {
    const start = namespace ?? this.peek();
    if (namespace) {
      this.addHint(namespace, "namespace", []);
      this.addNode("NamespaceAccess", namespace, this.look(1) ?? namespace, namespace.value);
      this.consumeOptional("::");
    }
    this.consumeOptional("import");
    while (!this.isAtEnd() && !this.checkValue(";")) {
      const token = this.advance();
      if (token.kind === "string" && /onshape\/std\/(?:geometry|common)\.fs/.test(token.value)) {
        this.importsStdlib = true;
      }
    }
    this.consumeOptional(";");
    this.addNode(namespace ? "NamespacedImportDeclaration" : "ImportDeclaration", start, this.previousRequired(), namespace?.value);
  }

  private parseAnnotation(): void {
    const start = this.advance();
    this.addHint(start, "decorator", []);
    if (this.checkValue("{")) {
      this.parseBrace(true, "AnnotationMap");
    }
    this.addNode("AnnotationStatement", start, this.previousRequired());
  }

  private parseEnumDeclaration(): void {
    const start = this.advance();
    const name = this.consumeIdentifier();
    if (name) {
      this.declare(name, "enum");
      this.enums.add(name.value);
      this.addHint(name, "enum", ["declaration"]);
    }
    if (this.checkValue("{")) {
      this.advance();
      while (!this.isAtEnd() && !this.checkValue("}")) {
        if (this.checkValue("annotation")) {
          this.parseAnnotation();
          continue;
        }
        if (this.checkIdentifierLike()) {
          const member = this.advance();
          const parent = name?.value;
          if (parent) {
            this.addEnumMember(parent, member.value);
          }
          this.declare(member, "enumMember", true, parent);
          this.addHint(member, "enumMember", ["declaration", "readonly"]);
          this.addNode("EnumMember", member, member, member.value);
          this.consumeOptional(",");
          continue;
        }
        this.advance();
      }
      this.consumeOptional("}");
    }
    this.addNode("EnumDeclaration", start, this.previousRequired(), name?.value);
  }

  private parseTypeDeclaration(): void {
    const start = this.advance();
    const name = this.consumeIdentifier();
    if (name) {
      this.declare(name, "type");
      this.addHint(name, "type", ["declaration"]);
    }
    while (!this.isAtEnd() && !this.checkValue(";")) {
      if (this.matchValue("typecheck", "typeconvert")) {
        const target = this.consumeIdentifier();
        if (target) {
          this.addHint(target, "predicate", []);
        }
        continue;
      }
      this.parseExpressionToken();
    }
    this.consumeOptional(";");
    this.addNode("TypeDeclaration", start, this.previousRequired(), name?.value);
  }

  private parseFunctionDeclaration(): void {
    const start = this.advance();
    const name = this.consumeIdentifier();
    if (name) {
      this.declare(name, "function");
      this.addHint(name, "function", ["declaration"]);
    }
    this.parseFunctionTail();
    this.addNode("FunctionDeclaration", start, this.previousRequired(), name?.value);
  }

  private parsePredicateDeclaration(): void {
    const start = this.advance();
    const name = this.consumeIdentifier();
    if (name) {
      this.declare(name, "predicate");
      this.addHint(name, "predicate", ["declaration"]);
    }
    this.parseFunctionTail();
    this.addNode("PredicateDeclaration", start, this.previousRequired(), name?.value);
  }

  private parseOperatorDeclaration(): void {
    const start = this.advance();
    const operator = this.advance();
    if (operator && operator.kind !== "eof") {
      this.addHint(operator, "function", ["declaration"]);
    }
    this.parseFunctionTail();
    this.addNode("OperatorDeclaration", start, this.previousRequired(), operator.value);
  }

  private parseFunctionTail(): void {
    if (this.checkValue("(")) {
      this.parseParameterList();
    }
    if (this.matchValue("returns")) {
      const typeToken = this.consumeIdentifier();
      if (typeToken) {
        this.addHint(typeToken, "type", []);
      }
    }
    if (this.checkValue("precondition")) {
      const precondition = this.advance();
      if (this.checkValue("{")) {
        this.parseBrace(false, "PreconditionBlock");
      }
      this.addNode("PreconditionBlock", precondition, this.previousRequired());
    }
    if (this.checkValue("{")) {
      this.parseBrace(false, "Block");
    }
  }

  private parseFunctionExpression(): void {
    const start = this.advance();
    if (this.checkIdentifierLike() && this.look(1)?.value === "(") {
      const name = this.advance();
      this.declare(name, "function");
      this.addHint(name, "function", ["declaration"]);
    }
    this.parseFunctionTail();
    this.addNode("FunctionExpression", start, this.previousRequired());
  }

  private parseVariableDeclaration(readonly: boolean, topLevel: boolean): void {
    const start = this.advance();
    const name = this.consumeIdentifier();
    let isFeature = false;
    if (name && this.checkValue("=")) {
      let index = this.current + 1;
      while (this.tokens[index]?.kind === "punctuation" && this.tokens[index]?.value === "(") {
        index += 1;
      }
      isFeature = this.tokens[index]?.value === "defineFeature";
    }
    if (name) {
      const kind: SymbolKind = isFeature ? "feature" : "variable";
      this.declare(name, kind, readonly);
      this.variables.set(name.value, { name: name.value, kind, token: name, readonly });
      this.addHint(name, isFeature ? "feature" : "variable", readonly ? ["declaration", "readonly"] : ["declaration"]);
    }
    if (this.matchValue("=")) {
      this.parseExpressionUntil(new Set([";"]));
    }
    this.consumeOptional(";");
    this.addNode(isFeature ? "FeatureDeclaration" : topLevel && readonly ? "TopLevelConst" : "Block", start, this.previousRequired(), name?.value);
  }

  private parseStatement(): void {
    if (this.isAtEnd()) return;
    if (this.checkValue("annotation")) {
      this.parseAnnotation();
      return;
    }
    if (this.checkValue("precondition")) {
      const start = this.advance();
      if (this.checkValue("{")) {
        this.parseBrace(false, "PreconditionBlock");
      }
      this.addNode("PreconditionBlock", start, this.previousRequired());
      return;
    }
    if (this.checkValue("const")) {
      this.parseVariableDeclaration(true, false);
      return;
    }
    if (this.checkValue("var")) {
      this.parseVariableDeclaration(false, false);
      return;
    }
    if (this.checkValue("{")) {
      this.parseBrace(false, "Block");
      return;
    }
    this.parseExpressionUntil(new Set([";", "}"]));
    this.consumeOptional(";");
  }

  private parseExpressionUntil(stops: Set<string>): void {
    while (!this.isAtEnd() && !stops.has(this.peek().value)) {
      this.parseExpressionToken(stops);
    }
  }

  private parseExpressionToken(stops = expressionStops): void {
    const token = this.peek();
    if (token.value === "function") {
      this.parseFunctionExpression();
      return;
    }
    if (token.value === "{") {
      this.parseBrace(false);
      return;
    }
    if (token.value === "(") {
      this.parseParen(stops);
      return;
    }
    if (token.value === "[") {
      this.parseBracket();
      return;
    }
    if (token.value === "?[") {
      const start = this.advance();
      this.parseExpressionUntil(new Set(["]"]));
      this.consumeOptional("]");
      this.addNode("SafeIndexAccess", start, this.previousRequired());
      return;
    }
    if (token.value === "?[]") {
      const start = this.advance();
      this.addNode("SafeBoxAccess", start, start);
      return;
    }
    if (token.value === "." || token.value === "?.") {
      const start = this.advance();
      const property = this.consumeIdentifier();
      if (property) {
        const modifiers: SemanticTokenModifier[] = assignmentOperators.has(this.peek().value) ? ["modification"] : [];
        this.addHint(property, "property", modifiers);
      }
      this.addNode(start.value === "?." ? "SafeMemberAccess" : "MemberAccess", start, property ?? start, property?.value);
      return;
    }
    if (token.value === "::") {
      const start = this.advance();
      this.addNode("NamespaceAccess", start, start);
      return;
    }
    if (token.value === "is" || token.value === "as") {
      const start = this.advance();
      const typeToken = this.consumeIdentifier();
      if (typeToken) {
        this.addHint(typeToken, "type", []);
      }
      this.addNode(start.value === "is" ? "TypeCheck" : "TypeConversion", start, typeToken ?? start);
      return;
    }
    if (this.checkIdentifierLike() && this.look(1)?.value === "::") {
      const namespace = this.advance();
      this.addHint(namespace, "namespace", []);
      this.consumeOptional("::");
      this.addNode("NamespaceAccess", namespace, this.previousRequired(), namespace.value);
      return;
    }
    if (this.checkIdentifierLike() && this.look(1)?.value === "(") {
      const call = this.advance();
      this.addNode("FunctionCall", call, call, call.value);
      return;
    }
    if (this.checkIdentifierLike() && this.look(1)?.value === "=>") {
      const parameter = this.advance();
      this.parameters.set(parameter.value, { name: parameter.value, kind: "parameter", token: parameter });
      this.addHint(parameter, "parameter", ["declaration"]);
      const arrow = this.advance();
      this.addNode("ArrowFunction", parameter, arrow);
      return;
    }
    this.advance();
  }

  private parseParen(stops: Set<string>): void {
    const open = this.advance();
    const contentStart = this.current;
    this.parseExpressionUntil(new Set([")"]));
    this.consumeOptional(")");
    const closeIndex = this.current - 1;
    if (this.checkValue("=>")) {
      for (let i = contentStart; i < closeIndex; i += 1) {
        const token = this.tokens[i];
        if (token && token.kind === "identifier") {
          this.parameters.set(token.value, { name: token.value, kind: "parameter", token });
          this.addHint(token, "parameter", ["declaration"]);
        }
      }
      const arrow = this.advance();
      this.addNode("ArrowFunction", open, arrow);
      this.parseExpressionUntil(stops);
    }
  }

  private parseBracket(): void {
    const previous = this.previous();
    const start = this.advance();
    if (this.checkValue("]")) {
      this.advance();
      this.addNode(previous && isIdentifierToken(previous) ? "BoxAccess" : "ArrayLiteral", start, this.previousRequired());
      return;
    }
    this.parseExpressionUntil(new Set(["]"]));
    this.consumeOptional("]");
    this.addNode(previous && isIdentifierToken(previous) ? "IndexAccess" : "ArrayLiteral", start, this.previousRequired());
  }

  private parseParameterList(): void {
    this.consumeOptional("(");
    while (!this.isAtEnd() && !this.checkValue(")")) {
      if (this.checkIdentifierLike()) {
        const parameter = this.advance();
        this.parameters.set(parameter.value, { name: parameter.value, kind: "parameter", token: parameter });
        this.addHint(parameter, "parameter", ["declaration"]);
        if (this.matchValue("is")) {
          const typeToken = this.consumeIdentifier();
          if (typeToken) {
            this.addHint(typeToken, "type", []);
          }
        }
        continue;
      }
      this.advance();
    }
    this.consumeOptional(")");
  }

  private parseBrace(annotationContext: boolean, forcedType?: "AnnotationMap" | "PreconditionBlock" | "Block"): void {
    const start = this.advance();
    const map = annotationContext || forcedType === "AnnotationMap" || (!forcedType && this.looksLikeMap());
    if (map) {
      while (!this.isAtEnd() && !this.checkValue("}")) {
        this.parseMapEntry(annotationContext);
        this.consumeOptional(",");
      }
      this.consumeOptional("}");
      this.addNode(annotationContext || forcedType === "AnnotationMap" ? "AnnotationMap" : "MapLiteral", start, this.previousRequired());
      return;
    }
    while (!this.isAtEnd() && !this.checkValue("}")) {
      this.parseStatement();
    }
    this.consumeOptional("}");
    this.addNode(forcedType ?? "Block", start, this.previousRequired());
  }

  private parseMapEntry(annotationContext: boolean): void {
    const key = this.peek();
    if (key.kind === "string") {
      this.addHint(key, annotationContext ? "annotationKey" : "mapKey", []);
      this.advance();
    } else if (this.checkIdentifierLike() && this.look(1)?.value === ":") {
      this.addHint(key, annotationContext ? "annotationKey" : "mapKey", []);
      this.advance();
    } else if (key.value === "(") {
      this.parseParen(new Set([":", ",", "}"]));
    } else {
      this.parseExpressionUntil(new Set([":", ",", "}"]));
    }
    if (this.matchValue(":")) {
      this.parseExpressionUntil(new Set([",", "}"]));
    }
  }

  private looksLikeMap(): boolean {
    let paren = 0;
    let bracket = 0;
    let brace = 0;
    for (let i = this.current; i < this.tokens.length; i += 1) {
      const token = this.tokens[i];
      if (!token || token.kind === "eof") return false;
      if (token.value === "{" ) {
        brace += 1;
      } else if (token.value === "}") {
        if (brace === 0) return false;
        brace -= 1;
      } else if (token.value === "(") {
        paren += 1;
      } else if (token.value === ")") {
        paren -= 1;
      } else if (token.value === "[") {
        bracket += 1;
      } else if (token.value === "]") {
        bracket -= 1;
      } else if (token.value === ":" && paren === 0 && bracket === 0 && brace === 0) {
        return true;
      } else if (token.value === ";" && paren === 0 && bracket === 0 && brace === 0) {
        return false;
      }
    }
    return false;
  }

  private declare(token: Token, kind: SymbolKind, readonly?: boolean, parent?: string): void {
    const symbol: SymbolInfo = { name: token.value, kind, token };
    if (readonly !== undefined) symbol.readonly = readonly;
    if (parent !== undefined) symbol.parent = parent;
    this.symbols.set(parent ? `${parent}.${token.value}` : token.value, symbol);
  }

  private addEnumMember(parent: string, member: string): void {
    const members = this.enumMembers.get(parent) ?? new Set<string>();
    members.add(member);
    this.enumMembers.set(parent, members);
  }

  private addHint(token: Token, type: SemanticTokenType, modifiers: SemanticTokenModifier[]): void {
    this.hints.push({ token, type, modifiers });
  }

  private addNode(type: AstNodeType, start: Token, end: Token, name?: string): void {
    const node: AstNode = { type, start: start.offset, end: end.end };
    if (name !== undefined) node.name = name;
    node.token = start;
    this.nodes.push(node);
  }

  private consumeIdentifier(): Token | undefined {
    if (this.checkIdentifierLike()) {
      return this.advance();
    }
    return undefined;
  }

  private consumeOptional(value: string): boolean {
    if (this.checkValue(value)) {
      this.advance();
      return true;
    }
    return false;
  }

  private matchValue(...values: string[]): boolean {
    if (values.includes(this.peek().value)) {
      this.advance();
      return true;
    }
    return false;
  }

  private synchronizeTopLevel(): void {
    while (!this.isAtEnd() && !this.checkValue(";") && !this.checkValue("}")) {
      this.advance();
    }
    this.consumeOptional(";");
  }

  private checkValue(value: string): boolean {
    return this.peek().value === value;
  }

  private checkKind(kind: Token["kind"]): boolean {
    return this.peek().kind === kind;
  }

  private checkIdentifierLike(): boolean {
    const token = this.peek();
    return token.kind === "identifier" || (token.kind === "keyword" && !this.isStructuralKeyword(token.value));
  }

  private isStructuralKeyword(value: string): boolean {
    return [
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
      "if",
      "else",
      "for",
      "while",
      "try",
      "catch",
      "return",
      "throw",
      "const",
      "var"
    ].includes(value);
  }

  private advance(): Token {
    if (!this.isAtEnd()) {
      this.current += 1;
    }
    return this.tokens[this.current - 1] ?? this.tokens[this.tokens.length - 1]!;
  }

  private peek(): Token {
    return this.tokens[this.current] ?? this.tokens[this.tokens.length - 1]!;
  }

  private look(distance: number): Token | undefined {
    return this.tokens[this.current + distance];
  }

  private previous(): Token | undefined {
    return this.tokens[this.current - 1];
  }

  private previousRequired(): Token {
    return this.previous() ?? this.peek();
  }

  private isAtEnd(): boolean {
    return this.peek().kind === "eof";
  }
}

