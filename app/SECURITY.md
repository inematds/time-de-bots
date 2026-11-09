# Security

Please do not put credentials, private chat exports or real account traces in a public issue. Use GitHub's private vulnerability reporting for a security report when it is enabled; otherwise open a minimal issue asking for a private contact channel without publishing exploit details or secrets.

The app intentionally separates renderer privileges, per-bot files and optional external execution. These boundaries need ongoing review. Model output, retrieved text, websites and memory are untrusted content. A remembered preference is not permission to perform an external action.

Before sharing a build or repository:

- Scan the full Git history for secrets, not only the working tree.
- Confirm the profile starts empty and no account is preconnected.
- Use generated test data for screenshots and examples.
- Preserve required third-party license notices.
- Confirm the cloud environment, if present, belongs to the installer.

Runtime data, downloaded binaries, model weights, signing keys and `.env` files are excluded by default. Exclusions are not a substitute for inspecting tracked files before pushing.
