# Recurring work in Gratis

In a chat, open **+ → Scheduled tasks**, or ask the bot: “Every weekday at 9 AM Toronto time, check my calendar and summarize my day here.” The bot creates a saved schedule and reports the next run. Connected-app checks use that bot’s existing Composio connection. No scheduling plugin or new API key is required.

Daily, weekday, weekly and interval schedules are supported. You can inspect the saved instructions, timezone and next run; edit, pause, resume, delete, or run one now. Results appear in the originating chat, with scheduled requests labeled separately from messages you typed. Group schedules follow the primary bot’s normal judgment and explicit mention routing.

Schedules are stored encrypted on this Mac. Gratis must be running and the Mac awake. Closing the window keeps the app running when schedules are enabled; use the Dock to reopen the window. Explicitly quitting Gratis stops execution. On reopening or waking, missed intervals coalesce into one fresh run. This is not an always-on cloud scheduler or a promise to wake a sleeping Mac.

A busy chat defers its scheduled task. Runs never overlap in the same chat. An interrupted or failed run pauses its schedule for review rather than silently replaying uncertain external actions. Existing approval rules still apply, so a task may wait for you before sending messages or making other external changes. The timer is not blanket authorization to send, purchase or delete things. A scheduled task cannot create or edit other schedules.

This uses Gratis’s normal Claude/Codex runtime and local memory. T3 remains a separate option for delegated project work that continues independently of the Gratis window. T3 does not automatically inherit Gratis’s connected apps.

# Group judgment

The first bot in a group is its primary coordinator. It answers routine messages directly and can ask a relevant specialist for a bounded contribution. Specialist findings appear in the chat, followed by a short synthesis from the primary. The coordinator is instructed not to repeat their entire answer.

Type `@` to choose a teammate. `@Name` reaches that bot directly; several mentions reach those named bots. `@everyone` requests every participant. Ordinary greetings do not broadcast. Each bot keeps its own SDK conversation and workspace, while the group shares the visible transcript. Duplicate delegations to the same member in one user turn reuse the existing result.
