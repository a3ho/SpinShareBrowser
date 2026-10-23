# 谱面目录缓存（ChartCatalogCache）

## 唯一数据源

`POST https://spinsha.re/api/searchCharts`（全难度、showExplicit、空查询）——**绝不调用** `/api/song/{id}` 详情（会计浏览量）。数据 = 全站谱面行数组。90 秒总限、32MiB 上限、Content-Length 校验、`read1` 流式读取防慢速拖死。

## 文件格式（charts-cache.json，schema 3）

```
schemaVersion:3, lastAttemptAt, fetchedAt, refreshError, data,
automaticFailureCount, automaticLastAttemptAt, automaticNextAllowedAt,
automaticRefreshError, automaticErrorCode
```
- schema 1/2 是历史版本，加载时**保守迁移**到 3（不缩短任何未完成的冷却）。
- 两个通道状态**同文件持久**：手动冷却（lastAttemptAt + 10 分钟）与自动退避（5m/15m/1h/6h 递增）互不覆盖。
- 进程内另有 monotonic 时钟副本（`monotonic_until`/`automatic_monotonic_until`），系统改时钟不能缩短冷却。

## 手动通道（manual_update）——"预约协议"

顺序是刻意的，别改：
1. 冷却未过：有数据返回元数据（200），无数据 409 charts_cooldown。
2. **本地预检**：先把当前状态原样重写一遍（证明可写、可被替换），失败不发请求。
3. `_fetch_chart_catalog` 先 `connection.connect()`（DNS+TCP+TLS），**连接成功后、发请求字节前**回调 `begin_remote_attempt`：把 `lastAttemptAt=now` + "请求未完成"占位错误原子落盘。写不进就不发请求。→ 此后进程崩溃/重启，冷却仍在。
4. 401/403（明确便宜拒绝）→ `release_cheap_rejection` 回滚到第 2 步的原状态，立即可重试。
5. 连接阶段失败（DNS/TCP/TLS，从未发字节）→ 不留冷却。
6. 其它一切失败（限流/5xx/超时/传输中断/响应超大/无效/落盘失败）→ 冷却保留。
7. 成功：新数据先原子落盘再发布到内存；失败绝不以内存新数据冒充已保存数据。

## 自动通道（automatic_update）

- 触发条件：无数据 或 `fetchedAt` 超 12 小时（`stale`）；手动冷却中不让自动通道绕过（返回 manual_cooldown）。
- `afterInstall=True`（2.1.1 新增）：安装后发现"本地内容不同"时提前重核，但合并到 `max(自动退避, fetchedAt+10min)` 的节流里，成功不记自动失败。
- 失败写 `automaticFailureCount+1` 和下次允许时间（先落盘再请求，同预约思想）。
- 成功清空全部自动失败状态 + 手动 refreshError。

## 活动/进度（activity）

`_set_activity`/`_progress` 维护 `{syncing, phase: idle|connecting|receiving|saving, syncChannel, bytesReceived, contentLength}`——`/v1/charts/status` 轮询给前端启动对话框显示真实已收 MB，不伪造百分比。

## 判错码

`charts_access_denied / charts_rate_limited / charts_request_timeout / charts_server_error / charts_request_rejected / charts_invalid_response / charts_response_too_large / charts_response_incomplete / charts_remote_timeout / charts_network_error / charts_cache_error`——前端 CHART_ERROR_TEXT / CHART_TOAST_ERROR_TEXT 一一对应。

## 测试锚点

tests/test_chart_cache.py（35 用例）用 monkeypatch 假 `_fetch_chart_catalog`/`_atomic_write` 验证协议时序；改这里先跑它。
