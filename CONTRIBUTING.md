# Contributing

For local setup and checks, see [README.md](README.md).

## Pull Figma tokens

Create a Figma personal access token with `file_variables:read` permission and
access to the source design file. Save it in `.env.local` at the repository root:

```sh
FIGMA_VARIABLES_ACCESS_TOKEN="your-token"
```

The file is ignored by Git and loaded automatically by the sync command:

```sh
npm run figma:sync
```

Generated files are written to `figma/`. Review changes with `git diff -- figma`.
