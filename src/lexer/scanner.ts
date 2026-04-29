import { keywords, type Token } from "./tokens";

const multiCharOperators = [
  "?[]",
  "??=",
  "||=",
  "&&=",
  "?.",
  "?[",
  "::",
  "=>",
  "->",
  "<=",
  ">=",
  "==",
  "!=",
  "+=",
  "-=",
  "*=",
  "/=",
  "^=",
  "%=",
  "~=",
  "??",
  "&&",
  "||",
  "++",
  "--"
];

const singleCharOperators = new Set(["+", "-", "*", "/", "%", "^", "~", "<", ">", "!", "=", "?", ":"]);
const punctuation = new Set(["{", "}", "(", ")", "[", "]", ",", ";", "."]);

export function scan(source: string): Token[] {
  const scanner = new Scanner(source);
  return scanner.scan();
}

class Scanner {
  private index = 0;
  private line = 0;
  private character = 0;
  private readonly tokens: Token[] = [];

  constructor(private readonly source: string) {}

  scan(): Token[] {
    while (!this.isAtEnd()) {
      this.scanToken();
    }
    this.tokens.push(this.makeToken("eof", "", this.index, this.line, this.character));
    return this.tokens;
  }

  private scanToken(): void {
    const char = this.peek();
    if (char === " " || char === "\t" || char === "\r") {
      this.advance();
      return;
    }
    if (char === "\n") {
      this.advance();
      return;
    }
    if (char === "/" && this.peek(1) === "/") {
      this.skipLineComment();
      return;
    }
    if (char === "/" && this.peek(1) === "*") {
      this.skipBlockComment();
      return;
    }
    if (char === "\"" || char === "'") {
      this.scanString(char);
      return;
    }
    if (this.isDigit(char) || (char === "." && this.isDigit(this.peek(1)))) {
      if (char === "." && !this.isDigit(this.peek(1))) {
        this.addFixed("punctuation", ".");
      } else {
        this.scanNumber();
      }
      return;
    }
    if (char === "@" && this.isIdentifierStart(this.peek(1))) {
      this.scanIdentifier(true);
      return;
    }
    if (this.isIdentifierStart(char)) {
      this.scanIdentifier(false);
      return;
    }
    for (const op of multiCharOperators) {
      if (this.source.startsWith(op, this.index)) {
        this.addFixed(op === "++" || op === "--" ? "invalid" : "operator", op);
        return;
      }
    }
    if (singleCharOperators.has(char)) {
      this.addFixed("operator", char);
      return;
    }
    if (punctuation.has(char)) {
      this.addFixed("punctuation", char);
      return;
    }
    this.addFixed("invalid", char);
  }

  private skipLineComment(): void {
    while (!this.isAtEnd() && this.peek() !== "\n") {
      this.advance();
    }
  }

  private skipBlockComment(): void {
    this.advance();
    this.advance();
    while (!this.isAtEnd()) {
      if (this.peek() === "*" && this.peek(1) === "/") {
        this.advance();
        this.advance();
        return;
      }
      this.advance();
    }
  }

  private scanString(quote: string): void {
    const start = this.index;
    const line = this.line;
    const character = this.character;
    this.advance();
    while (!this.isAtEnd()) {
      const char = this.peek();
      if (char === "\\") {
        this.advance();
        if (!this.isAtEnd()) {
          this.advance();
        }
        continue;
      }
      if (char === quote) {
        this.advance();
        this.tokens.push(this.makeToken("string", this.source.slice(start, this.index), start, line, character));
        return;
      }
      this.advance();
    }
    this.tokens.push(this.makeToken("string", this.source.slice(start, this.index), start, line, character));
  }

  private scanNumber(): void {
    const start = this.index;
    const line = this.line;
    const character = this.character;

    if (this.peek() === ".") {
      this.advance();
    }
    while (this.isDigit(this.peek())) {
      this.advance();
    }
    if (this.peek() === "." && this.isDigit(this.peek(1))) {
      this.advance();
      while (this.isDigit(this.peek())) {
        this.advance();
      }
    } else if (this.peek() === ".") {
      this.advance();
    }
    if ((this.peek() === "e" || this.peek() === "E") && (this.isDigit(this.peek(1)) || ((this.peek(1) === "+" || this.peek(1) === "-") && this.isDigit(this.peek(2))))) {
      this.advance();
      if (this.peek() === "+" || this.peek() === "-") {
        this.advance();
      }
      while (this.isDigit(this.peek())) {
        this.advance();
      }
    }

    this.tokens.push(this.makeToken("number", this.source.slice(start, this.index), start, line, character));
  }

  private scanIdentifier(runtimeReserved: boolean): void {
    const start = this.index;
    const line = this.line;
    const character = this.character;
    if (runtimeReserved) {
      this.advance();
    }
    this.advance();
    while (this.isIdentifierPart(this.peek())) {
      this.advance();
    }
    const value = this.source.slice(start, this.index);
    const bare = runtimeReserved ? value.slice(1) : value;
    const kind = runtimeReserved ? "atIdentifier" : keywords.has(bare) ? "keyword" : "identifier";
    this.tokens.push(this.makeToken(kind, value, start, line, character));
  }

  private addFixed(kind: Token["kind"], value: string): void {
    const start = this.index;
    const line = this.line;
    const character = this.character;
    for (let i = 0; i < value.length; i += 1) {
      this.advance();
    }
    this.tokens.push(this.makeToken(kind, value, start, line, character));
  }

  private makeToken(kind: Token["kind"], value: string, offset: number, line: number, character: number): Token {
    return {
      kind,
      value,
      offset,
      end: this.index,
      line,
      character,
      endLine: this.line,
      endCharacter: this.character
    };
  }

  private advance(): string {
    const char = this.source[this.index] ?? "\0";
    this.index += 1;
    if (char === "\n") {
      this.line += 1;
      this.character = 0;
    } else {
      this.character += 1;
    }
    return char;
  }

  private peek(distance = 0): string {
    return this.source[this.index + distance] ?? "\0";
  }

  private isAtEnd(): boolean {
    return this.index >= this.source.length;
  }

  private isIdentifierStart(char: string): boolean {
    return (char >= "A" && char <= "Z") || (char >= "a" && char <= "z") || char === "_";
  }

  private isIdentifierPart(char: string): boolean {
    return this.isIdentifierStart(char) || this.isDigit(char);
  }

  private isDigit(char: string): boolean {
    return char >= "0" && char <= "9";
  }
}

