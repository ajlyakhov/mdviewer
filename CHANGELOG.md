# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [3.1.0] - 2026-03-25

### Added

- **Voice input (mic button):** Click the mic icon in the chat input row to start speech-to-text. Live interim transcription appears in the textarea as you speak; click again or pause to stop. Uses Web Speech API — no download required.
- **Voice conversation mode (overlay):** Click the "Voice" button in the model row to open a full-screen voice experience.
  - 32-bar live audio waveform visualizer (Web Audio API AnalyserNode) that reacts to real mic input.
  - Waveform plays a gentle ripple animation while the AI is thinking.
  - Karaoke-style subtitles: user speech appears right-aligned (white), AI response streams in left-aligned (purple) with fade-in animation.
  - Auto-looping conversation: speak → AI responds → listening resumes automatically.
  - Multi-turn context: exchanges are pushed live to chat history so each AI turn has full conversation context.
  - Fallback to non-streaming chat if stream is unavailable.
  - Close with × button or Escape; full conversation is committed to the active chat session.
- **Whisper STT foundation (Phase 2):** IPC infrastructure for fully local, offline transcription via `@xenova/transformers` (`Xenova/whisper-base.en`, ~74 MB). Model is downloaded once and cached in `{userData}/whisper-models/`. Settings toggle UI prepared; renderer integration coming in a follow-up.
- Voice settings section in Settings with STT engine selector (System / Local Whisper).
- `voice.md` — full voice feature documentation, architecture overview, phase roadmap, platform support.

## [2.2.0] - 2026-03-22

### Added

- Knowledgebase embedding provenance per indexed document: backend, model, and embed timestamp.
- LM Studio add-model flow now supports separate selections for response and embedding models.
- LM Studio URL input in model onboarding with auto-access detection and status lamp.
- Inline Knowledgebase import row statuses (`Pending`, `Loading...`, `Imported`, `Skipped`, `Failed`) with placeholder rows for in-flight files.

### Changed

- Knowledgebase embedding backend resolution now follows strict priority:
  - LM Studio (if enabled and embedding model selected/available) -> OpenAI (if enabled) -> MiniLM fallback.
- OpenAI embedding path now degrades to MiniLM on runtime embedding failures.
- Removed global Knowledgebase backend banner in Settings; embedding source is now shown per document row.
- Models settings no longer uses separate API key section; non-local providers use strict check-first wizard.
- All Settings top-level groups (`General`, `Models`, `Knowledgebase`) remain collapsed when opened.

## [2.1.0] - 2026-03-21

### Added

- PDF import from menu and drag-and-drop with conversion to Markdown output files beside the source PDF.
- Import progress UI with page-level progress events and completion notifications.
- KaTeX-based math rendering for markdown and chat responses, including support for inline and display formulas.
- Bracket/delimiter normalization for OCR/LLM math artifacts before markdown rendering.

### Changed

- Dropzone copy now explicitly advertises PDF import behavior.
- PDF parsing now surfaces user-friendly errors for encrypted/corrupt/image-only files.
- Build now includes `pdf-parse`, `katex`, and `marked-katex-extension` dependencies for import/render pipelines.

## [2.0.0] - 2026-03-21

### Added

- Recency-first chat request shaping to prioritize the latest user question over stale thread context.
- Dynamic output token budgeting that scales by effective model context and current prompt size.
- Structured conversation memory (facts, decisions, open threads) to summarize older turns while keeping recent turns verbatim.
- Context-window aware budgeting using model metadata from LM Studio (`loaded context` -> `max context` fallback).
- Debug telemetry for prompt budgeting (`[llm-adapter] prompt-budget`) and stop diagnostics.

### Changed

- Project positioning shifted to AI-first markdown workflow (local docs + context-aware chat) rather than viewer-first.
- Context assembly is now token-budget based instead of count-based message slicing.
- Open document context is now capped and truncated deterministically with `... [truncated]` markers.
- System instruction now explicitly prioritizes answering the latest user message first.
- Output caps are explicitly set per provider (LM Studio/OpenAI/Claude/Google) instead of relying on provider defaults.

### Breaking

- Chat prompt construction behavior changed significantly; long-running conversations now favor recency and compressed memory over full-history inclusion.

## [1.2.0] - 2026-03-21

### Added

- Local images (relative paths in markdown resolve to file, e.g. `![](assets/banner.webp)`)

## [1.1.0] - 2026-03-21

### Added

- External images (HTTPS URLs in markdown)

## [1.0.0] - 2026-03-21

### Added

- Drag & drop Markdown files and folders (recursive)
- Tabbed interface with closeable tabs
- Search within active tab (case-insensitive, cyan highlight)
- Enter / Shift+Enter to jump to next/previous match
- Cmd/Ctrl+F to focus search
- Mermaid diagram support in markdown
- Syntax highlighting for code blocks (via marked-highlight + highlight.js)
- Themes: Light, Dark, System
- File menu: Open File, Open Folder
- Settings: theme selection, set as default .md app (macOS)
- Open .md files via double-click when set as default

### Fixed

- "Object has been destroyed" when opening file from Finder (window lifecycle)
- Code blocks not highlighted (marked v11 requires marked-highlight extension)
