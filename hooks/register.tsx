import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { Bar, Step, StepStatus } from '../types'

const PANE = 'side'
const steps = atom({ plugin: 'side-pane', key: 'steps' } as const, [] as Step[])
const bar = atom({ plugin: 'side-pane', key: 'bar' } as const, { cwd: '', limits: [] } as Bar)
const winking = atom({ plugin: 'side-pane', key: 'isWinking' } as const, false)
// -1 while the kitty sits; otherwise how many steps it has run this turn.
const running = atom({ plugin: 'side-pane', key: 'runStep' } as const, -1)

const MARK: Record<StepStatus, string> = { pending: '[ ]', in_progress: '[>]', completed: '[x]' }
const LIMIT_LABEL: Record<string, string> = { five_hour: '5h', seven_day: '7d', spend_limit: 'spend' }

const KITTY = (isWinking: boolean) => [
  '   /\\_/\\',
  isWinking ? '  ( -.o )' : '  ( o.o )',
  '   > ^ <',
  '  /|   |\\',
  ' (_|   |_)~',
]

// Two strides, as tall as the sitting kitty so the pane does not jump.
const STRIDES = [
  ['', '         /\\_/\\', '  ~~____( >.< )', '    /  __   /', '   /_/   \\_\\'],
  ['', '         /\\_/\\', '  ~~____( o.o )', '    \\  __   \\', '     \\_\\  /_/'],
]
const STRIDE_WIDTH = 16
const STEP_MS = 150

const isOk = (ran: { deny?: string; isError?: boolean }) => ran.deny === undefined && ran.isError !== true

// One figure the engine cannot give leaves that row out, never the whole pane.
async function attempt<T>(get: () => Promise<T>): Promise<T | undefined> {
  try {
    return await get()
  } catch {
    return undefined
  }
}

// The status line's figures, gathered the way statusline.ps1 gathers them.
async function refresh($: EngineInterface) {
  const cwd = (await attempt(() => $.session.cwd())) ?? ''
  const home =
    (await attempt(() => $.env.get('USERPROFILE'))) || (await attempt(() => $.env.get('HOME'))) || ''
  const slashed = cwd.replace(/\\/g, '/')
  const homeSlashed = home.replace(/\\/g, '/')
  const dir =
    homeSlashed && slashed.toLowerCase().startsWith(homeSlashed.toLowerCase())
      ? '~' + slashed.slice(homeSlashed.length)
      : slashed

  const git = await attempt(() => $.process.run(['git', '--no-optional-locks', 'branch', '--show-current']))
  const short = git?.exitCode === 0 && git.stdout.trim() === ''
    ? await attempt(() => $.process.run(['git', '--no-optional-locks', 'rev-parse', '--short', 'HEAD']))
    : undefined
  const branch = (git?.exitCode === 0 ? git.stdout.trim() : '') || (short?.exitCode === 0 ? short.stdout.trim() : '')

  const usage = await attempt(() => $.session.usage())
  const model = await attempt(() => $.session.model())
  const turns = await attempt(() => $.session.turns())

  await update($, bar, () => ({
    cwd: dir,
    branch: branch || undefined,
    model,
    contextPercent: usage?.context.percent,
    costUsd: usage?.cost?.usd,
    turns,
    limits: (usage?.rateLimits ?? []).map(one => ({
      label: LIMIT_LABEL[one.kind] ?? one.kind,
      percent: Math.round(one.percentUsed),
    })),
  }))
}

// The kitty winks every 4 to 9 seconds, for a moment.
let isKittyAwake = false
function wakeKitty($: EngineInterface) {
  if (isKittyAwake) return
  isKittyAwake = true
  const nap = () =>
    $.clock.after(4_000 + Math.floor(Math.random() * 5_000), () => {
      void update($, winking, () => true)
      $.clock.after(600, () => {
        void update($, winking, () => false)
        nap()
      })
    })
  nap()
}

// While a turn runs, the kitty runs across the pane, a stride per step.
let stride: { cancel: () => void } | undefined
function startRunning($: EngineInterface) {
  if (stride) return
  void update($, running, () => 0)
  stride = $.clock.every(STEP_MS, () => void update($, running, step => step + 1))
}
function stopRunning($: EngineInterface) {
  stride?.cancel()
  stride = undefined
  void update($, running, () => -1)
}

