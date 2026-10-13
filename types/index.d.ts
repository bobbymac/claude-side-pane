export type StepStatus = 'pending' | 'in_progress' | 'completed'
export type Step = { id: string; text: string; status: StepStatus }
export type Limit = { label: string; percent: number }
export type Bar = {
  cwd: string
  branch?: string
  model?: string
  contextPercent?: number
  costUsd?: number
  turns?: number
  limits: Limit[]
}

declare module 'claude-code' {
  interface PluginState {
    'side-pane': { steps: Step[]; bar: Bar; isWinking: boolean; runStep: number }
  }
}
