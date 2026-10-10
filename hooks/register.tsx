import { atom, read, update } from 'claude-code'
import type { Register, StateDollar } from 'claude-code'

import type { Comment, Draft, FileEdit, Hunk } from '../types'

const PANE = 'review'
const OPEN = { id: PANE, title: 'Review', focus: true, columns: 100 } as const
// A file's diff is drawn a page of rows at a time: the engine draws about 100,000 characters of a
// pane, so a long diff is paged through, never cut.
const PAGE = 500
// ponytail: two open files' pages fit; with more open, the rest waits until one is folded.
const MAX_ROWS = 2 * PAGE
// ponytail: an edit keeps its first 2000 diff lines in session state and counts the rest in `cut`,
// so a generated file cannot bloat every later write. Upgrade: keep long diffs in $.store, by file.
const MAX_KEPT = 2000

const files = atom({ plugin: 'edit-review', key: 'files' } as const, [])
const comments = atom({ plugin: 'edit-review', key: 'comments' } as const, [])
const draft = atom({ plugin: 'edit-review', key: 'draft' } as const, null)
const last = atom({ plugin: 'edit-review', key: 'last' } as const, null)
const expanded = atom({ plugin: 'edit-review', key: 'expanded' } as const, [])
const page = atom({ plugin: 'edit-review', key: 'page' } as const, {})

// The comment being typed. Not in $.state: a write there redraws the pane on every key.
let typed = ''

type Patch = { oldStart: number; newStart: number; lines: string[] }
type Edited = {
  filePath: string
  structuredPatch: Patch[]
  staged?: boolean
  type?: 'create' | 'update'
  content?: string
}

function toHunks(edited: Edited): Patch[] {
  if (edited.structuredPatch.length > 0) return edited.structuredPatch
  if (edited.type === 'create' && edited.content) {
    const lines = edited.content.replace(/\n$/, '').split('\n')

    return [{ oldStart: 0, newStart: 1, lines: lines.map(line => `+${line}`) }]
  }

  return []
}

// ponytail: each edit's hunks are kept as made, so a later edit to the same file can shift an
// earlier hunk's line numbers. Upgrade: diff the first originalFile against the file as it is now.
function add(list: readonly FileEdit[], edited: Edited): FileEdit[] {
  const old = list.find(file => file.path === edited.filePath)
  const edit = (old?.edits ?? 0) + 1
  let room = MAX_KEPT
  let cut = old?.cut ?? 0
  const hunks = toHunks(edited).flatMap(({ oldStart, newStart, lines }) => {
    const kept = lines.slice(0, room)
    room -= kept.length
    cut += lines.length - kept.length

    return kept.length > 0 ? [{ edit, oldStart, newStart, lines: kept }] : []
  })
  const file = { path: edited.filePath, edits: edit, cut, hunks: [...(old?.hunks ?? []), ...hunks] }

  return old ? list.map(one => (one === old ? file : one)) : [...list, file]
}

/** Records the edits of one tool call in one write. Observes only: a failure here stays here. */
async function record($: StateDollar, edits: readonly Edited[]) {
  try {
    const made = edits.filter(edited => !edited.staged)
    if (made.length > 0) await update($, files, list => made.reduce(add, list))
  } catch {}
}

/** Each row's line number: the old file's for a removed line, the new file's otherwise. */
function numbers(hunk: Hunk): number[] {
  let before = hunk.oldStart
  let after = hunk.newStart

  return hunk.lines.map(line => {
    if (line[0] === '-') return before++
    if (line[0] !== '+') before++

    return after++
  })
}

/** The line numbers rows `from`..`to` of a hunk cover: `12`, or `12-14`. */
function span(hunk: Hunk, from: number, to: number): string {
  const rows = numbers(hunk).slice(from, to + 1)
  const first = Math.min(...rows)
  const last = Math.max(...rows)

  return first === last ? `${first}` : `${first}-${last}`
}

function toComment(list: readonly FileEdit[], open: Draft, id: number, text: string): Comment {
  const { at } = open
  const hunk = at && list.find(file => file.path === open.path)?.hunks[at.h]
  if (!at || !hunk) return { ...open, id, text, label: '', quote: [] }

  return {
    ...open,
    id,
    text,
    label: span(hunk, at.from, at.to),
    quote: hunk.lines.slice(at.from, at.to + 1),
  }
}

/** The prompt Submit sends: each comment as its place, the diff lines it is on, then the comment. */
export function formatReview(notes: readonly Comment[]): string {
  const blocks = notes.map(note => {
    const place = note.label ? `${note.path}:${note.label}` : `${note.path} (whole file)`

    return [place, ...note.quote.map(line => `> ${line}`), note.text].join('\n')
  })

  return ['Review comments on your edits — address each one:', ...blocks].join('\n\n')
}

