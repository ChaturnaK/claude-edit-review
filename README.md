# edit-review

A Claude Code mod that adds a **Review** pane: see the files Claude edited, comment on a line, a
range of lines or a whole file, and send all the comments back to Claude in one prompt. The same
idea as the review flow in Cursor, inside Claude Code.

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
╭──────────────────────────────────────────────╮
│ Line 4  Handle the empty-cart case.  Delete  │
╰──────────────────────────────────────────────╯
▸ src/format.ts +1 -0
```

## Install

At the prompt of a Claude Code terminal session:

```
/plugin install edit-review --marketplace ChaturnaK/claude-edit-review
```

Answer `y` to add the marketplace, then pick a scope. The mod is active at once, and in every
session started afterwards. Installed at the user scope it also loads in the desktop app's Code tab.

It uses Claude Code's function-hooks plugin API, which is early access and can change between
releases. Written against Claude Code 2.1.295.

## Use

1. Let Claude work. Every file it edits is collected, and a line appears above the prompt:
   `2 files to review [ Review ]`.
2. Press `Review`, or type `/edit-review`. The pane lists the edited files, folded.
3. Open a file (click it, or move to it and press Enter) to see its diff.
4. Click a diff line, or press Enter on it, and type a comment. Pick a second line in the same hunk
   while the comment box is open to cover the range between them. `comment on whole file` comments
   on the file. A saved comment has `Edit` and `Delete`.
5. `Send N comments to Claude` submits them as one prompt and clears the review.

| Key | Action |
| --- | --- |
| `s` | Send the comments to Claude |
| `r` | Mark all reviewed (clears the list without sending) |
| `e` | Expand or collapse every file |
| `u` | Undo the last send or mark-reviewed |

The keys work while the pane has the keyboard and no comment is being typed. Esc returns to the
prompt.

What Claude receives:

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
- Only edits made in the current session, after the mod loaded. It does not read `git diff`.
- A file edited several times lists each edit's hunks in order (`edit 1`, `edit 2`); line numbers
  are as of that edit. The quoted diff lines in a comment are what anchor it.

Not included: accepting or rejecting hunks, notebook edits, and comments that outlive the session.

In the desktop app the diff is drawn by Claude Code's own diff view, which has no clickable lines,
so each hunk has a `Comment on line` picker instead.

## Develop

```
claude --plugin-dir /path/to/claude-edit-review   # load from disk, reloads on save
claude plugin validate .
claude plugin test .
```

- `hooks/register.tsx` — the hooks module: edit capture, the pane, the band above the prompt.
- `types/index.d.ts` — the `$.state` contract.
- `hooks/review.test.ts` — capture → comment → send, on the terminal and desktop surfaces.
