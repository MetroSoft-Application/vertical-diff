# Vertical Diff

Shows the active VS Code diff in a stacked panel.

## Features

- Original on top, modified below
- Aligned rows for easier comparison
- Line and inline change highlighting
- Optional whitespace markers for spaces and tabs
- Follows the active diff automatically while the panel is open
- Move to the previous or next change
- Set the same number of context rows before and after each change
- Placeholder view for large or unsupported content

## Usage

![demo](./resources/demo.gif)

### Show the panel

1. Open a diff.
2. Run **"Vertical Diff: Show Vertical Diff"** or open the **Vertical Diff** panel view.

### Move between changes

1. Open a diff.
2. Show the Vertical Diff panel.
3. Use the toolbar or run **"Vertical Diff: Previous Change"** and **"Vertical Diff: Next Change"**.

## Requirements

- Visual Studio Code 1.85.0 or later
- An active text diff

## Settings

- `verticalDiff.fontSize`: Panel font size. Set `0` to follow `editor.fontSize`.
- `verticalDiff.contextRows`: Number of unchanged rows shown both before and after each change. Defaults to `0`. Enter it in the field beside the previous and next change buttons.
- `verticalDiff.renderWhitespace`: Shows spaces as `·` and tabs as `→` in the panel. Enabled by default.

## Notes

- Read-only panel view
- The panel does not open automatically when you switch to a diff
- Large or unsupported content is shown as a placeholder

## License

Licensed under MIT
