# Change Log

## 0.1.4

- Return VS Code definition links instead of bare locations for Go to Definition / Peek Definition.
- Register a matching declaration provider so declaration navigation uses the same FeatureScript resolver.

## 0.1.3

- Add current-file Go to Definition and Find References providers for FeatureScript declarations and references.
- Resolve local functions, features, predicates, types, parameters, local variables, enum members, and `definition.foo` feature parameters.
- Keep map keys, annotation keys, ordinary properties, and standard-library symbols out of local definition jumps.

## 0.1.2

- Improve public GitHub presentation with direct VSIX download instructions, VS Code UI install steps, command-line install steps, verification steps, and source build instructions.
- Add repository and issue metadata to the extension manifest.

## 0.1.1

- Add document symbols and folding ranges so VS Code navigation, Outline, breadcrumbs, and Sticky Scroll can use FeatureScript declaration headers.

## 0.1.0

- Initial local development version with TextMate grammar, semantic token provider, stdlib symbol generation, snippets, and tests.
