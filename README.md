# MD Viewer: AI-first Markdown Copilot

MD Viewer is an AI-first, local-first markdown copilot for macOS: open docs, inspect diagrams/code, and chat with an LLM that is optimized to prioritize your latest question.

## Objective

MD Viewer is no longer just a markdown renderer. The core goal is reliable AI-assisted reasoning over local markdown context with predictable behavior in long chats:

- keep latest user intent first
- prevent silent context-window degradation
- keep answers relevant when history grows
- make prompt-budget behavior observable and debuggable

## Features

- AI-first chat with local document context
- Recency-first context selection (latest turn pinned)
- Structured memory summarization for older turns
- Adaptive output token budgeting per request
- Prompt-budget debug telemetry for troubleshooting
- Drag & drop files or folders (recursive)
- Drag & drop PDF files for automatic PDF -> Markdown import
- Open files via menu (File → Open File / Open Folder)
- Import PDF via menu (File -> Import PDF...)
- Math rendering via KaTeX in documents and AI chat
- Set as default app for `.md` files (Settings)
- Tabbed interface (closeable tabs)
- Search within active tab (case-insensitive, highlights matches)
- Mermaid diagrams in markdown
- External images (HTTPS URLs)
- Local images (relative paths resolve to file, e.g. `![](assets/banner.webp)`)
- Themes: Light, Dark, System
- Syntax highlighting for code blocks

## LLM Context Strategy (v2)

The chat pipeline now uses a recency-first, token-budgeted strategy so the model stays focused on your latest question even in long threads.

- **Effective context window source**
  - Uses selected model metadata from LM Studio.
  - Priority: `loaded context_length` -> `max_context_length` -> safe default.
  - This value drives all budget calculations.

- **Input/output budgeting**
  - Request budget is computed as:
    - `inputBudget = effectiveContext - outputBudget - safetyMargin`
  - Output budget is adaptive per request:
    - starts from context-aware baseline
    - scales up using real headroom from estimated prompt size
    - bounded by a hard safety cap relative to context window

- **Recency-first message selection**
  - The latest user message is always retained.
  - Older turns are included from most recent backwards until budget is reached.
  - Oldest turns are dropped first when needed.

- **Conversation summarization**
  - Older dropped turns are compressed into structured memory:
    - facts
    - decisions
    - open threads
  - Recent turns remain verbatim for local coherence.

- **Document context shaping**
  - Open file context is prioritized and size-capped.
  - Per-document and total-doc limits are applied.
  - Truncated docs include a deterministic `... [truncated]` marker.

- **Provider request behavior**
  - Explicit output caps are set for LM Studio, OpenAI, Claude, and Google requests.
  - This avoids hidden provider defaults causing unexpected truncation behavior.

- **Debug observability**
  - Enable with:
    - `MDVIEWER_DEBUG_PROMPT=1 npm start`
  - Logs include:
    - effective context window
    - output budget
    - estimated prompt tokens
    - dropped/truncated counts

## Usage

```bash
npm install
npm start
```

## Keyboard Shortcuts

| Shortcut | Action |
|----------|--------|
| Cmd/Ctrl+F | Focus search |
| Cmd/Ctrl+O | Open file |
| Cmd/Ctrl+Shift+O | Open folder |
| Cmd/Ctrl+, | Settings |
| Enter (in search) | Next match |
| Shift+Enter (in search) | Previous match |
| Escape (in search) | Clear & close |

## Build

```bash
npm run build
```

Produces DMG and ZIP in `dist/`.

## License

MIT — see [LICENSE](LICENSE).
