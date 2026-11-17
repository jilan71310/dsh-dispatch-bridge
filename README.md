# dsh-dispatch-bridge

**Let a local automation client drive a DSH host: create a session inside a chosen workspace, send a prompt, read the reply.**

[中文说明](#中文说明) · [Detail document](docs/DETAIL.md)

A DSH host refuses `/api` calls that arrive without a signed cookie, and that cookie can only be obtained by exchanging a per-process launch token that the host generates in memory and hands to its own app shell. A script, a scheduler, an IDE task, or another agent on the same machine has no supported way in.

This plugin runs inside the host process and writes two files, refreshed every 60 seconds:

| File | Content |
| --- | --- |
| `~/.dsh/dispatch/auth-url.txt` | `http://127.0.0.1:<port>/?token=<token>` — the host's authenticated local URL |
| `~/.dsh/dispatch/workspaces.json` | Workspace snapshot: `workspaceId`, `title`, `path`, `sessionIds`, `default`, `defaultWorkspaceId`, `archivedSessionIds` |

With those, a client exchanges the URL for a cookie once and then uses the ordinary `/api` endpoints — the same ones the app uses.

## Security — read this first

`auth-url.txt` contains the host's launch token. It is a **bearer credential**: whoever reads it can act as the host owner. The plugin writes it into your own user profile (owner-only permissions on POSIX: file `0600`, directory `0700`) and never sends it anywhere. Do not commit it, sync it, or paste it into a chat. The plugin makes no network requests of its own.

Turn it off with `DSH_DISPATCH_BRIDGE=0` (or `off`).

## Install

```sh
dsh plugin --profile <profile> add github:jilan71310/dsh-dispatch-bridge
```

From a local checkout instead:

```sh
dsh plugin --profile <profile> add file:/absolute/path/to/dsh-dispatch-bridge
```

Restart the host if your profile does not hot-reload bundles, then check that `~/.dsh/dispatch/auth-url.txt` appears. `DSH_HOME` is respected, so an isolated state directory gets its own `dispatch/` folder.

## Use it

```sh
# 1. Exchange the token URL for a cookie (303 + Set-Cookie)
curl -s -o /dev/null -D /dev/null -c cookies.txt "$(cat ~/.dsh/dispatch/auth-url.txt)"

# 2. Create a session inside a workspace
curl -s -b cookies.txt -H 'Content-Type: application/json' \
  -d '{"type":"client-request","rpcId":"1","method":"session/create","payload":{"args":{"request":{"workspaceId":"<id>"}}}}' \
  http://127.0.0.1:<port>/api/session/create

# 3. Send one message
curl -s -b cookies.txt -H 'Content-Type: application/json' \
  -d '{"type":"client-request","rpcId":"2","method":"session/prompt","payload":{"args":{"request":{"requestId":"p2","sessionId":"<sessionId>","mode":"queue","content":[{"type":"text","text":"Hello"}]}}}}' \
  http://127.0.0.1:<port>/api/session/prompt

# 4. Read the reply from the event stream
curl -s -b cookies.txt -H 'Content-Type: application/json' \
  -d '{"type":"client-request","rpcId":"3","method":"session/page","payload":{"args":{"request":{"address":{"kind":"session","sessionId":"<sessionId>"},"maxMessages":50}}}}' \
  http://127.0.0.1:<port>/api/session/page
```

The reply text is the `type === "text"` block inside `assistant/message` → `data.message.content`. `turn/end` carries the final state (`reason.kind: "completed"` on success). Sessions created with a `workspaceId` are registered in that workspace, so they show up under that workspace in the desktop app.

Endpoint notes, envelope shape, and the full list of files are in [docs/DETAIL.md](docs/DETAIL.md).

## Compatibility

- Host-side bundle (`dsh.bundle` in `package.json`), no build step, no runtime dependencies.
- Works with DSH 0.2.x hosts.
- Does not weaken access rules: unsigned requests still get `401`; the plugin only republishes the credential the host already requires.

## License

MIT — see [LICENSE](LICENSE).

---

## 中文说明

**让本机自动化程序驱动 DSH 宿主：在指定工作区里建会话、发消息、读回复。**

DSH 宿主的 `/api` 需要签名 Cookie，而拿到 Cookie 必须用宿主进程内生成的启动令牌去换；令牌只交给宿主自己的窗口，进程外拿不到。本插件在宿主进程里运行，每 60 秒把宿主自己的授权地址（`~/.dsh/dispatch/auth-url.txt`）和工作区快照（`~/.dsh/dispatch/workspaces.json`）写到磁盘。客户端换一次 Cookie 之后，就能用普通 `/api` 端点：`session/create`（带 `workspaceId` 创建的会话会登记进该工作区，桌面端对应分组下可见）、`session/prompt`、`session/page`（回复正文取 `assistant/message` 里 `type === "text"` 的块）。

安全提示：`auth-url.txt` 里是宿主启动令牌，等价于本机对宿主的完全访问权。文件写在你的用户目录里（POSIX 下 `0600`，目录 `0700`），不要提交、不要同步、不要外发。插件自身不发起任何网络请求。设置 `DSH_DISPATCH_BRIDGE=0` 可关闭。
