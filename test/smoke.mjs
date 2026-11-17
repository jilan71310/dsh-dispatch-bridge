import { strict as assert } from 'node:assert'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const home = mkdtempSync(join(tmpdir(), 'dsh-dispatch-bridge-'))
const cleanups = []

function makeCtx(port = 45678) {
  return {
    webServer: { protocol: 'http:', port },
    connection: { authenticatedUrl: (base) => `${base}/?token=test-token` },
    effect: (fn) => {
      cleanups.push(fn())
    },
  }
}

try {
  // A workspace registry shaped like the host's own storage.
  mkdirSync(join(home, 'storages'), { recursive: true })
  writeFileSync(
    join(home, 'storages', 'workspace.json'),
    JSON.stringify({
      unit: { name: 'workspace', version: 2 },
      global: {
        initialized: true,
        defaultWorkspaceId: 'ws-default',
        workspaceIds: ['ws-a', 'ws-default'],
        archivedSessionIds: ['session-old'],
      },
      tables: {
        workspaces: {
          'ws-a': { path: 'D:\\work\\a', title: 'a', sessionIds: ['session-1'], createdAt: 1, updatedAt: 2 },
          'ws-default': { path: 'D:\\work\\default', title: 'default', sessionIds: [], createdAt: 1, updatedAt: 2 },
        },
      },
    }),
    'utf8',
  )

  process.env.DSH_HOME = home
  const { apply } = await import('../index.js')
  apply(makeCtx())

  const auth = readFileSync(join(home, 'dispatch', 'auth-url.txt'), 'utf8').trim()
  assert.equal(auth, 'http://127.0.0.1:45678/?token=test-token')

  const snapshot = JSON.parse(readFileSync(join(home, 'dispatch', 'workspaces.json'), 'utf8'))
  assert.equal(snapshot.defaultWorkspaceId, 'ws-default')
  assert.deepEqual(snapshot.archivedSessionIds, ['session-old'])
  assert.equal(snapshot.workspaces.length, 2)
  assert.deepEqual(snapshot.workspaces[0], {
    workspaceId: 'ws-a',
    title: 'a',
    path: 'D:\\work\\a',
    default: false,
    sessionIds: ['session-1'],
  })
  assert.equal(snapshot.workspaces[1].default, true)

  // A port that is not up yet must not produce a bogus file.
  const { apply: applyAgain } = await import('../index.js?second')
  rmSync(join(home, 'dispatch'), { recursive: true, force: true })
  applyAgain({ ...makeCtx(0) })
  assert.equal(existsSync(join(home, 'dispatch', 'auth-url.txt')), false)

  console.log('smoke: ok')
} finally {
  for (const cleanup of cleanups) {
    try {
      cleanup?.()
    } catch {
      // ignore
    }
  }
  rmSync(home, { recursive: true, force: true })
}
