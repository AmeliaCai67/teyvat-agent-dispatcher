# Teyvat Agent Dispatcher

> **让多个 coding agent 互相派活时，不再靠"记得"。**
>
> 一个 800 行的薄壳 + 一个消息目录，解决一件事：
> **当一个 agent 唤起另一个 agent 时，把"谁派的、派了什么、结果如何"自动留下来。**

---

## 一、为什么做这个

多 agent 协作最常见的失败，不是模型不够强，而是**协作不留痕**：

- 谁给谁派了活？派了几轮？**没人知道**；
- 一个 agent 正在跑，另一个又给它派了一条 —— **两条打架**；
- 对方有未回复的问题，发起人**已经忘了**；
- 事后复盘时，只剩"印象"，没有证据。

★ 而所有这些的根因是同一句话：

> **靠记得的规矩，就是会忘。**

所以我们把规矩**做成代码**，而不是写进文档等人遵守 ——
**把安全的路做成最省事的路。**

---

## 二、核心：一个薄壳做四件事

所有派活都必须经过同一个入口（下称"薄壳"），它自动完成四件事：

```
┌─ 派活前 ─────────────────────────────────────────┐
│ ① 提醒发起者：你还有 N 条未关闭的线程            │
│ ② 挡在忙的：被派方正在跑 ⇒ 拒绝，并告诉他等谁    │
│ ③ 落档：handoff 先写进地脉（失败则【不执行】）   │
│ ④ 注入「开工须知」：把宪章指引 + 待办塞进 prompt │
└──────────────────────────────────────────────────┘
        │  执行命令（全量输出落日志）
        ▼
┌─ 派活后 ─────────────────────────────────────────┐
│ ⑤ report 后落档：退出码 / 耗时 / 输出尾巴        │
│    （含被 kill、超时中断 —— trap 兜底）          │
└──────────────────────────────────────────────────┘
```

**调用方无感。**

```bash
dispatch --from agentA --to agentB --thread <线程id> -- <你要跑的命令>
```

---

## 三、消息格式：一个目录就是一个数据库

留档不引入数据库，**一条消息 = 一个 markdown 文件**：

```
leylines/
  mailbox/           未关闭的线程
  mailbox/archive/   已关闭线程（工具照读 —— 归档是搬家，不是删除）
  dispatch-logs/     每次派活的全量输出
  ledger.md          日报
```

一条消息长这样：

```markdown
---
id: 20261013-1415-001
from: codex
to: claude
type: handoff          # handoff | report | question | ack | close
thread: philia-staging-revision
ref: 20261013-1257-001 # report 指回它的 handoff
created: 2026-10-13T06:15:00Z
---

（正文：派了什么、验收标准、相关文件路径）
```

**四种消息类型**：`handoff`（派活）· `report`（回报）· `question`（提问，
**对方必须回**）· `close`（关线程）。

★ **为什么用 markdown 文件而不是数据库**：
**它同时是给人看的和给程序读的** —— 你把 `mailbox/` 扔进 Obsidian 就能读，
用 `grep` 就能查。**人类可读和机器可读不必二选一。**

---

## 四、★ 五个设计判断（这才是这个项目真正的部分）

> 代码 800 行谁都能写；下面这几条是踩出来的。

### ① 留档是派活的**副产品**，不是额外步骤

如果留档需要人多做一步，**它就一定会被跳过**。
所以薄壳把留档**变成执行的必经之路** —— 你只要派活，留档就已经发生了。

★ 对应第一节那句：**别靠记得，把它做成默认。**

### ② **失败关闭**（fail-closed）

留档失败（格式非法、纪律校验拒收、工具缺失）⇒ **命令不直接执行**。

★ 反过来（先执行、留档失败就算了）会让留档**在出问题时恰好缺失** ——
而**出问题时才是最需要留档的时候。**

### ③ 只报警，**不处置**

看门狗到点**只发一条 report 说"已运行 N 秒未完成，请人工确认"，不杀进程。**

★ 起因是一次真实的误判：有人**误判一个正在跑的 agent"僵死"**，差点建议杀掉它。
⇒ **"看起来停了"和"真的停了"是两件事。**
**误杀不可逆，漏报可补 —— 所以机制选择不处置。**

### ④ **宁可漏报，不要误报**

"裸跑哨兵"的判据**只看时间序**（有执行器在跑、且它的启动时间**晚于**最后一次留档），
**不看"有没有未关闭的 handoff"。**

