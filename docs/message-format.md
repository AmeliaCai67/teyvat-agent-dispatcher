# 消息格式

**一条消息 = `mailbox/` 里一个 markdown 文件。** 文件名 `<id>-<type>.md`。

## Frontmatter 字段

| 字段 | 必填 | 含义 |
|---|---|---|
| `id` | ✓ | `YYYYMMDD-HHMM-序号`，**全局唯一**，也是日志文件名 |
| `from` | ✓ | 发起方 agent 名 |
| `to` | ✓ | 接收方 agent 名 |
| `type` | ✓ | `handoff` / `report` / `question` / `ack` / `close` |
| `thread` | ✓ | 线程 id —— **一次任务一条线**，跨多次派活不变 |
| `ref` | report 必填 | 指回它的 `handoff` 的 id ⇒ **一次派活可复盘** |
| `created` | ✓ | ISO 8601 UTC |
| `exit_code` | report 建议 | 被调命令的退出码 |

## 五种类型

| 类型 | 谁发 | 含义 | 约束 |
|---|---|---|---|
| `handoff` | 发起方 | 派活（含命令全文、工作目录） | ★ **受 `HANDOFF_EDGES` 约束** |
| `report` | 被派方 | 回报结果（退出码 / 耗时 / 输出尾巴 / 日志路径） | 必须带 `ref` |
| `question` | 任何方 | 提问 | ★ **对方必须回** |
| `ack` | 接收方 | 回执"我收到了" | 简短 |
| `close` | 任何方 | 关线程 | 关掉后 `openThreads` 不再返回它 |

★ **只有 `handoff` 受边约束** —— 因为"谁能派给谁"是**权力**，
而"谁在问谁 / 谁在谢谁"**不是**。

## 归档

`close` 之后把该线程的消息 `mv` 到 `mailbox/archive/`。

★ **归档是搬家，不是删除** —— 工具**照读** `archive/`，只是 `openThreads` 不再返回已关线程。

## 文件写入的原子性

先写 `.tmp` 再 `rename` —— **避免别的进程读到写了一半的文件**。
（进程内并发、多 agent 同时写同一个 `mailbox/`，这一步是必需的。）
