import { chmodSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

/**
 * Dispatch bridge.
 *
 * Runs inside the host process and republishes two facts a local automation
 * client cannot otherwise obtain:
 *
 *   <DSH_HOME>/dispatch/auth-url.txt    the host's authenticated local URL
 *   <DSH_HOME>/dispatch/workspaces.json a snapshot of the workspace registry
 *
 * The URL carries the per-process launch token, so the file is a bearer
 * credential for this host. It is written for the current user only and is
 * never sent anywhere. Set DSH_DISPATCH_BRIDGE=0 to turn publishing off.
 */

export const inject = ['connection', 'webServer']

const DSH_HOME = process.env.DSH_HOME ?? join(homedir(), '.dsh')
const OUT_DIR = join(DSH_HOME, 'dispatch')
const AUTH_FILE = join(OUT_DIR, 'auth-url.txt')
const WORKSPACE_FILE = join(OUT_DIR, 'workspaces.json')
const POSIX = process.platform !== 'win32'
const OFF = process.env.DSH_DISPATCH_BRIDGE === '0' || process.env.DSH_DISPATCH_BRIDGE === 'off'

function readWorkspaces() {
  try {
    const raw = readFileSync(join(DSH_HOME, 'storages', 'workspace.json'), 'utf8')
    const unit = JSON.parse(raw)
    const global = unit.global ?? {}
    const table = unit.tables?.workspaces ?? {}
    const ids = global.workspaceIds ?? Object.keys(table)
    const workspaces = ids.map((id) => {
      const item = table[id] ?? {}
      return {
        workspaceId: id,
        title: item.title ?? '',
        path: item.path ?? '',
        default: id === global.defaultWorkspaceId,
        sessionIds: item.sessionIds ?? [],
      }
    })
    return {
      generatedAt: new Date().toISOString(),
      defaultWorkspaceId: global.defaultWorkspaceId ?? null,
      archivedSessionIds: global.archivedSessionIds ?? [],
      workspaces,
    }
  } catch (error) {
    return {
      generatedAt: new Date().toISOString(),
      error: String((error && error.message) || error),
      workspaces: [],
    }
  }
}

/** Writes through a temporary file so a reader never sees a half-written URL. */
function writeAtomic(file, text, mode) {
  const temp = `${file}.tmp`
  writeFileSync(temp, text, 'utf8')
  if (POSIX && mode !== undefined) chmodSync(temp, mode)
  renameSync(temp, file)
}

export function apply(ctx) {
  if (OFF) return

  const publish = () => {
    try {
      const port = ctx.webServer?.port
      if (!port) return
      const base = `${ctx.webServer.protocol}//127.0.0.1:${String(port)}`
      const url = ctx.connection.authenticatedUrl(base)
      mkdirSync(OUT_DIR, { recursive: true })
      if (POSIX) chmodSync(OUT_DIR, 0o700)
      writeAtomic(AUTH_FILE, `${url}\n`, 0o600)
      writeAtomic(WORKSPACE_FILE, `${JSON.stringify(readWorkspaces(), null, 2)}\n`, 0o600)
    } catch {
      // The connection is not ready on the first tick of a cold start; the timer retries.
    }
  }

  ctx.effect(() => {
    publish()
    const timer = setInterval(publish, 60_000)
    timer.unref?.()
    return () => clearInterval(timer)
  })
}
