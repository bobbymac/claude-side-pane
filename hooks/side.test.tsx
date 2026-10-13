import { expect, mock, test } from 'claude-code/testing'

const PANE = {
  component: 'Pane',
  requestId: 'side',
  viewport: { columns: 40, rows: 30 },
  props: {
    title: 'Session',
    isFocused: false,
    bodyColumns: 38,
    placement: 'dock',
    scroll: { offset: 0, bodyRows: 28 },
    view: {},
  },
} as const

const SURFACES = ['terminal', 'desktop'] as const

test('the pane shows the status figures', async ($, on) => {
  on('session.cwd', () => ({ value: 'C:\\Users\\me\\Projects\\adhoc' }))
  on('env.get', () => ({ value: 'C:\\Users\\me' }))
  on('session.model', () => ({ value: 'claude-opus-5-5' }))
  on('session.turns', () => ({ value: 7 }))
  on('session.usage', () => ({
    value: {
      startedAt: 0,
      context: { tokens: 116_000, window: 200_000, percent: 58 },
      rateLimits: [{ kind: 'five_hour', percentUsed: 31 }],
      cost: { usd: 1.234 },
    },
  }))
  on('process.run', () => ({
    value: { exitCode: 0, stdout: 'main\n', stderr: '', isStdoutTruncated: false, isStderrTruncated: false },
  }))

  on('ui.open', () => ({ value: { isPlaced: true } }))

  await $.command.run({
    command: 'side',
    args: '',
    origin: { kind: 'composer' },
    presentation: { isFullscreen: true, columns: 160 },
  })

  for (const surface of SURFACES) {
    const ui = await $.ui.mount({ plugin: 'side-pane', surface, ...PANE })
    expect(await ui.find({ type: 'Text', text: '~/Projects/adhoc' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: 'main' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: 'claude-opus-5-5' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /58%/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /31%/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /\$1\.23/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: 'No plan yet.' })).toBeDefined()
    await ui.unmount()
  }
})

test('the pane shows the TodoWrite plan', async ($, on) => {
  on('tool.call', { tool: 'TodoWrite' }, ($, e) => ({
    result: { oldTodos: [], newTodos: e.todos },
  }))

  await $.tool.call({
    tool: 'TodoWrite',
    todos: [
      { content: 'Read the profile', status: 'completed', activeForm: 'Reading the profile' },
      { content: 'Write the mod', status: 'in_progress', activeForm: 'Writing the mod' },
      { content: 'Validate it', status: 'pending', activeForm: 'Validating it' },
    ],
  })

  for (const surface of SURFACES) {
    const ui = await $.ui.mount({ plugin: 'side-pane', surface, ...PANE })
    expect(await ui.find({ type: 'Text', text: /Plan\s+1\/3/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: '[x] Read the profile' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: '[>] Writing the mod' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: '[ ] Validate it' })).toBeDefined()
    await ui.unmount()
  }
})

test('the kitty winks now and then', async ($, on) => {
  const clock = mock.clock(on)
  on('ui.open', () => ({ value: { isPlaced: true } }))
  await $.command.run({
    command: 'side',
    args: '',
    origin: { kind: 'composer' },
    presentation: { isFullscreen: true, columns: 160 },
  })

  const ui = await $.ui.mount({ plugin: 'side-pane', surface: 'terminal', ...PANE })
  expect(await ui.find({ type: 'Text', text: '( o.o )' })).toBeDefined()

  let hasWinked = false
  for (let step = 0; step < 100 && !hasWinked; step++) {
    await clock.advance(100)
    hasWinked = (await ui.find({ type: 'Text', text: '( -.o )' })) !== undefined
  }
  expect(hasWinked).toBe(true)

  await clock.advance(700)
  expect(await ui.find({ type: 'Text', text: '( o.o )' })).toBeDefined()
  await ui.unmount()
})

test('the kitty runs while a turn works, and sits when it ends', async ($, on) => {
  const clock = mock.clock(on)
  on('turn.start', ($, e) => ({ turnId: e.turnId }))
  on('turn.complete', ($, e) => ({ text: e.answer }))

  const ui = await $.ui.mount({ plugin: 'side-pane', surface: 'terminal', ...PANE })
  expect(await ui.find({ type: 'Text', text: '( o.o )' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /~~____/ })).toBeUndefined()

  await $.turn.start({ text: 'go', turnId: 't1' })
  expect(await ui.find({ type: 'Text', text: /~~____/ })).toBeDefined()

  const at = async () => ((await ui.find({ type: 'Text', text: /~~____/ }))?.text ?? '').indexOf('~~')
  const before = await at()
  await clock.advance(450)
  expect(await at()).toBeGreaterThan(before)

  await $.turn.complete({ answer: 'done', durationMs: 450, isAborted: false, turnId: 't1', reason: 'answer' })
  expect(await ui.find({ type: 'Text', text: /~~____/ })).toBeUndefined()
  expect(await ui.find({ type: 'Text', text: /\(_\|   \|_\)~/ })).toBeDefined()
  await ui.unmount()
})
