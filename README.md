# MD Viewer

Electron app for viewing Markdown files with Mermaid diagram support on macOS.

## Features

- Drag & drop files or folders (recursive)
- Open files via menu (File → Open File / Open Folder)
- Set as default app for `.md` files (Settings)
- Tabbed interface (closeable tabs)
- Search within active tab (case-insensitive, highlights matches)
- Mermaid diagrams in markdown
- External images (HTTPS URLs in markdown)
- Themes: Light, Dark, System
- Syntax highlighting for code blocks

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
