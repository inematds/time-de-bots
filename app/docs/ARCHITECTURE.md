# Architecture

```text
Electron renderer
    │ narrow, validated IPC API
Electron main process
    ├─ ChatService → provider SDK adapter
    ├─ TeamCoordinator → isolated teammate conversations
    ├─ Schedules → persisted recurring dispatch
    ├─ MemoryService → local vault and optional embedding worker
    ├─ WorkspaceFiles → bot-scoped local files
    ├─ Connections → encrypted provider/service configuration
    ├─ CloudComputer → optional user-hosted browser backend
    └─ T3Tasks → optional external T3 MCP environment
```

`src/main.cjs` owns privileged operations. `src/preload.cjs` exposes a constrained API to a sandboxed renderer. Node integration is disabled in the page, and requests are checked against the expected main frame. HTML rendering is sanitized.

`src/chat-service.mjs` persists local conversation state and coordinates streaming, cancellation, queues and retries. Provider adapters use separate bot instructions and app-owned tool definitions. Personal configuration is not copied into the repository.

`src/team-coordinator.mjs` manages shared group context with separate child sessions and file workspaces. `src/group-routing.mjs` deterministically handles explicit mentions; the primary model decides whether ordinary requests need delegation.

`src/schedules.mjs` persists encrypted schedule definitions and dispatch records before starting work. It prevents overlapping work in the same chat, coalesces missed periods, and pauses uncertain outcomes for review. Scheduling currently belongs to the desktop process, not a cloud cron service.

The memory vault, connection secrets, schedules and T3 dispatch metadata use the platform-backed encryption interface. Conversation JSON and files are local plaintext; do not describe the whole workspace as encrypted. Backups and exports need the user's own storage protections.

`packages/cloud` is an optional service deployment. It has its own authentication boundary, execution environment and billing. No deployment is provisioned by cloning or starting the desktop. T3 is also independent; its work is not stopped simply because the desktop window closes.

## Editions

`edition.json` controls the visible app name, data folder and bundle identity. The core and community builds have separate identities and storage. They do not migrate data from another edition. A community repository can pin this core and overlay a distinct edition configuration and assets without copying private history into either Git repository.
