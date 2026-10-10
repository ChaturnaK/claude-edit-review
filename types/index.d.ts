/** One diff hunk; `lines` carry their ' ', '+' or '-' marker. `edit` is which edit of the file made it (1-based). */
export type Hunk = { edit: number; oldStart: number; newStart: number; lines: string[] }

/** `cut`: diff lines of this file's edits that were too many to keep. */
export type FileEdit = { path: string; edits: number; hunks: Hunk[]; cut?: number }

/** Rows `from`..`to` (inclusive) of hunk `h` in the file's `hunks`. */
export type Anchor = { h: number; from: number; to: number }

/** No `at`: a comment on the whole file. `id`: the saved comment being edited, not a new one. */
export type Draft = { path: string; at?: Anchor; id?: number }

export type Comment = Draft & { id: number; label: string; quote: string[]; text: string }

declare module 'claude-code' {
  interface PluginState {
    'edit-review': {
      files: FileEdit[]
      comments: Comment[]
      draft: Draft | null
      /** The paths of the files whose diff is unfolded; every file starts folded. */
      expanded: string[]
      /** What the last Submit or Mark reviewed cleared, kept so it can be undone. */
      last: { files: FileEdit[]; comments: Comment[] } | null
    }
  }
}
