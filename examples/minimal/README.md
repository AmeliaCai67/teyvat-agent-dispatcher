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
