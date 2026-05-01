import * as vscode from "vscode";
import type { FeatureScriptParseCache } from "./parseCache";
import { completionDataAtOffset } from "./completionData";
import type { FeatureField, StdlibEnumMember } from "./stdlibMetadata";

export class FeatureScriptCompletionProvider implements vscode.CompletionItemProvider {
  constructor(private readonly cache: FeatureScriptParseCache) {}

  provideCompletionItems(
    document: vscode.TextDocument,
    position: vscode.Position,
    cancellationToken: vscode.CancellationToken
  ): vscode.ProviderResult<vscode.CompletionItem[]> {
    if (cancellationToken.isCancellationRequested) {
      return undefined;
    }
    const parsed = this.cache.get(document);
    const source = document.getText();
    const data = completionDataAtOffset(parsed, source, document.offsetAt(position));
    if (!data || cancellationToken.isCancellationRequested) {
      return undefined;
    }

    const range = rangeFromOffsets(document, data.replacementStart, data.replacementEnd);
    if (data.kind === "enumMember") {
      return data.members.map((member) => enumMemberItem(member, data.enumName, range));
    }
    return data.fields.map((field) => featureFieldItem(field, data.featureName, range));
  }
}

function enumMemberItem(member: StdlibEnumMember, enumName: string, range: vscode.Range): vscode.CompletionItem {
  const item = new vscode.CompletionItem(member.name, vscode.CompletionItemKind.EnumMember);
  item.insertText = member.name;
  item.range = range;
  item.detail = `${enumName} enum member`;
  item.sortText = `0_${member.name}`;
  const markdown = new vscode.MarkdownString(undefined, true);
  markdown.isTrusted = false;
  markdown.appendCodeblock(`${enumName}.${member.name}`, "featurescript");
  if (member.doc) {
    markdown.appendMarkdown("\n\n");
    markdown.appendText(member.doc);
  }
  if (member.module) {
    markdown.appendMarkdown("\n\n");
    markdown.appendText(`Module: ${member.module}`);
  }
  item.documentation = markdown;
  return item;
}

function featureFieldItem(field: FeatureField, featureName: string, range: vscode.Range): vscode.CompletionItem {
  const label = field.name;
  const item = new vscode.CompletionItem(label, vscode.CompletionItemKind.Field);
  item.insertText = new vscode.SnippetString(`"${field.name}" : $0`);
  item.range = range;
  item.detail = field.type ? `${featureName} field: ${field.type}` : `${featureName} field`;
  item.sortText = `0_${field.name}`;
  item.documentation = featureFieldMarkdown(field, featureName);
  return item;
}

function featureFieldMarkdown(field: FeatureField, featureName: string): vscode.MarkdownString {
  const markdown = new vscode.MarkdownString(undefined, true);
  markdown.isTrusted = false;
  markdown.appendCodeblock(`"${field.name}" : ${field.type ?? "value"}`, "featurescript");
  const details: string[] = [];
  if (field.label) {
    details.push(`Label: ${field.label}`);
  }
  if (field.required !== undefined) {
    details.push(`Required: ${field.required ? "yes" : "no"}`);
  }
  if (field.condition) {
    details.push(`Condition: ${field.condition}`);
  }
  if (field.defaultValue) {
    details.push(`Default: ${field.defaultValue}`);
  }
  if (field.predicate) {
    details.push(`From predicate: ${field.predicate}`);
  }
  details.push(`Feature: ${featureName}`);
  if (details.length > 0) {
    markdown.appendMarkdown("\n\n");
    markdown.appendText(details.join("\n"));
  }
  if (field.description) {
    markdown.appendMarkdown("\n\n");
    markdown.appendText(field.description);
  }
  return markdown;
}

function rangeFromOffsets(document: vscode.TextDocument, start: number, end: number): vscode.Range {
  return new vscode.Range(document.positionAt(start), document.positionAt(end));
}
