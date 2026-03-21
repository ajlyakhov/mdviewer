# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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
