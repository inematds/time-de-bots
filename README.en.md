# Time de Bots — your bots on your computer and on a VPS, through your subscription

[![Time de Bots](guia/assets/banner-en.jpg)](https://inematds.github.io/time-de-bots/guia/en/)

**🇧🇷 [Português](README.md) · 🇺🇸 [English](README.en.md) · 🇪🇸 [Español](README.es.md)**

## What it is

Time de Bots ("Team of Bots" in Portuguese) is a free INEMA kit that installs a bot dashboard on your Linux or
Mac computer, or on a VPS. Each bot has a name, avatar, role, memory and scheduled tasks, and you chat with them
one at a time or in a group (`@bot`). The replies come from **your subscription** to Claude or Codex, through the
normal login of the official program, with no API key and no pay-per-use billing. You can have several separate
teams on the same machine. You need Node.js 22+ and a Claude account or a ChatGPT account with Codex.

## 📖 User guide

Full guide (landing + step by step): **https://inematds.github.io/time-de-bots/guia/en/**

## What's in here

| Folder | What it is |
|---|---|
| `app/` | The bot app (Electron, MIT license, see `app/LICENSE`). We only changed the visible name: [`kit/MUDANCAS-NO-APP.md`](kit/MUDANCAS-NO-APP.md) (in Portuguese) |
| `kit/instalar.sh` | Checks Node/npm, installs dependencies, downloads the app files and runs the 193 tests |
| `kit/iniciar.sh` | Opens the app; `--instancia <nome>` creates another separate team; removes any API key from the environment |
| `kit/scripts/conferir-resposta.mjs` | Proves the reply is real through the subscription (not demo mode) and saves it in `kit/verificacao/` |
| `kit/vps/` | Server mode: virtual screen + browser access **only through an SSH tunnel**, a service that starts on its own, several instances |
| `kit/prompts/` | Ready-made requests for Claude Code or Codex to install and check it for you (in Portuguese) |

## Three ways to use it

| Where | For whom | How to open |
|---|---|---|
| **On your computer** (Linux or Mac) | those who want the bots at hand | `kit/iniciar.sh` |
| **Another team on the same machine** | separating personal and work, or one team per client | `kit/iniciar.sh --instancia trabalho` |
| **On a VPS** | bots and scheduled tasks running 24/7, reachable from anywhere | `kit/vps/nova-instancia.sh principal 1` + SSH tunnel |

## The process, from start to finish

Who does it: 🧠 you in a session with the assistant · ⚙️ kit script · 🤖 agent/model.

| # | Step | Command / file | Who |
|---|---|---|---|
| 1 | Download the kit | `git clone https://github.com/inematds/time-de-bots.git && cd time-de-bots` | 🧠 |
| 2 | Install and test (193 tests) | `kit/instalar.sh` | ⚙️ |
| 3 | Log in to your account (once, in the terminal) | `claude` or `codex login` | 🧠 |
| 4 | Check a real reply through the subscription | `node kit/scripts/conferir-resposta.mjs` | ⚙️ |
| 5 | Open the app | `kit/iniciar.sh` | ⚙️ |
| 6 | In Settings → AI subscription, choose Claude or Codex and create the first bot | in the app | 🧠 |
| 7 | (Optional) another separate team | `kit/iniciar.sh --instancia trabalho` | ⚙️ |
| 8 | (VPS) prepare the server, with a regular user that has sudo | `kit/vps/instalar-vps.sh` | ⚙️ |
| 9 | (VPS) log in to the account over SSH | `claude` or `codex login --device-auth` | 🧠 |
| 10 | (VPS) start an instance | `kit/vps/nova-instancia.sh principal 1` | ⚙️ |
| 11 | (VPS) open it in the browser through the tunnel | `ssh -N -L 6081:127.0.0.1:6081 usuario@servidor` → `http://localhost:6081/vnc.html` | 🧠 |
| 12 | Rather have the assistant do 2–11 for you | [`kit/prompts/`](kit/prompts/) (in Portuguese) | 🤖 |

## What was tested (November 9, 2026)

| Test | Result |
|---|---|
| App tests (`npm test`) on Linux ARM64 | 193 of 193 |
| App tests on an Ubuntu 24.04 x86_64 VPS (4 vCPU, 15 GB) | 193 of 193 |
| Real reply through the Claude subscription (haiku model) | received in 3.8 s, `claude.ai` login |
| Two instances at the same time on the computer | open, separate data |
| Two instances as a service on the VPS | active, ports only on 127.0.0.1 |
| Real reply on the VPS, Codex, voice, cloud browser, Composio | **not tested** |

## Cautions

- **Subscription only.** The app only accepts the Claude Code `claude.ai` login or the Codex login. `kit/iniciar.sh`
  removes `ANTHROPIC_API_KEY`/`OPENAI_API_KEY` from the environment so nothing gets billed through the API without you noticing.
- **Limits still apply.** The subscription has usage limits and the provider's terms; the dashboard doesn't raise them.
- **The login is yours.** Never paste a token or password into the assistant's chat; you do the login yourself in the terminal.
- **Closed VPS.** Nothing is left open to the internet: VNC and the browser listen only on 127.0.0.1, you get in through an SSH tunnel.
- **Experimental software**, no warranty. Test first with a throwaway instance and back up
  `~/.local/share/time-de-bots/` before updating.
- On Linux, the Electron sandbox needs a tweak with sudo: [`kit/COMO-LIGAR-SANDBOX.md`](kit/COMO-LIGAR-SANDBOX.md) (in Portuguese).

## License

INEMA kit, guide and prompts: [MIT](LICENSE). The app in `app/` has its own MIT license and third-party notices
(`app/LICENSE`, `app/THIRD_PARTY_NOTICES.md`), kept as the license requires.

---

Made by [INEMA.CLUB](https://inema.club).
