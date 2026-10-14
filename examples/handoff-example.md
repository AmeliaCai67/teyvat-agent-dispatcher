---
id: 20260101-0900-001
from: agentA
to: agentB
type: handoff
thread: example-thread
ref:
created: 2026-01-01T09:00:00Z
---

## 任务

把 `src/hero.tsx` 里的硬编码颜色换成设计 token。

## 验收标准

- 不改变视觉输出（可用截图对比）
- 不留任何十六进制色值
- 改完跑 `npm test`

## 相关文件

- `src/hero.tsx`
- `styles/tokens.css`
