# Dispatch bridge (调度桥)

## What it does

DeepSeek Harness hosts do not expose their local authenticated URL to clients outside the process. `/api` calls need a signed cookie, and that cookie is obtained by exchanging a per-process launch token that the host generates in memory and hands only to its own app shell. A script, scheduler, or another agent on the same machine therefore has no supported way in.

This plugin runs inside the host process and, every 60 seconds, writes two files:

| File | Content |
| --- | --- |
| `~/.dsh/dispatch/auth-url.txt` | `http://127.0.0.1:<port>/?token=<token>` — the host's authenticated local URL |
| `~/.dsh/dispatch/workspaces.json` | Workspace snapshot: `workspaceId`, `title`, `path`, `sessionIds`, `default`, `defaultWorkspaceId`, `archivedSessionIds` |

`DSH_HOME` is respected, so an isolated state directory gets its own `dispatch/` folder.

## How to use it

1. Read `auth-url.txt`. Send one `GET` to that URL and keep the response cookie (the host answers `303` with `Set-Cookie: dsh-auth-...`). The token is not needed after this exchange.

   ```sh
   curl -s -o /dev/null -D /dev/null -c cookies.txt "$(cat ~/.dsh/dispatch/auth-url.txt)"
   ```

2. Call any endpoint with `POST http://127.0.0.1:<port>/api/<endpoint>`, sending the cookie and `Content-Type: application/json`, with this envelope:

   ```json
   {"type":"client-request","rpcId":"1","method":"session/create","payload":{"args":{"request":{"workspaceId":"<workspaceId from workspaces.json>"}}}}
   ```

   The response is `{"type":"server-response","rpcId":"1","result":{"ok":true,"value":{...}}}`; errors come back as `result.ok: false` with an `error.code`.

3. Useful endpoints:

   | Endpoint | `args.request` | Notes |
   | --- | --- | --- |
   | `session/create` | `{workspaceId}` or `{cwd}` | A session created with `workspaceId` is registered in that workspace and opens in the app under that workspace's group |
   | `session/prompt` | `{requestId, sessionId, mode: "queue"｜"steer", content: [{type: "text", text}], clientTimeZone}` | Sends one user message |
   | `session/page` | `{address: {kind: "session", sessionId}, maxMessages}` | Reads the event stream; the reply text is the `type === "text"` block inside `assistant/message` → `data.message.content` |
   | `session/wait` | `{sessionId, timeoutMs, afterSeq}` | Waits for idle; its `output.records` is always empty — read the text from `session/page` |
   | `session/list` | `{}` | Lists persisted sessions; items carry `cwd` and projections but not `workspaceId` |
   | `workspace/create` | `{path}` | Idempotent by path; returns `{workspace, created}` |

## Caveats

- **`auth-url.txt` is a bearer credential.** Anyone who can read it can act as the host owner. It is written into your user profile and, on POSIX, with owner-only permissions (`0600`, directory `0700`). Do not commit it, sync it, or paste it into a chat.
- The plugin never sends data over the network. It only writes those two files locally.
- The launch token is regenerated per host process; the cookie is signed by a persisted secret and stays valid for 30 days on the same authority (host + port). A host that starts on random ports (`--port 0`) changes authority each run, so the cookie has to be exchanged again.
- Set `DSH_DISPATCH_BRIDGE=0` (or `off`) to stop publishing entirely.
- Unsigned or unauthorized requests still get `401`; this plugin does not weaken any access rule. It only makes the already-required credential available to local automation.

## Turn it off

```sh
# Windows (PowerShell)
$env:DSH_DISPATCH_BRIDGE=0
# POSIX
DSH_DISPATCH_BRIDGE=0 dsh web
```
