# Privacy and data flow

The repository contains source code and synthetic examples. It does not contain a user's chat history, account configuration, memory database, avatar photos or production screenshots.

When you run the app, conversations and files are stored locally. Conversation JSON and bot files are plaintext on disk. Connection credentials, the memory vault, schedules and saved T3 dispatch metadata use Electron's platform-backed secure storage. The protection available depends on the operating system and user session.

A live provider receives the conversation content and context needed to answer, including selected file contents, relevant memories and tool results. Composio receives requests for enabled integrations. A configured cloud browser and T3 environment receive the instructions and data necessary for their respective work. Those services have their own retention, access and privacy policies.

Voice recording is transcribed by local Whisper. When enabled and available, transcript text is sent to Claude Haiku for punctuation cleanup. Original audio is not sent to Haiku by this implementation.

The optional asset setup script downloads public model and CLI artifacts. The app does not include a custom analytics or telemetry service, but provider SDKs and connected services may perform their own network requests. This document does not make claims about those services' internal behavior.

Use the app's memory controls to inspect and remove learned context. Treat exports, screenshots and local backups as potentially sensitive. Do not attach production workspaces or decrypted credentials to issues.
