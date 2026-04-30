export function extractLeadingDocComment(source: string, declarationLine: number): string | undefined {
  const lines = source.split(/\r?\n/);
  let line = lineBeforeAnnotations(lines, declarationLine - 1);
  if (line < 0) {
    return undefined;
  }
  line = skipBlankLines(lines, line);
  if (line < 0) {
    return undefined;
  }

  const trimmed = (lines[line] ?? "").trim();
  if (trimmed.startsWith("//")) {
    return extractLineComment(lines, line);
  }
  if (trimmed.endsWith("*/")) {
    return extractBlockComment(lines, line);
  }
  return undefined;
}

function lineBeforeAnnotations(lines: readonly string[], startLine: number): number {
  let line = skipBlankLines(lines, startLine);
  while (line >= 0) {
    const trimmed = (lines[line] ?? "").trim();
    if (trimmed === "}" || trimmed.endsWith("}")) {
      const annotationStart = findAnnotationStart(lines, line);
      if (annotationStart === undefined) {
        return line;
      }
      line = skipBlankLines(lines, annotationStart - 1);
      continue;
    }
    if (trimmed.startsWith("annotation")) {
      line = skipBlankLines(lines, line - 1);
      continue;
    }
    return line;
  }
  return line;
}

function findAnnotationStart(lines: readonly string[], endLine: number): number | undefined {
  let balance = 0;
  for (let line = endLine; line >= 0; line -= 1) {
    const text = lines[line] ?? "";
    balance += countOccurrences(text, "}");
    balance -= countOccurrences(text, "{");
    if (/^\s*annotation\b/.test(text)) {
      return line;
    }
  }
  return undefined;
}

function extractLineComment(lines: readonly string[], endLine: number): string | undefined {
  const collected: string[] = [];
  for (let line = endLine; line >= 0; line -= 1) {
    const text = lines[line] ?? "";
    const trimmed = text.trim();
    if (!trimmed.startsWith("//")) {
      break;
    }
    collected.push(trimmed.replace(/^\/\/\/?\s?/, ""));
  }
  return normalizeDocLines(collected.reverse());
}

function extractBlockComment(lines: readonly string[], endLine: number): string | undefined {
  const collected: string[] = [];
  for (let line = endLine; line >= 0; line -= 1) {
    const text = lines[line] ?? "";
    collected.push(text);
    if (text.includes("/*")) {
      break;
    }
  }
  if (!collected[collected.length - 1]?.includes("/*")) {
    return undefined;
  }
  const normalized = collected
    .reverse()
    .map((line) => line
      .replace(/^\s*\/\*\*?/, "")
      .replace(/\*\/\s*$/, "")
      .replace(/^\s*\*\s?/, "")
      .trimEnd());
  return normalizeDocLines(normalized);
}

function normalizeDocLines(lines: readonly string[]): string | undefined {
  const normalized = [...lines];
  while (normalized.length > 0 && normalized[0]?.trim() === "") {
    normalized.shift();
  }
  while (normalized.length > 0 && normalized[normalized.length - 1]?.trim() === "") {
    normalized.pop();
  }
  const text = normalized.join("\n").trim();
  return text.length > 0 ? text : undefined;
}

function skipBlankLines(lines: readonly string[], startLine: number): number {
  let line = startLine;
  while (line >= 0 && (lines[line] ?? "").trim() === "") {
    line -= 1;
  }
  return line;
}

function countOccurrences(text: string, needle: string): number {
  let count = 0;
  let index = text.indexOf(needle);
  while (index !== -1) {
    count += 1;
    index = text.indexOf(needle, index + needle.length);
  }
  return count;
}
