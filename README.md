# FeatureScript Language Support

FeatureScript Language Support adds syntax highlighting, semantic highlighting, snippets, document symbols, folding support, current-file Go to Definition / Find References, and hover tooltips for Onshape FeatureScript in VS Code.

This extension is currently distributed as a GitHub Release `.vsix` file, not through the VS Code Marketplace.

## Install

### Option 1: Install From The VSIX In VS Code

1. Open the latest release:
   [FeatureScript Language Support releases](https://github.com/gatrall/featurescript-language-support/releases/latest)
2. In the release page, open **Assets** if it is collapsed.
3. Download the file ending in `.vsix`, for example:
   [featurescript-language-support-0.1.5.vsix](https://github.com/gatrall/featurescript-language-support/releases/latest/download/featurescript-language-support-0.1.5.vsix)
4. Open VS Code.
5. Open the Extensions view.
6. Select the `...` menu in the Extensions view.
7. Select **Install from VSIX...**.
8. Choose the downloaded `.vsix` file.
9. Reload VS Code if prompted.

Do not download the GitHub **Source code** zip/tarball unless you want to build the extension yourself. VS Code installs the `.vsix` file.

### Option 2: Install From The Command Line

After downloading the `.vsix` file:

```sh
code --install-extension featurescript-language-support-0.1.5.vsix
```

If `code` is not available in your terminal, use the VS Code menu command **Shell Command: Install 'code' command in PATH**, then open a new terminal.

## Verify It Is Working

1. Open a FeatureScript file.
2. Check the lower-right VS Code status bar. It should say **FeatureScript**.
3. Open the Command Palette and run **Developer: Inspect Editor Tokens and Scopes**.
4. Click on FeatureScript code such as `defineFeature`, `annotation`, or `definition.width`. You should see FeatureScript TextMate scopes and semantic token information.

If a file is not detected as FeatureScript, run **Change Language Mode** from the Command Palette and choose **FeatureScript**.

## File Association

Files ending in `.featurescript` are associated automatically.

Files ending in `.fs` are not globally claimed because `.fs` is used by other languages. FeatureScript `.fs` files are detected when the first line is a FeatureScript version header:

```featurescript
FeatureScript 2909;
```

For a FeatureScript workspace where all `.fs` files should use this extension, add this file:

`.vscode/settings.json`

```json
{
  "files.associations": {
    "*.fs": "featurescript"
  }
}
```

You can also set this through VS Code settings by searching for **Files: Associations** and adding `*.fs` -> `featurescript`.

## Features

- TextMate syntax highlighting for comments, strings, escapes, numbers, literals, keywords, operators, punctuation, standard-library names, and invalid `++` / `--` operators.
- Semantic highlighting for custom features, functions, predicates, operator overloads, enums, enum members, custom types, parameters, variables, assignments, annotation keys, map keys, properties, namespaces, and standard-library symbols.
- Snippets for common FeatureScript headers, `defineFeature`, annotations, preconditions, enums, operation calls, predicates, and operator overloads.
- Document symbols, breadcrumbs, Outline view, and folding ranges for navigation and VS Code Sticky Scroll.
- Current-file Go to Definition and Find References for local declarations, parameters, top-level symbols, enum members, and `definition.foo` feature parameters.
- Hover tooltips for local declaration doc comments and generated standard-library signatures.
- Generated standard-library symbol index committed in the extension; no network access is required at runtime.

The extension uses VS Code's normal language architecture: a TextMate grammar provides immediate highlighting, then a TypeScript semantic token provider refines symbols that require language context such as `defineFeature` declarations, enum members, annotation keys, map keys, standard-library calls, and namespace access. It does not scrape, de-minify, or depend on Onshape web app internals.

## Build From Source

```sh
git clone https://github.com/gatrall/featurescript-language-support.git
cd featurescript-language-support
npm install
npm run compile
npm run build:grammar
npm test
```

Package a local `.vsix`:

```sh
npx @vscode/vsce package --allow-missing-repository --no-dependencies
```

Install the locally built package:

```sh
code --install-extension featurescript-language-support-0.1.5.vsix
```

## Standard Library Index

The generated standard-library index is committed at `src/generated/stdlibSymbols.json` and is used at extension runtime without network access.

Refresh it during development with:

```sh
npm run update:stdlib
```

The generator prefers the local repo cache at `../reference/fsdoc/library.latest.html` and `../onshape-std-library-mirror`. If those are unavailable, it can fetch `https://cad.onshape.com/FsDoc/library.html` while generating the committed JSON.

Imports from `onshape/std/geometry.fs` expose the full generated table. Imports from `onshape/std/common.fs` currently expose the same table; module-level narrowing is a known future improvement.

## Known Limitations

- This is a highlighting-focused extension, not a full LSP.
- Go to Definition and Find References are current-file only; workspace-wide references are a planned future language-service feature.
- Hover tooltips use local leading `//`, `///`, `/* ... */`, or `/** ... */` comments and stdlib signatures; full rendered FsDoc prose is not bundled yet.
- It does not perform full type checking, formatting, refactoring, Onshape API sync, or Feature Studio commit/push/pull.
- The parser is tolerant and intentionally partial; it is designed to recover while editing and to identify enough structure for highlighting.
- Standard-library import precision is intentionally broad for `common.fs` in this first version.

## Support

Open an issue on [gatrall/featurescript-language-support](https://github.com/gatrall/featurescript-language-support/issues) with a small FeatureScript sample and a screenshot or description of the highlighting problem.