★ 因为后者会被**"发起人已离场、没人关的老线程"永久静音** ✗
（实测：地脉里躺着 5 条这样的线程，机制**整个失效**）。

### ⑤ **边是显式的、可枚举的**

"谁可以派给谁"写在一处常量里（`HANDOFF_EDGES`），非法派活**直接拒绝**。

```js
const HANDOFF_EDGES = ['pi>claude', 'zcode>codex', 'claude>codex',
                       'codex>claude', 'codex>dsh', 'dsh>claude'];
```

★ 好处是**报错时可以把当前合法边列给你** —— 不用背，也不会绕开。
★ 而且**加边是一次显式的决定**（什么时候、为什么、谁批的，都留在修订记录里）。

---

## 五、伪代码

```python
# ── 薄壳 ────────────────────────────────────────────
def dispatch(src, dst, thread, argv, force=False):
    # ① 提醒未关闭线程（软提醒，不阻塞）
    unread = unread_check(src, quiet=True)
    if unread:
        warn(f"你有 {len(unread)} 条未关闭的线程：{unread}")

    # ② 挡在忙的（除非 --force）
    hb = heartbeat(dst)
    if hb and hb.event.startswith("dispatch/") and not force:
        die(f"{dst} 正在跑（{hb.event}），等它结束或加 --force")

    # ③ 落档 —— 失败则【不执行】
    handoff = leylines_send(from_=src, to=dst, type="handoff",
                            thread=thread, body=render(argv))
    if not handoff:                     # ★ fail-closed
        die("留档失败，命令未执行")

    # ④ 注入开工须知
    prompt = preface(src) + original_argv_text

    # ⑤ 执行 + report
    try:
        code, out = run(argv, prompt=prompt)
    finally:                            # ★ trap 兜底：被 kill / 超时也要留档
        leylines_send(from_=dst, to=src, type="report",
                      ref=handoff.id, exit_code=code, tail=tail(out))


# ── 哨兵（每小时）────────────────────────────────────
def escalate():
    # 往返熔断：一个 thread 里 handoff+return ≥ 6 仍未关
    for th in threads(open_only=True):
        if th.handoff_count + th.return_count >= 6:
            inbox_append("dsh", f"往返 {th.id} 已达 6 次，未关闭")

    # 裸跑哨兵：只看时间序（★ 见设计判断 ④）
    last = last_archived_time()
    for proc in find_executors():       # claude -p / codex exec / ...
        if proc.started_at > last + GRACE:
            inbox_append("dsh", f"疑似裸跑：{proc.cmd}")
```

---

## 六、已知的坑（都是踩出来的）

| 坑 | 症状 | 处理 |
|---|---|---|
| **变量后跟中文标点** | `FROM：你有: unbound variable` —— bash 把标点当成变量名的一部分 | 一律写 `${VAR}` |
| **心跳只有 detach 路径** | 同步派活时显示的是**上次**的旧心跳，误判"没在跑" | 同步路径也要写 start/tick/end |
| **`pgrep` 只匹配一种形式** | `claude -p` 匹配不到 `claude --resume <id> -p`，误报"没在跑" | 匹配要覆盖所有调用形式 |
| **`--report-to` 默认自己** | `from == to`，自相矛盾 | 相等时跳过 report，只记日志 |
| **不确定"到底停没停"** | —— | ★ **只报警，不处置**（见判断 ③） |

★ 这些坑有一个**共同的形状**：
**"两条路径只改了一条"** —— 加了新入口，忘了老入口也是入口。
**所以加任何机制时，先问一句：这个机制有几条路径？**

---

## 七、这套东西没做什么

诚实起见：

- **它不保证 agent 的输出质量** —— 只管协作的**留痕与秩序**；
- **它不防止人绕过** —— 它只让"绕过的成本 > 走正门的成本"；
- **它假设 agent 能跑命令** —— 纯聊天式 agent 用不上；
- **它没有 UI** —— 所有东西都是文件，**用 Obsidian 或 grep 看**。

---

## 八、命名

`Teyvat`（提瓦特）· `Leylines`（地脉）—— 名字来自《原神》，
**因为作者是个二游玩家**。功能到位就行，中二不影响它工作。

★ 命名只影响心情，不影响可靠性 —— **但心情好的时候，人更愿意维护它。**

---

## License

MIT
