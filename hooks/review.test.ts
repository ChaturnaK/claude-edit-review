import { expect, test } from 'claude-code/testing'

import { parsePatch, pieces } from './register'

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

for (const surface of ['terminal', 'desktop'] as const) {
  test(`edits are captured, commented on and submitted (${surface})`, async ($, on) => {
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

    const ui = await $.ui.mount({ ...PANE, surface })
    // A line, then a second line: the comment covers the range. The terminal's lines are
    // Buttons; a desktop draws the diff as Code and picks the line in a Select.
    // Files start folded, so the list of them is the first thing seen.
    expect(await ui.find({ key: 'on-file:0' })).toBeUndefined()
    await ui.press({ key: 'file:0' })
    const pickLine = (l: number) =>
      surface === 'terminal'
        ? ui.press({ key: `row:0:0:${l}` })
        : ui.select({ key: 'line:0:0', value: String(l) })
    await pickLine(1)
    await pickLine(2)
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
    const fresh = await ui.findAll(surface === 'terminal' ? { key: 'row:1:0:0' } : { type: 'Code' })
    expect(JSON.stringify(fresh)).toContain('+export const a = 1')
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
}

test('a git patch parses into hunks, and a hunk is cut where a comment goes', () => {
  const hunks = parsePatch(`--- a/cart.ts\n+++ b/cart.ts\n@@ -10,3 +10,3 @@\n${LINES.join('\n')}`)
  expect(hunks).toEqual([{ oldStart: 10, newStart: 10, lines: LINES }])
  const anchored = hunks.map(hunk => ({ ...hunk, edit: 1 }))
  // Cut after the removed line: each piece is a hunk of its own, numbered on from the last.
  const [hunk] = anchored
  expect(hunk && pieces(hunk, 4, [1])).toEqual([
    { end: 1, source: `@@ -10,2 +10,1 @@\n${LINES[0]}\n${LINES[1]}` },
    { end: 3, source: `@@ -12,1 +11,2 @@\n${LINES[2]}\n${LINES[3]}` },
  ])
})
