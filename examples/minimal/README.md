# 最小实现（可跑）

> **目标：30 分钟内，你手上能有一个会留档的派活薄壳。**
>
> 三个文件 · 不到 300 行 · 只用 Node 和文件系统。
> **不需要数据库、不需要服务、不需要装任何依赖。**

## 跑起来

```bash
cd examples/minimal
chmod +x src/dispatch.sh

# ① 派一次活（它会自动留档）
./src/dispatch.sh --from alice --to bob --thread demo-001 -- echo "hello from bob"

# ② 看地脉里落下了什么
node src/leyline.mjs list
node src/leyline.mjs show <上一步输出的 handoff id>

# ③ 看心跳 / 未关闭线程
node src/leyline.mjs open --agent alice

# ④ 跑一次哨兵（生产上是 cron 每小时跑）
node src/sentinel.mjs
```

跑完你会看到：`leylines/mailbox/` 里多了一个 `.md` 文件，
`leylines/logs/` 里多了这次执行的**全量输出**。

## 三个文件各自干什么

| 文件 | 行数 | 干什么 |
|---|---:|---|
| `src/leyline.mjs` | ~150 | **消息层**：发消息 / 读消息 / 列未关闭 / 心跳 |
| `src/dispatch.sh` | ~90 | **薄壳**：四件事（提醒 / 挡忙 / 落档 / 注入）+ 执行 + report |
| `src/sentinel.mjs` | ~60 | **哨兵**：往返熔断 + 裸跑检测（★ 只报警不处置） |

## 落地到真实系统时要改的三处

1. **`AGENTS`** —— 你的 agent 名单（`leyline.mjs` 顶部）。
2. **`HANDOFF_EDGES`** —— 谁能派给谁。★ **要显式、可枚举，非法派活直接拒绝。**
3. **执行命令** —— 这里用 `echo` 演示；真实场景换成 `claude -p` / `codex exec` 等。

★ **其余的照抄即可。**

---

## ★ 实测输出（这个最小实现真的跑过）

```console
$ ./src/dispatch.sh --from alice --to bob --thread demo-001 -- sh -c 'echo "hello from bob"; echo "第二行"'
▶ handoff 20261014-1342-001 → 日志 leylines/logs/20261014-1342-001.log
✓ 完成（退出码 0）

$ node src/leyline.mjs list
[  ] 20261014-1342-001  alice→bob  handoff  demo-001
[  ] 20261014-1342-002  bob→alice  report  demo-001     ← ★ report 自动落档 ✓

$ cat leylines/logs/20261014-1342-001.log
### command: sh -c echo "hello from bob"; echo "第二行"
### started: 2026-10-14T05:42:49Z
hello from bob
第二行
```

**★ 非法边会被拒绝，并把合法边列出来：**

```console
$ ./src/dispatch.sh --from alice --to carol --thread bad -- echo hi
✗ 留档失败: 非法派活边 alice>carol
  当前合法边：
    alice>bob
    bob>carol
    carol>alice
✗ 留档失败，命令【未执行】（fail-closed）
```

**★ 被派方在忙时会被挡下来：**

```console
$ ./src/dispatch.sh --from alice --to bob --thread busy -- echo hi
✗ bob 正在跑（dispatch/working @ 2026-10-14T05:42:50.114Z）—— 等它结束，或加 --force 强行派
```

**★ 退出码约定**（★ 让调用方可以判断发生了什么）：

| 退出码 | 含义 |
|---:|---|
| 0 | 正常（其实是**被调命令**的退出码原样传出）|
| 2 | 参数不全 |
| 3 | 被派方在忙（未加 `--force`）|
| 4 | **留档失败 ⇒ 命令未执行**（fail-closed）|

**★ 而 fail-closed 是实测过的** —— 故意用非法边派一条 `touch` 命令，
**文件确实没有生成** ✓。
