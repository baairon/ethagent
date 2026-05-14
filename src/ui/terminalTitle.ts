export const TITLE_STATIC = 'ethagent'
export const TITLE_ANIMATION_FRAMES = [
  'ethagent ⠋',
  'ethagent ⠙',
  'ethagent ⠹',
  'ethagent ⠸',
  'ethagent ⠼',
  'ethagent ⠴',
  'ethagent ⠦',
  'ethagent ⠧',
  'ethagent ⠇',
  'ethagent ⠏',
] as const
export const TITLE_ANIMATION_INTERVAL_MS = 80

export function setTerminalTitle(title: string): void {
  const clean = title.replace(/[\x00-\x1f]/g, '')
  if (process.platform === 'win32') {
    process.title = clean
  }
  if (process.stdout.isTTY) {
    process.stdout.write(`\x1b]0;${clean}\x07`)
  }
}

export function clearTerminalTitle(): void {
  if (process.stdout.isTTY) {
    process.stdout.write('\x1b]0;\x07')
  }
}
