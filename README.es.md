# Time de Bots — tus bots en la computadora y en la VPS, con tu suscripción

[![Time de Bots](guia/assets/banner-es.jpg)](https://inematds.github.io/time-de-bots/guia/es/)

**🇧🇷 [Português](README.md) · 🇺🇸 [English](README.en.md) · 🇪🇸 [Español](README.es.md)**

## Qué es

Time de Bots ("Equipo de Bots" en portugués) es un kit gratuito de INEMA que instala un panel de bots en tu
computadora Linux o Mac, o en una VPS. Cada bot tiene nombre, avatar, rol, memoria y tareas programadas, y
conversan solos o en grupo (`@bot`). Las respuestas vienen de **tu suscripción** de Claude o de Codex, con el
login normal del programa oficial, sin clave de API y sin cobro por uso. Puedes tener varios equipos separados
en la misma máquina. Necesitas Node.js 22+ y una cuenta de Claude o de ChatGPT con Codex.

## 📖 Guía de uso

Guía completa (landing + paso a paso): **https://inematds.github.io/time-de-bots/guia/es/**

## Qué hay aquí

| Carpeta | Qué es |
|---|---|
| `app/` | La app de bots (Electron, licencia MIT, ver `app/LICENSE`). Solo cambiamos el nombre visible: [`kit/MUDANCAS-NO-APP.md`](kit/MUDANCAS-NO-APP.md) (en portugués) |
| `kit/instalar.sh` | Verifica Node/npm, instala dependencias, descarga los archivos de la app y corre las 193 pruebas |
| `kit/iniciar.sh` | Abre la app; `--instancia <nombre>` crea otro equipo separado; quita cualquier clave de API del entorno |
| `kit/scripts/conferir-resposta.mjs` | Prueba que la respuesta es real con la suscripción (no modo demostración) y la guarda en `kit/verificacao/` |
| `kit/vps/` | Modo servidor: pantalla virtual + acceso desde el navegador **solo por túnel SSH**, servicio que arranca solo, varias instancias |
| `kit/prompts/` | Pedidos listos para que Claude Code o Codex instalen y verifiquen por ti (en portugués) |

## Tres formas de usarlo

| Dónde | Para quién | Cómo se abre |
|---|---|---|
| **En tu computadora** (Linux o Mac) | quien quiere los bots a mano | `kit/iniciar.sh` |
| **Otro equipo en la misma máquina** | separar lo personal del trabajo, o un equipo por cliente | `kit/iniciar.sh --instancia trabalho` |
| **En una VPS** | bots y tareas programadas encendidos 24 h, accesibles desde cualquier lugar | `kit/vps/nova-instancia.sh principal 1` + túnel SSH |

## El proceso, de principio a fin

Quién lo hace: 🧠 tú en una sesión con el asistente · ⚙️ script del kit · 🤖 agente/modelo.

| # | Paso | Comando / archivo | Quién |
|---|---|---|---|
| 1 | Descargar el kit | `git clone https://github.com/inematds/time-de-bots.git && cd time-de-bots` | 🧠 |
| 2 | Instalar y probar (193 pruebas) | `kit/instalar.sh` | ⚙️ |
| 3 | Entrar a tu cuenta (una vez, en la terminal) | `claude` o `codex login` | 🧠 |
| 4 | Verificar una respuesta real con la suscripción | `node kit/scripts/conferir-resposta.mjs` | ⚙️ |
| 5 | Abrir la app | `kit/iniciar.sh` | ⚙️ |
| 6 | En Settings → AI subscription, elegir Claude o Codex y crear el primer bot | en la app | 🧠 |
| 7 | (Opcional) otro equipo separado | `kit/iniciar.sh --instancia trabalho` | ⚙️ |
| 8 | (VPS) preparar el servidor, con un usuario común que tenga sudo | `kit/vps/instalar-vps.sh` | ⚙️ |
| 9 | (VPS) entrar a la cuenta por SSH | `claude` o `codex login --device-auth` | 🧠 |
| 10 | (VPS) encender una instancia | `kit/vps/nova-instancia.sh principal 1` | ⚙️ |
| 11 | (VPS) abrir desde el navegador vía túnel | `ssh -N -L 6081:127.0.0.1:6081 usuario@servidor` → `http://localhost:6081/vnc.html` | 🧠 |
| 12 | Preferir que el asistente haga 2–11 por ti | [`kit/prompts/`](kit/prompts/) (en portugués) | 🤖 |

## Lo que se probó (09/11/2026)

| Prueba | Resultado |
|---|---|
| Pruebas de la app (`npm test`) en Linux ARM64 | 193 de 193 |
| Pruebas de la app en una VPS Ubuntu 24.04 x86_64 (4 vCPU, 15 GB) | 193 de 193 |
| Respuesta real con la suscripción de Claude (modelo haiku) | recibida en 3,8 s, login `claude.ai` |
| Dos instancias al mismo tiempo en la computadora | abiertas, datos separados |
| Dos instancias como servicio en la VPS | activas, puertos solo en 127.0.0.1 |
| Respuesta real en la VPS, Codex, voz, navegador en la nube, Composio | **no probados** |

## Precauciones

- **Solo suscripción.** La app solo acepta el login `claude.ai` de Claude Code o el login de Codex. El `kit/iniciar.sh`
  quita `ANTHROPIC_API_KEY`/`OPENAI_API_KEY` del entorno para que nada vaya a cobro por API sin que lo veas.
- **Los límites siguen.** La suscripción tiene límites de uso y términos del proveedor; el panel no los aumenta.
- **El login es tuyo.** Nunca pegues token ni contraseña en el chat del asistente; el login lo haces tú en la terminal.
- **VPS cerrada.** Nada queda abierto a internet: VNC y navegador escuchan solo en 127.0.0.1, entras por túnel SSH.
- **Software experimental**, sin garantía. Prueba primero con una instancia desechable y haz un respaldo de
  `~/.local/share/time-de-bots/` antes de actualizar.
- En Linux, el sandbox de Electron necesita un ajuste con sudo: [`kit/COMO-LIGAR-SANDBOX.md`](kit/COMO-LIGAR-SANDBOX.md) (en portugués).

## Licencia

Kit, guía y prompts de INEMA: [MIT](LICENSE). La app en `app/` tiene su propia licencia MIT y avisos de terceros
(`app/LICENSE`, `app/THIRD_PARTY_NOTICES.md`), mantenidos como la licencia lo pide.

---

Hecho por [INEMA.CLUB](https://inema.club).
