# Figma Variables Sync Plan

## Goal

Fetch native Figma Variables and publish deterministic token files alongside
the existing `tokens/` source.

```text
Figma API -> validated collection mode files -> npm package
```

## Source

- Figma file key: `Td0HFPqpgpMrGTHBeu4acX`
- Endpoint: `GET /v1/files/Td0HFPqpgpMrGTHBeu4acX/variables/local`
- Secret: `FIGMA_VARIABLES_ACCESS_TOKEN`

Only local collections and variables are exported. Local aliases must resolve
to another exported variable.

## Contract

Generated files follow the native collection modes:

```text
figma/
  primitives.json
  brands/*.json
  devices/*.json
  surfaces/*.json
```

Collections remain top-level namespaces. Colors become structured sRGB values,
floats remain unitless numbers, aliases become token-path references, and
strings and booleans retain their values. File names and token paths are
deterministic.

The sync does not infer responsive behavior, typography shorthands, brand
composition, surface nesting, or other consumer-specific semantics.

## Delivery

- `npm run figma:sync` validates and atomically updates `figma/`.
- The manual workflow runs on a feature branch and commits changed files.
- Merging to `main` uses the existing version bump and publish workflow.
- The npm package publishes `tokens/` and `figma/`, not build tooling.
- Consumers select and combine primitive, brand, device, and surface files.

## Verification

1. Run the sync twice and confirm the second run is unchanged.
2. Load representative file combinations in Style Dictionary.
3. Run `npm test`.
4. Run `npm run typecheck`.
5. Run `npm pack --dry-run`.
