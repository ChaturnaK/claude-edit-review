# edit-review

Review Claude's edits in the Claude Code terminal: comment on a line, a range of lines or a whole
file, then send all the comments back to Claude in one prompt.

Claude Code's built-in `/diff` panel shows what changed, but in the terminal you cannot comment on
it. `edit-review` adds a **Review** pane beside it that you can.

```
2 files edited by Claude, 1 comment to send
s: Send 1 comment to Claude  r: Mark all reviewed  e: Expand all
Open a file, then click a line (or press Enter on it) to comment.

▾ src/cart.ts +1 -5 1 comment
Lines 3-9
     3  export function total(items: Item[]): number {
     4 -  let sum = 0
     5 -  for (const item of items) {
     4 +  return items.reduce((sum, item) => sum + item.price * item.qty, 0)
╭─────────────────────────────────────────────────────────╮
│ Line 4 Handle the empty-cart case. [ Edit ] [ Delete ]  │
╰─────────────────────────────────────────────────────────╯
▸ src/format.ts +1 -0
```

## Requirements

- Claude Code in a terminal. Written against version 2.1.295.
- [Fullscreen rendering](https://code.claude.com/docs/en/fullscreen) is recommended: the pane docks
  beside the conversation and diff lines can be clicked. Without it the pane opens above the prompt.

The mod uses Claude Code's function-hooks plugin API, which is early access and can change between
releases.

**Using the desktop app?** You don't need this. Its diff view has line comments built in: open it
with `Cmd+Shift+D`, click a line to comment, and press `Cmd+Enter` to send. There, `edit-review`
only shows a pointer to that view.

## Install

At the prompt of a Claude Code terminal session:

```
/plugin install edit-review --marketplace ChaturnaK/claude-edit-review
```

Answer `y` to add the marketplace, then pick a scope. The mod is active at once, and in every
session started afterwards.

## Usage

1. **Let Claude work.** Every file it edits is collected, and a line appears above the prompt:
   `2 files to review [ Review ]`.
2. **Open the pane.** Press `Review`, or type `/edit-review`. The edited files are listed, folded.
3. **Open a file.** Click it, or move to it and press Enter, to unfold its diff.
4. **Comment.**
   - On a line: click it, or press Enter on it, and type.
   - On a range: with the comment box open, pick a second line in the same hunk.
   - On the file: `comment on whole file`.
   - A saved comment has `Edit` and `Delete`.
5. **Send.** `Send N comments to Claude` submits them as one prompt and clears the review.

| Key | Action |
| --- | --- |
| `s` | Send the comments to Claude |
| `r` | Mark all reviewed: clear the list without sending |
| `e` | Expand or collapse every file |
| `u` | Undo the last send or mark-reviewed |

The keys work while the pane has the keyboard and no comment is being typed. Esc returns to the
prompt.

### What Claude receives

Each comment carries its file, its line numbers and the diff lines it is on:

```
Review comments on your edits — address each one:

/repo/src/cart.ts:4
> +  return items.reduce((sum, item) => sum + item.price * item.qty, 0)
Handle the empty-cart case.

/repo/src/format.ts (whole file)
Add a test.
```

## What it tracks

- Edits made with Claude's `Edit` and `Write` tools, and files changed by its shell commands.
- Only edits made in the current session, after the mod loaded. It does not read `git diff`, so it
  works outside a git repository too.
- A long diff is shown 500 lines at a time, with `next` and `previous` controls, so every line can
  be reached and commented on. Only an edit beyond 50,000 diff lines is cut, and the pane says so.
- A file edited several times lists each edit's hunks in order (`edit 1`, `edit 2`), with line
  numbers as of that edit. The quoted diff lines in a comment are what anchor it.

Not included: accepting or rejecting hunks, notebook edits, and comments that outlive the session.

## Development

```
claude --plugin-dir /path/to/claude-edit-review   # load from disk; reloads on save
claude plugin validate .
claude plugin test .
```

| File | What it holds |
| --- | --- |
| `hooks/register.tsx` | The hooks module: edit capture, the pane, the band above the prompt |
| `types/index.d.ts` | The `$.state` contract |
| `hooks/review.test.ts` | Capture → comment → send, and shell-edit capture |
| `.claude-plugin/` | The plugin manifest and the marketplace entry that makes it installable |

Issues and pull requests are welcome.

## License

[MIT](LICENSE)
