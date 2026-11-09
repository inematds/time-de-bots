# Development

```sh
npm ci
npm run check
npm run setup:assets
npm run test:desktop
```

`npm test` uses isolated temporary workspaces and mocked providers. It must not contact real mailboxes or spend provider usage. The desktop smoke test uses synthetic conversations, demonstrates key controls, and produces the documentation screenshots. It never opens your personal app profile.

`npm run verify:public` checks tracked files for accidental runtime data, unsupported bundled assets and obvious secret/path patterns. Run a dedicated secret scanner before publication as well; neither check proves the absence of every kind of sensitive information.

On macOS Apple Silicon, build a local unsigned app with:

```sh
npm run setup:assets
npm run package:mac
```

Output goes under `release/`. This is not a notarized distribution pipeline. Signing credentials, release notarization and any update service are deployment responsibilities and must stay outside Git.

## Editing the runtime

Add tool definitions in `src/agent-tools.mjs`. Keep IPC privilege checks in the main process. Test changes to group routing, queues, approvals and recovery with isolated fixtures. When adding a stored field, consider startup compatibility and what export can expose.

Use `edition.json` for edition-specific identity. Keep shared behavior in the core and community content in the separate overlay. Do not add a private endpoint, user transcript, production fixture, access token or machine-specific path as a default.

## Cloud service checks

```sh
cd packages/cloud
npm ci
npm run typecheck
npx vitest run
```

These checks generate local type declarations and use test doubles. Deploy only to an account you control, after configuring the authentication secrets and reviewing expected costs.
