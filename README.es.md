<p align="center">
  <img src="assets/icon-256.png" width="72" height="72" alt="Logo de Turnwise: una T hecha con cinco bloques del diffstat">
</p>

<h1 align="center">Turnwise</h1>

<p align="center">
  <b>Un agente de código de escritorio, open source, en el que cada turno termina con un recibo.</b><br>
  Revisa lo que cambió el agente o deshaz el turno entero. Usa cualquier endpoint compatible con OpenAI o con Anthropic.
</p>

<p align="center">
  <a href="https://github.com/codavidgarcia/turnwise/actions/workflows/ci.yml"><img src="https://github.com/codavidgarcia/turnwise/actions/workflows/ci.yml/badge.svg" alt="CI"></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/licencia-MIT-24658c" alt="Licencia MIT"></a>
  <img src="https://img.shields.io/badge/plataforma-Windows%2010%2F11-56626b" alt="Windows 10/11">
  <a href="README.md"><img src="https://img.shields.io/badge/read-in%20English-56626b" alt="Read in English"></a>
</p>

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="docs/screenshots/turn-receipts-dark.png">
  <img src="docs/screenshots/turn-receipts-light.png" alt="Turnwise: dos turnos de una conversación, cada uno cerrado por un recibo con bloques de diffstat, +57 −8, los ficheros tocados, la duración y las acciones Revisar y Deshacer turno">
</picture>

Turnwise es la base de un harness de agente de escritorio al estilo de Codex: Electron y TypeScript, unas 4.800 líneas de código sin framework de UI, y una prueba por capa. Haz un fork para construir tu propia app de agente, o úsalo tal cual con los modelos que ya pagas.

## Por qué turnos

Casi todas las interfaces de agentes son un chat. Turnwise trata el **turno** como la unidad de trabajo: tu pedido, los pasos que dio el agente y los ficheros que cambió. Cada turno que tocó ficheros se cierra con un recibo:

- **Bloques de diffstat** con la proporción real de añadido y eliminado, `+N −M`, los nombres de los ficheros y lo que tardó el turno.
- **Revisar** abre el diff con números de línea, fichero a fichero.
- **Deshacer turno** restaura todos los ficheros que tocó el turno. Es compare-and-swap: si editaste un fichero después, Turnwise se niega en lugar de pisar tu trabajo.

Los pasos se leen como un registro de trabajo («Leyó `src/core/llm.ts`», «Ejecutando `npm run selftest`»), agrupados y plegables. Los permisos se piden en el propio paso que los necesita.

## Qué incluye

| | |
|---|---|
| **Bucle del agente** | Streaming SSE con llamadas a herramientas, incluidos argumentos troceados y UTF-8 multibyte partido entre chunks de red. Herramientas: `read_file`, `write_file`, `edit_file`, `list_files`, `search_files` (ripgrep), `run_shell`, `manage_tasks`, `list_skills`, `load_skill`, más las de cualquier servidor MCP. |
| **Dos protocolos** | Chat Completions de OpenAI y Messages API de Anthropic, los dos con streaming y herramientas, detrás de una sola interfaz `ChatModel`. La lista de modelos sale del `GET /models` del endpoint. |
| **Modos de permiso** | Solo lectura · Preguntar antes de cada escritura o comando (por defecto) · Sin confirmación. Se aplican donde se ejecutan las herramientas, no en la interfaz. |
| **Proyectos y conversaciones** | Abre cualquier carpeta (Ctrl O). Cada conversación trabaja en la carpeta de su proyecto y se conserva al reiniciar. Búsqueda con Ctrl K. |
| **Panel de revisión** | Diff con números de línea y deshacer por fichero, el plan del agente y fuentes web vía tu instancia de SearXNG. |
| **Compactación de contexto** | Cuando la historia crece, los turnos antiguos se resumen y la interfaz marca dónde. |
| **Skills** | Carpetas con un `SKILL.md` que el agente carga cuando las necesita. Hay dos en `skills/`. |
| **Extras** | Cliente MCP (stdio y Streamable HTTP), adjuntos tratados como texto no fiable, worktrees de git, Windows Sandbox y empaquetado MSIX experimental. |

## Capturas

