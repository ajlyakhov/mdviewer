# MD Viewer: AI-first Markdown Copilot

MD Viewer is an AI-first, local-first markdown copilot for macOS: open docs, inspect diagrams/code, and chat with an LLM that is optimized to prioritize your latest question.

## Installation

Download the latest release from the [Releases page](https://github.com/ajlyakhov/mdviewer/releases).

### macOS

> **"App is damaged and can't be opened"?**
>
> The app is not yet code-signed. macOS Gatekeeper blocks unsigned apps downloaded from the internet.
> Run this once in Terminal after moving the app to `/Applications`:
> ```bash
> xattr -cr /Applications/MD\ Viewer.app
> ```
> Then open it normally. This removes the quarantine flag — it's safe, and a common step for open-source apps.

### Windows

> **SmartScreen warning?**
>
> Click **More info → Run anyway**. The app is not yet code-signed, so Windows SmartScreen flags it as unknown.
> This will improve once the app builds download reputation over time.

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
- **Voice input** — mic button in chat for quick speech-to-text (Web Speech API)
- **Voice conversation mode** — full-screen overlay with live audio waveform, karaoke-style subtitles, and looping AI dialogue; conversations committed to chat on close
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

## Voice

MD Viewer has two voice input modes:

**Mic button** (quick dictation): In the chat input row, click the mic icon to start recording. Words appear in the textarea live as you speak. Click again or pause to stop.

**Voice conversation mode**: Click the **Voice** button in the model row to open a full-screen voice experience — real-time audio waveform, karaoke subtitles (your words on the right, AI responses on the left), and an automatic speak → respond → listen loop. Close with × or Escape; the whole conversation lands in your active chat session.

See [voice.md](voice.md) for full technical documentation, architecture, and platform support notes.

## Knowledgebase Embedding Logic

Knowledgebase indexing/search embedding backend is resolved with this order:

1. **LM Studio provider enabled**
   - Uses LM Studio only if an embedding model is selected in the LM Studio model config.
   - If no LM Studio embedding model is selected, falls back to MiniLM.
   - If selected LM Studio embedding model is unavailable/unreachable, falls back to MiniLM.
2. **OpenAI provider enabled**
   - Uses OpenAI embeddings (`text-embedding-3-small`).
   - If OpenAI embedding request fails at runtime, falls back to MiniLM.
3. **Fallback**
   - Uses in-app MiniLM (`Xenova/all-MiniLM-L6-v2`).

### LM Studio model setup behavior

- Add Model -> LM Studio now has two independent dropdowns:
  - **Model for responses** (required for chat provider)
  - **Model for embeddings** (optional)
- If LM Studio reports available embedding models, one is preselected automatically.
- User can still explicitly choose MiniLM by selecting the fallback option.
- LM Studio URL defaults to `http://localhost:1234` with accessibility auto-detection.

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

## Privacy Policy

This program will not transfer any information to other networked systems unless specifically requested by the user or the person installing or operating it.

When you configure an AI provider (OpenAI, Anthropic Claude, Google Gemini, LM Studio, or Ollama), chat messages and document context are sent to that provider's API according to their own privacy policies. All provider configuration is done explicitly by the user. No data is collected or transmitted by MD Viewer itself.

## Uninstallation

**macOS:** Drag `MD Viewer.app` from `/Applications` to the Trash. To also remove app data:
```bash
rm -rf ~/Library/Application\ Support/mdviewer
```

**Windows:** Use *Add or Remove Programs* → search for *MD Viewer* → Uninstall.

## Code Signing Policy

Free code signing for Windows is provided by [SignPath.io](https://signpath.io), certificate by [SignPath Foundation](https://signpath.org).

| Role | Members |
|---|---|
| Author & Approver | [@ajlyakhov](https://github.com/ajlyakhov) |
| Reviewers | [Contributors](https://github.com/ajlyakhov/mdviewer/graphs/contributors) |

All releases are built via automated CI (GitHub Actions) directly from this repository. Signing is triggered manually per release by the project owner.


## License

MIT — see [LICENSE](LICENSE).
