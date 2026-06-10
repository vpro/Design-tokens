# Design tokens

The package contains the existing design tokens in `tokens/` and generated
native Figma Variable tokens in `figma/`.

## Usage Flow

The repository has two responsibilities:

1. Fetch Figma Variables and generate one file per collection mode.
2. Publish `tokens/` and `figma/` when a feature branch is merged into `main`.

Consumers such as `villa-tokens` then select the files they need:

```text
figma/primitives.json
  + figma/brands/vpro.json
  + figma/devices/mobile.json
  + figma/surfaces/primary.json
  -> consumer-specific output
```

The consumer is responsible for responsive sizing, sub-brand structure,
typography shorthands, surface nesting, and other application semantics.

## Local Sync

Start from an up-to-date feature branch:

```sh
git switch main
git pull --ff-only
git switch -c chore/sync-figma-variables

nvm use
npm ci
```

Create a local `.env.local` once:

```sh
FIGMA_VARIABLES_ACCESS_TOKEN="your-token"
```

The file is ignored by Git. Run the importer without passing the token
manually:

```sh
npm run figma:sync
```

The command validates the response and atomically updates:

```text
figma/
  primitives.json
  brands/
    vpro.json
  devices/
    mobile.json
    desktop.json
  surfaces/
    primary.json
```

Tokens use `$value`, `$type`, optional `$description`, structured color values,
and `{token.path}` references. Collection names are top-level namespaces so
independently selected mode files can be composed without path collisions.

Figma `COLOR`, `FLOAT`, and font-family strings map to `color`, `number`, and
`fontFamily` tokens. Other strings and booleans remain `string` and `boolean`
tokens.

Review and verify the result:

```sh
git status --short
git diff -- figma
npm test
npm run typecheck
npm pack --dry-run
```

Commit and push the generated files:

```sh
git add figma
git commit -m "chore: sync Figma variables"
git push -u origin chore/sync-figma-variables
```

Open a pull request and merge it into `main`. The existing main workflow bumps
the patch version, creates the tag, and publishes the npm package.

## GitHub Actions Sync

The same sync can run without a local Figma token:

1. Create and push a feature branch.
2. Open **Actions -> Sync Figma variables -> Run workflow**.
3. Select the feature branch.
4. Wait for the workflow to commit and push changed `figma/` files.
5. Review and merge the feature branch.

The workflow intentionally refuses to run on `main`. It uses the repository
secret `FIGMA_VARIABLES_ACCESS_TOKEN` and does nothing when Figma is unchanged.