export const register: Register = on => {
  // Below 144 columns an unasked pane waits unplaced; an open asked by the
  // person's own prompt is placed at any width, so the first prompt opens it.
  let isPlaced = false

  on('session.start', async ($, e, next) => {
    await $.command.register({ name: 'side', description: 'Show the side pane (status + plan)' })
    void $.ui.open({ id: PANE, title: 'Session' }).then(opened => {
      isPlaced = opened.isPlaced
    })
    void refresh($)
    $.clock.every(15_000, () => void refresh($))
    wakeKitty($)
    return next(e)
  })

  on('prompt.submit', async ($, e, next) => {
    if (!isPlaced) {
      isPlaced = true
      void $.ui.open({ id: PANE, title: 'Session' })
    }
    return next(e)
  })

  on('command.run', { command: 'side' }, async $ => {
    isPlaced = (await $.ui.open({ id: PANE, title: 'Session' })).isPlaced
    wakeKitty($)
    await refresh($)
    return { text: 'Side pane opened.' }
  })

  on('turn.start', ($, e, next) => {
    startRunning($)
    return next(e)
  })

  on('turn.complete', async ($, e, next) => {
    const done = await next(e)
    if (e.agentId === undefined) stopRunning($)
    void refresh($)
    return done
  })

  // TodoWrite sends the whole list each time: replace it.
  on('tool.call', { tool: 'TodoWrite' }, async ($, e, next) => {
    const ran = await next(e)
    if (isOk(ran)) {
      await update($, steps, () =>
        e.todos.map((todo, i) => ({
          id: `todo-${i}`,
          text: todo.status === 'in_progress' ? todo.activeForm : todo.content,
          status: todo.status,
        })),
      )
    }
    return ran
  })

  // The Task tools add and change one step at a time.
  on('tool.call', { tool: 'TaskCreate' }, async ($, e, next) => {
    const ran = await next(e)
    const task = isOk(ran) ? (ran.result as { task?: { id: string; subject: string } } | undefined)?.task : undefined
    if (task) {
      const { id, subject } = task
      await update($, steps, list => [
        ...list.filter(one => one.id !== id),
        { id, text: subject, status: 'pending' as StepStatus },
      ])
    }
    return ran
  })

  on('tool.call', { tool: 'TaskUpdate' }, async ($, e, next) => {
    const ran = await next(e)
    if (isOk(ran)) {
      const { taskId, subject, status } = e
      await update($, steps, list =>
        status === 'deleted'
          ? list.filter(one => one.id !== taskId)
          : list.map(one =>
              one.id === taskId ? { ...one, text: subject ?? one.text, status: status ?? one.status } : one,
            ),
      )
    }
    return ran
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Text } = $.ui.resolve(e)
    const figures = await read($, bar)
    const list = await read($, steps)
    const isWinking = await read($, winking)
    const runStep = await read($, running)
    const done = list.filter(one => one.status === 'completed').length
    const track = Math.max(1, e.props.bodyColumns - STRIDE_WIDTH)
    const kitty =
      runStep < 0
        ? KITTY(isWinking)
        : (STRIDES[runStep % 2] ?? []).map(line => ' '.repeat(runStep % track) + line)
    const isDocked = e.props.placement === 'dock'
    const room = Math.max(1, (isDocked ? e.props.scroll.bodyRows : (e.viewport?.rows ?? 24)) - 19)

    const meter = (percent: number) => {
      const p = Math.max(0, Math.min(100, Math.round(percent)))
      const filled = Math.round(p / 10)
      const color = p >= 80 ? 'error' : p >= 50 ? 'warning' : 'success'
      return (
        <Text>
          <Text color={color}>{'█'.repeat(filled)}</Text>
          <Text dimColor>{'░'.repeat(10 - filled)}</Text> {p}%
        </Text>
      )
    }

    return (
      <Box flexDirection="column" justifyContent="space-between" height={isDocked ? e.props.scroll.bodyRows : undefined}>
        <Box flexDirection="column">
        <Text color="cyan" wrap="truncate-start">
          {figures.cwd || '...'}
        </Text>
        {figures.branch !== undefined && <Text color="magenta">{figures.branch}</Text>}
        {figures.model !== undefined && <Text color="blue">{figures.model}</Text>}

        <Box marginTop={1} flexDirection="column">
          <Box>
            <Text dimColor>ctx   </Text>
            {figures.contextPercent === undefined ? <Text dimColor>--</Text> : meter(figures.contextPercent)}
          </Box>
          {figures.limits.map(one => (
            <Box key={one.label}>
              <Text dimColor>{one.label.padEnd(6)}</Text>
              {meter(one.percent)}
            </Box>
          ))}
          {figures.costUsd !== undefined && (
            <Text>
              <Text dimColor>cost  </Text>${figures.costUsd.toFixed(2)}
            </Text>
          )}
          {figures.turns !== undefined && (
            <Text>
              <Text dimColor>turns </Text>
              {figures.turns}
            </Text>
          )}
        </Box>

        <Box marginTop={1} flexDirection="column">
          <Text bold>Plan{list.length > 0 ? `  ${done}/${list.length}` : ''}</Text>
          {list.length === 0 && <Text dimColor>No plan yet.</Text>}
          {list.slice(0, room).map(one => (
            <Text
              key={one.id}
              color={one.status === 'in_progress' ? 'cyan' : undefined}
              bold={one.status === 'in_progress'}
              dimColor={one.status === 'completed'}
              strikethrough={one.status === 'completed'}
            >
              {MARK[one.status]} {one.text}
            </Text>
          ))}
          {list.length > room && <Text dimColor>+{list.length - room} more</Text>}
        </Box>
        </Box>

        <Box key="kitty" marginTop={1} flexDirection="column">
          {kitty.map((line, i) => (
            <Text key={`kitty-${i}`} color="claude" wrap="truncate-end">
              {line}
            </Text>
          ))}
        </Box>
      </Box>
    )
  })
}
