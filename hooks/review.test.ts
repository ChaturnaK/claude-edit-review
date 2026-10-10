import { expect, test } from 'claude-code/testing'

const CART = '/repo/src/cart.ts'
const FRESH = '/repo/src/fresh.ts'
const LINES = [
  ' function total(items) {',
  '-  return items.length',
  '+  return items.reduce((sum, item) => sum + item.price, 0)',
  ' }',
]
const PANE = {
  plugin: 'edit-review',
  component: 'Pane',
  requestId: 'review',
  props: {
    title: 'Review',
    isFocused: true,
    bodyColumns: 100,
    placement: 'dock',
    scroll: { offset: 0, bodyRows: 40 },
    view: {},
  },
} as const

test('edits are captured, commented on and submitted', async ($, on) => {
  const sent: string[] = []
  on('tool.call', { tool: 'Edit' }, () => ({
    result: {
      filePath: CART,
      oldString: 'items.length',
      newString: 'items.reduce((sum, item) => sum + item.price, 0)',
      originalFile: null,
      structuredPatch: [{ oldStart: 10, oldLines: 3, newStart: 10, newLines: 3, lines: LINES }],
      userModified: false,
      replaceAll: false,
    },
  }))
  // A new file outside a git repository: no patch at all, only its content.
  on('tool.call', { tool: 'Write' }, () => ({
    result: {
      type: 'create',
      filePath: FRESH,
      content: 'export const a = 1\n',
      structuredPatch: [],
      originalFile: null,
    },
  }))
  on('prompt.submit', (_, e) => {
    sent.push(e.text)

    return { text: e.text }
  })

  const edited = await $.tool.call({
    tool: 'Edit',
    file_path: CART,
    old_string: 'items.length',
    new_string: 'items.reduce((sum, item) => sum + item.price, 0)',
  })
  expect(edited.deny).toBeUndefined()
  await $.tool.call({ tool: 'Write', file_path: FRESH, content: 'export const a = 1\n' })

  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  // Files start folded, so the list of them is the first thing seen.
  expect(await ui.find({ key: 'on-file:0' })).toBeUndefined()
  await ui.press({ key: 'file:0' })
  // A line, then a second line: the comment covers the range.
  await ui.press({ key: 'row:0:0:1' })
  await ui.press({ key: 'row:0:0:2' })
  expect(await ui.find({ text: /^Line 11$/ })).toBeDefined()
  await ui.input({ key: 'draft', text: 'Handle the empty cart.' })
  expect(await ui.find({ text: /Handle the empty cart\./ })).toBeDefined()

  // Edit reopens the field on the saved comment and replaces its text in place.
  await ui.press({ key: 'edit:1' })
  expect(await ui.find({ key: 'del:1' })).toBeUndefined()
  await ui.input({ key: 'draft', text: 'Handle the empty cart, please.' })
  expect(await ui.find({ text: /^Handle the empty cart, please\.$/ })).toBeDefined()
  expect(await ui.findAll({ text: /^Line 11$/ })).toHaveLength(1)

  // Every file's diff is in the pane at once: the second file takes comments with no switching.
  await ui.press({ key: 'file:1' })
  expect((await ui.find({ key: 'row:1:0:0' }))?.text).toContain('+export const a = 1')
  await ui.press({ key: 'on-file:1' })
  await ui.input({ key: 'draft', text: 'Add a test.' })

  await ui.press({ key: 'submit' })
  expect(sent).toEqual([
    [
      'Review comments on your edits — address each one:',
      `${CART}:11\n> ${LINES[1]}\n> ${LINES[2]}\nHandle the empty cart, please.`,
      `${FRESH} (whole file)\nAdd a test.`,
    ].join('\n\n'),
  ])

  await ui.redraw()
  expect(await ui.find({ text: /Nothing to review/ })).toBeDefined()

  // Undo brings both diffs back, without the comments already sent.
  await ui.press({ key: 'undo' })
  expect(await ui.find({ key: 'on-file:1' })).toBeDefined()
  expect(await ui.find({ key: 'submit' })).toBeUndefined()

  // Mark reviewed can be undone too, comments included.
  await ui.press({ key: 'on-file:0' })
  await ui.input({ key: 'draft', text: 'Keep me.' })
  await ui.press({ key: 'reviewed' })
  await ui.redraw()
  await ui.press({ key: 'undo' })
  expect(await ui.find({ text: /Keep me\./ })).toBeDefined()
  expect(sent).toHaveLength(1)
})

test('what a shell command changed is recorded, a long diff cut short', async ($, on) => {
  const hunk = (lines: string[]) => ({ oldStart: 0, oldLines: 0, newStart: 1, newLines: lines.length, lines })
  on('tool.call', { tool: 'Bash' }, () => ({
    result: {
      stdout: '',
      stderr: '',
      interrupted: false,
      bashEditDiff: {
        files: [
          { filePath: '/repo/generated.ts', hunks: [hunk(Array<string>(2500).fill('+x'))] },
          { filePath: CART, hunks: [hunk(['+y'])] },
          { filePath: '/repo/untouched.ts', hunks: [] },
        ],
        moreFiles: 0,
      },
    },
  }))
  await $.tool.call({ tool: 'Bash', command: 'npm run generate' })

  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect((await ui.find({ key: 'file:0' }))?.text).toContain('+2000')
  expect(await ui.find({ key: 'file:1' })).toBeDefined()
  expect(await ui.find({ key: 'file:2' })).toBeUndefined()
  await ui.press({ key: 'file:0' })
  expect(await ui.find({ text: /500 more lines of this diff not kept/ })).toBeDefined()
})

test('the desktop app is pointed at its own diff view', async $ => {
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  expect(await ui.find({ text: /built-in diff view/ })).toBeDefined()
})