const clean = (text: string) => text.replace(/\t/g, '  ').replace(/[\x00-\x1f\x7f]/g, '')
const short = (path: string) => path.split('/').slice(-2).join('/')
const count = (file: FileEdit, mark: string) =>
  file.hunks.reduce((sum, hunk) => sum + hunk.lines.filter(line => line[0] === mark).length, 0)
const size = (file: FileEdit) => file.hunks.reduce((rows, hunk) => rows + hunk.lines.length, 0)
const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`

/** Empties the review, keeping what it held in `last` for Undo. */
async function clear($: StateDollar) {
  typed = ''
  const kept = { files: await read($, files), comments: await read($, comments) }
  await update($, last, () => kept)
  await update($, files, () => [])
  await update($, comments, () => [])
  await update($, draft, () => null)
}

/** Puts back what the last clear took, beside any edits made since. */
async function restore($: StateDollar) {
  const kept = await read($, last)
  if (kept === null) return
  await update($, last, () => null)
  await update($, files, now => [
    ...kept.files.filter(file => !now.some(one => one.path === file.path)),
    ...now,
  ])
  await update($, comments, now => [...kept.comments, ...now])
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'edit-review',
      description: "Review Claude's edits, comment on them and send the comments back",
    })

    return next(e)
  })

  on('command.run', { command: 'edit-review' }, async $ => {
    const opened = await $.ui.open(OPEN)

    return { text: opened.isPlaced ? 'Review pane opened.' : `Review pane is waiting: ${opened.reason}` }
  })

  // The three capture hooks only observe: the tool's own answer goes back unchanged.
  on('tool.call', { tool: 'Edit' }, async ($, e, next) => {
    const ran = await next(e)
    if (ran.deny === undefined && ran.isError !== true) await record($, [ran.result])

    return ran
  }).catch(($, e, next) => next(e))

  on('tool.call', { tool: 'Write' }, async ($, e, next) => {
    const ran = await next(e)
    if (ran.deny === undefined && ran.isError !== true) await record($, [ran.result])

    return ran
  }).catch(($, e, next) => next(e))

  // What a shell command changed (sed, a formatter, a generator) is Claude's edit too.
  on('tool.call', { tool: 'Bash' }, async ($, e, next) => {
    const ran = await next(e)
    if (ran.deny === undefined && ran.isError !== true) {
      const changed = (ran.result.bashEditDiff?.files ?? []).filter(file => file.hunks.length > 0)
      await record(
        $,
        changed.map(file => ({ filePath: file.filePath, structuredPatch: file.hunks })),
      )
    }

    return ran
  }).catch(($, e, next) => next(e))

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const list = await read($, files)
    if (e.surface !== 'terminal' || e.props.hasSurvey || list.length === 0) return next(e)
    const notes = await read($, comments)
    const { Box, Button, Text } = $.ui.resolve(e)

    return (
      <Box>
        <Text dimColor>
          {plural(list.length, 'file')} to review
          {notes.length > 0 ? `, ${plural(notes.length, 'comment')}` : ''}{' '}
        </Text>
        <Button key="review" label="Review" onPress={() => $.ui.open(OPEN)} />
      </Box>
    )
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const ui = $.ui.resolve(e)
    const { Box, Button, Text } = ui

    // The desktop app has this built in, and better: its diff view takes a comment on any line.
    if (e.surface !== 'terminal' || !('Input' in ui)) {
      return (
        <Box>
          <Text dimColor>edit-review is for the terminal. Here, use the built-in diff view.</Text>
        </Box>
      )
    }

    const { Input } = ui
    const list = await read($, files)
    const notes = await read($, comments)
    const open = await read($, draft)
    const kept = await read($, last)
    const cwd = await $.session.cwd().catch(() => '')
    const columns = Math.max(24, e.props.bodyColumns)
    // A letter presses its action while the pane has the keys, so none is armed while a comment
    // is being typed.
    const keyed = (hotkey: string) => (open === null ? { hotkey } : {})
    const fit = (text: string, room: number) =>
      text.length > room ? `${text.slice(0, Math.max(1, room - 1))}…` : text
    // A path as the project knows it, its tail kept when the pane is narrow.
    const named = (path: string, room: number) => {
      const name = cwd !== '' && path.startsWith(`${cwd}/`) ? path.slice(cwd.length + 1) : short(path)

      return name.length > room ? `…${name.slice(1 - room)}` : name
    }
    const undo = kept !== null && kept.files.length > 0 && (
      <Button
        key="undo"
        plain
        {...keyed('u')}
        label={`Undo: bring back ${plural(kept.files.length, 'file')}`}
        onPress={() => restore($)}
      />
    )

    if (list.length === 0) {
      return (
        <Box flexDirection="column">
          <Text bold>Nothing to review</Text>
          <Text dimColor>Files Claude edits in this session are listed here.</Text>
          {undo}
        </Box>
      )
    }

    const unfolded = await read($, expanded)
    const isEveryOpen = list.every(file => unfolded.includes(file.path))
    const pages = await read($, page)
    // The rows the unfolded files want drawn: a page of each.
    const total = list
      .filter(file => unfolded.includes(file.path))
      .reduce((sum, file) => sum + Math.min(PAGE, size(file) - Math.min(pages[file.path] ?? 0, size(file))), 0)
    let room = MAX_ROWS

    const begin = async (next: Draft) => {
      await update($, draft, () => next)
      await $.ui.focus({ requestId: PANE, key: 'draft' }).catch(() => undefined)
    }

    // A second line picked in the hunk the open comment is on widens it to the range between.
    const pick = (path: string, index: number, l: number) => {
      const widened = open?.path === path && open.at?.h === index ? open : undefined
      const at = widened?.at

      return begin({
        // A comment being edited stays the one being edited when its range is widened.
        ...(widened?.id !== undefined ? { id: widened.id } : {}),
        path,
        at: { h: index, from: Math.min(at?.from ?? l, l), to: Math.max(at?.to ?? l, l) },
      })
    }

    const save = async (value: string) => {
      const text = value.trim()
      const saved = await read($, draft)
      typed = ''
      await update($, draft, () => null)
      if (saved === null || text === '') return
      const now = await read($, files)
      const { id } = saved
      await update($, comments, all =>
        id === undefined
          ? [...all, toComment(now, saved, 1 + Math.max(0, ...all.map(note => note.id)), text)]
          : all.map(note => (note.id === id ? toComment(now, saved, id, text) : note)),
      )
    }

    // The field opens where the comment is, holding its text; an empty save leaves it as it was.
    const revise = (note: Comment) => {
      typed = note.text

      return begin({ id: note.id, path: note.path, ...(note.at ? { at: note.at } : {}) })
    }

    const submit = async () => {
      const sending = await read($, comments)
      if (sending.length === 0) return
      await clear($)
      void $.ui.close({ id: PANE }).catch(() => undefined)
      const sent = await $.prompt
        .submit({ text: formatReview(sending), asUser: true })
        .catch(() => undefined)
      if (sent === undefined || sent.drop !== undefined) {
        // Not sent: put the review back rather than lose the comments.
        await restore($)
        $.ui.toast('edit-review: the comments were not sent and are kept.')
      } else {
        // Sent: an Undo brings the diffs back, not the comments Claude already has.
        await update($, last, was => was && { ...was, comments: [] })
      }
    }

    const field = (where: string) => (
      <Box flexDirection="column" borderStyle="round" borderColor="warning" paddingX={1}>
        <Text bold color="warning">
          {open?.id === undefined ? where : `Editing · ${where}`}
        </Text>
        <Box gap={1}>
          <Input
            key="draft"
            placeholder="Add a comment, Enter to save"
            value={typed}
            submitLabel="save"
            autoFocus
            onInput={value => {
              typed = value
            }}
            onSubmit={save}
          />
          <Button key="cancel" label="Cancel" onPress={() => save('')} />
        </Box>
      </Box>
    )

    // The comment being edited is drawn as the field, not as its card.
    const drawn = (note: Comment) =>
      open?.id === note.id ? null : (
        <Box borderStyle="round" borderColor="warning" paddingX={1} columnGap={1} flexWrap="wrap">
          <Text bold color="warning">
            {note.label ? `Line ${note.label}` : 'File'}
          </Text>
          <Text>{clean(note.text)}</Text>
          <Button key={`edit:${note.id}`} label="Edit" onPress={() => revise(note)} />
          <Button
            key={`del:${note.id}`}
            label="Delete"
            onPress={() => update($, comments, all => all.filter(one => one.id !== note.id))}
          />
        </Box>
      )

    // Draws the part of each hunk that lies on the file's page, rows `from` on.
    const hunkOf = (file: FileEdit, f: number, mine: readonly Comment[], here: Draft | null, from: number) => {
      let before = 0

      return (hunk: Hunk, index: number) => {
        const first = Math.max(0, from - before)
        const end = Math.min(hunk.lines.length, from + PAGE - before, first + room)
        before += hunk.lines.length
        if (end <= first) return null
        room -= end - first
        const lineNumbers = numbers(hunk)
        const title = `Lines ${span(hunk, first, end - 1)}${file.edits > 1 ? `, edit ${hunk.edit}` : ''}`
        const at = here?.at?.h === index ? here.at : undefined
        const where = at ? `Line ${span(hunk, at.from, at.to)}` : ''
        const under = (l: number) => mine.filter(note => note.at?.h === index && note.at.to === l)

        return (
          <Box flexDirection="column">
            <Text dimColor>{title}</Text>
            {hunk.lines.slice(first, end).map((line, row) => {
              const l = first + row
              const isPicked = at !== undefined && l >= at.from && l <= at.to
              const paint =
                line[0] === '+' ? { color: 'success' } : line[0] === '-' ? { color: 'error' } : { dimColor: true }

              return (
                <Box flexDirection="column">
                  <Button key={`row:${f}:${index}:${l}`} plain onPress={() => pick(file.path, index, l)}>
                    <Text color="warning">{isPicked ? '▌' : ' '}</Text>
                    <Text dimColor>{`${String(lineNumbers[l] ?? '').padStart(5)} `}</Text>
                    <Text {...paint}>{fit(clean(line), columns - 8)}</Text>
                  </Button>
                  {under(l).map(drawn)}
                  {at?.to === l && field(where)}
                </Box>
              )
            })}
          </Box>
        )
      }
    }

    return (
      <Box flexDirection="column">
        <Text>
          <Text bold>{plural(list.length, 'file')}</Text> edited by Claude
          {notes.length > 0 ? `, ${plural(notes.length, 'comment')} to send` : ''}
        </Text>
        <Box columnGap={2} flexWrap="wrap">
          {notes.length > 0 && (
            <Button
              key="submit"
              plain
              variant="primary"
              {...keyed('s')}
              label={`Send ${plural(notes.length, 'comment')} to Claude`}
              onPress={submit}
            />
          )}
          <Button
            key="reviewed"
            plain
            {...keyed('r')}
            label="Mark all reviewed"
            onPress={async () => {
              await clear($)
              await $.ui.close({ id: PANE }).catch(() => undefined)
              $.ui.toast('Marked reviewed. /edit-review has Undo.')
            }}
          />
          <Button
            key="fold"
            plain
            {...keyed('e')}
            label={isEveryOpen ? 'Collapse all' : 'Expand all'}
            onPress={() => update($, expanded, () => (isEveryOpen ? [] : list.map(file => file.path)))}
          />
          {undo}
        </Box>
        <Text dimColor>Open a file, then click a line (or press Enter on it) to comment.</Text>
        {list.map((file, f) => {
          const mine = notes.filter(note => note.path === file.path)
          const here = open?.path === file.path ? open : null
          const isOpen = unfolded.includes(file.path)
          const rows = size(file)
          const from = Math.min(pages[file.path] ?? 0, Math.max(0, rows - 1))
          const turn = (to: number) => update($, page, was => ({ ...was, [file.path]: to }))

          return (
            <Box flexDirection="column" marginTop={f === 0 || isOpen ? 1 : 0} marginBottom={isOpen ? 1 : 0}>
              <Button
                key={`file:${f}`}
                plain
                onPress={() =>
                  update($, expanded, was =>
                    was.includes(file.path) ? was.filter(path => path !== file.path) : [...was, file.path],
                  )
                }
              >
                <Text bold>{`${isOpen ? '▾' : '▸'} ${named(file.path, columns - 26)}`}</Text>
                <Text color="success">{` +${count(file, '+')}`}</Text>
                <Text color="error">{` -${count(file, '-')}`}</Text>
                <Text color="warning">{mine.length > 0 ? ` ${plural(mine.length, 'comment')}` : ''}</Text>
              </Button>
              {isOpen && (
                <Button
                  key={`on-file:${f}`}
                  plain
                  dimColor
                  label="comment on whole file"
                  onPress={() => begin({ path: file.path })}
                />
              )}
              {isOpen && here !== null && here.at === undefined && field('Whole file')}
              {isOpen && mine.filter(note => note.at === undefined).map(drawn)}
              {isOpen && file.hunks.length === 0 && <Text dimColor>Diff unavailable for this edit.</Text>}
              {isOpen && from > 0 && (
                <Button
                  key={`prev:${f}`}
                  plain
                  dimColor
                  label={`↑ previous ${Math.min(PAGE, from)} lines`}
                  onPress={() => turn(Math.max(0, from - PAGE))}
                />
              )}
              {isOpen && file.hunks.map(hunkOf(file, f, mine, here, from))}
              {isOpen && from + PAGE < rows && (
                <Button
                  key={`next:${f}`}
                  plain
                  dimColor
                  label={`↓ next ${Math.min(PAGE, rows - from - PAGE)} lines (${from + 1}-${from + PAGE} of ${rows} shown)`}
                  onPress={() => turn(from + PAGE)}
                />
              )}
              {isOpen && (file.cut ?? 0) > 0 && (
                <Text dimColor>{`… ${plural(file.cut ?? 0, 'more line')} of this diff not kept`}</Text>
              )}
            </Box>
          )
        })}
        {total > MAX_ROWS && (
          <Text dimColor>{`… ${total - MAX_ROWS} more lines wait for room: fold a file to see them`}</Text>
        )}
      </Box>
    )
  })
}
