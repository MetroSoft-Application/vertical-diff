# Vertical Diff Panel

Vertical Diff Panel is a VS Code extension that mirrors the active diff editor into the bottom panel.
It renders the original side on top and the modified side below, with aligned rows, change highlighting, and hunk navigation.

## Features

- Follows the active text diff editor
- Shows the original side on top and the modified side below
- Highlights insertions, deletions, and replacements
- Keeps both panes vertically aligned so scroll sync stays predictable
- Provides toolbar commands for next and previous hunk

## Usage

1. Install dependencies and build the extension.
2. Start an Extension Development Host.
3. Open any text diff in the development host.
4. The Vertical Diff panel is revealed automatically when a diff becomes active.
5. Use the view toolbar or command palette to jump to the previous or next hunk.

Manual command:

- `Vertical Diff: Show Vertical Diff`

## Current Scope

- Read-only rendering in a panel webview
- Line-level diff highlighting
- Basic syntax highlighting for common text formats
- Scroll synchronization between the two panes

## Known Limitations

- This does not embed VS Code's native diff editor inside the panel
- Auto reveal depends on VS Code view-container commands and may briefly focus the panel when it opens for the first time
- Rendering falls back to a placeholder for very large or unsupported inputs
- Inline character diff is not implemented yet

## Settings

- `verticalDiff.followActiveDiff`: keeps the panel synchronized with the active diff editor
- `verticalDiff.autoReveal`: opens the panel automatically when a diff becomes active
- `verticalDiff.maxFileSizeKB`: per-side render limit in kilobytes
- `verticalDiff.maxRenderedLines`: maximum aligned rows that will be rendered in the panel

## Development

```bash
npm install
npm run build
```

Then launch an Extension Development Host from VS Code and open any diff editor.