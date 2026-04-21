import fs from 'node:fs/promises'

const RETRYABLE_RENAME_CODES = new Set(['EPERM', 'EBUSY', 'EACCES'])
const RETRY_DELAYS_MS = [20, 60, 120]

type WriteOptions = {
  mode?: number
}

export async function atomicWriteText(
  file: string,
  data: string,
  options: WriteOptions = {},
): Promise<void> {
  const tmp = `${file}.${process.pid}.${Date.now()}.tmp`
  const mode = options.mode ?? 0o600

  await fs.writeFile(tmp, data, { encoding: 'utf8', mode })

  try {
    await replaceFileWithRetry(tmp, file)
  } catch (error: unknown) {
    await cleanupTempFile(tmp)
    throw error
  }
}

async function replaceFileWithRetry(tmp: string, file: string): Promise<void> {
  let lastError: unknown

  for (let attempt = 0; attempt <= RETRY_DELAYS_MS.length; attempt += 1) {
    try {
      await fs.rename(tmp, file)
      return
    } catch (error: unknown) {
      lastError = error
      const code = (error as NodeJS.ErrnoException).code
      if (!code || !RETRYABLE_RENAME_CODES.has(code)) break
      if (attempt === RETRY_DELAYS_MS.length) break

      await sleep(RETRY_DELAYS_MS[attempt]!)

      try {
        await fs.copyFile(tmp, file)
        await cleanupTempFile(tmp)
        return
      } catch (copyError: unknown) {
        lastError = copyError
        const copyCode = (copyError as NodeJS.ErrnoException).code
        if (!copyCode || !RETRYABLE_RENAME_CODES.has(copyCode)) break
      }
    }
  }

  throw lastError
}

async function cleanupTempFile(file: string): Promise<void> {
  try {
    await fs.unlink(file)
  } catch (error: unknown) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
  }
}

async function sleep(ms: number): Promise<void> {
  await new Promise(resolve => setTimeout(resolve, ms))
}