| | |
|---|---|
| ![Un turno en vivo: el tercer paso falló, el agente lo reintentó y un comando espera permiso](docs/screenshots/live-turn-approval.png) | ![El panel de revisión con los ficheros por turno y el diff con números de línea](docs/screenshots/review-diff.png) |
| **Turno en vivo.** La edición fallida sigue visible y el comando espera tu permiso en su paso. La barra superior dice «Esperando permiso». | **Revisión.** Ficheros agrupados por turno, el diff con números de línea y deshacer por fichero. |
| ![El menú de modelo con búsqueda y el endpoint en el pie](docs/screenshots/model-picker.png) | ![Configuración: protocolo, URL base, clave cifrada y Probar conexión](docs/screenshots/endpoint-settings.png) |
| **Menú de modelo.** Se llena desde el endpoint, tiene búsqueda y un atajo para cambiar de endpoint. | **Endpoint.** Eliges el protocolo, pegas la URL base y la clave, y pruebas antes de guardar. |

## Empezar

Requisitos: **Windows 10 u 11** y **Node.js 22 o superior**.

```bash
git clone https://github.com/codavidgarcia/turnwise.git
cd turnwise
npm install
npm start
```

Abre **Configuración** abajo a la izquierda, elige el protocolo, pega la URL base y tu clave, y pulsa **Probar conexión**. La clave se cifra con DPAPI de Windows (`safeStorage` de Electron) y nunca vuelve a la interfaz: solo se muestran sus cuatro últimos caracteres.

¿Prefieres un fichero? Copia `.env.example` a `.env`:

```ini
OPENAI_BASE_URL=https://api.openai.com/v1
OPENAI_API_KEY=sk-...
OPENAI_MODEL=gpt-4.1
# TURNWISE_PROVIDER=anthropic   # para endpoints compatibles con Anthropic
```

### Endpoints

Sirve cualquier servicio que hable uno de los dos protocolos. La URL base incluye `/v1`.

| Servicio | Protocolo | URL base | Verificado |
|---|---|---|---|
| [OpenCode Go](https://opencode.ai) | OpenAI y Anthropic | `https://opencode.ai/zen/go/v1` | ✅ de punta a punta, los dos protocolos |
| OpenAI | OpenAI | `https://api.openai.com/v1` | todavía no |
| Anthropic | Anthropic | `https://api.anthropic.com/v1` | todavía no |
| OpenRouter | OpenAI | `https://openrouter.ai/api/v1` | todavía no |
| Ollama (local) | OpenAI | `http://localhost:11434/v1` | todavía no |
| LM Studio (local) | OpenAI | `http://localhost:1234/v1` | todavía no |

«Todavía no» significa que nadie ha pasado la batería de punta a punta contra ese servicio. Si lo haces, [abre un issue](https://github.com/codavidgarcia/turnwise/issues/new/choose) con el resultado y se actualiza la fila.

Las variables de entorno, la arquitectura y la batería de pruebas están en el [README en inglés](README.md#architecture).

## Estado y límites

Turnwise está en la v0.2: su autor lo usa a diario, pero es joven en todo lo demás.

- **Interfaz solo en español.** Lo primero del roadmap es la versión en inglés.
- **Windows primero.** La barra de título, el MSIX y Windows Sandbox son de Windows. macOS y Linux no se han probado nunca.
- **El chip de esfuerzo todavía no se envía al modelo.** Algunos endpoints rechazan `reasoning_effort`, así que hace falta decidirlo por modelo.
- **No hay binarios publicados.** El MSIX no está firmado; por ahora se compila desde el código.

## Contribuir

Lee [CONTRIBUTING.md](CONTRIBUTING.md). Los textos de la interfaz siguen la voz de [DESIGN-DNA.md](DESIGN-DNA.md): verbos en pasado para lo hecho y acciones nombradas por su resultado.

## Agradecimientos

Inspirado en la app de Codex de OpenAI y en la app de escritorio de Claude Code. Turnwise es un proyecto independiente, sin relación con OpenAI ni con Anthropic ni respaldado por ellas.

## Licencia

[MIT](LICENSE). Las fuentes empaquetadas usan la SIL Open Font License; sus licencias van junto a los ficheros de fuente.
