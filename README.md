# FeatureScript Language Support

FeatureScript Language Support adds TextMate syntax highlighting and semantic highlighting for Onshape FeatureScript in VS Code.

The extension uses VS Code's normal language architecture: a TextMate grammar provides immediate highlighting, then a TypeScript semantic token provider refines symbols that require language context such as `defineFeature` declarations, enum members, annotation keys, map keys, standard-library calls, and namespace access. It does not scrape, de-minify, or depend on Onshape web app internals. Onshape documents that Feature Studios are based on Ace, but Ace behavior is treated only as a visual parity reference.

## File Association

Files ending in `.featurescript` are associated automatically.

Files ending in `.fs` are not globally claimed because `.fs` is used by other languages. FeatureScript `.fs` files are detected when the first line is a FeatureScript version header:

```featurescript
FeatureScript 2909;
```

For a FeatureScript workspace where all `.fs` files should use this extension, add an opt-in association:

```json
{
  "files.associations": {
    "*.fs": "featurescript"
  }
}
```

## Highlighting

The TextMate layer covers comments, strings, escapes, numbers, literals, keywords, operators, punctuation, common standard-library names, and invalid `++` / `--` operators.

The semantic layer adds context-aware classifications for:

- custom features created with `defineFeature`
- functions, predicates, operator overloads, enums, enum members, custom types, parameters, const/var symbols, and assignments
- annotation keys and map keys
- properties such as `definition.width`
- `Namespace::symbol` namespace prefixes
- generated standard-library functions, predicates, types, enums, enum members, constants, and units

Semantic highlighting is enabled by default for `featurescript`.

## Standard Library Index

The generated standard-library index is committed at `src/generated/stdlibSymbols.json` and is used at extension runtime without network access.

Refresh it during development with:

```bash
npm run update:stdlib
```

The generator prefers the local repo cache at `../reference/fsdoc/library.latest.html` and `../onshape-std-library-mirror`. If those are unavailable, it can fetch `https://cad.onshape.com/FsDoc/library.html` while generating the committed JSON.

Imports from `onshape/std/geometry.fs` expose the full generated table. Imports from `onshape/std/common.fs` currently expose the same table; module-level narrowing is a known future improvement.

## Development

```bash
npm install
npm run compile
npm run build:grammar
npm test
```

Tests cover TextMate scopes, parser recovery/construct recognition, and VS Code semantic tokens.

## Known Limitations

- This is a highlighting-focused extension, not a full LSP.
- It does not perform full type checking, formatting, refactoring, Onshape API sync, or Feature Studio commit/push/pull.
- The parser is tolerant and intentionally partial; it is designed to recover while editing and to identify enough structure for highlighting.
- Standard-library import precision is intentionally broad for `common.fs` in this first version.

