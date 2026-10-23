# 目录同步 UI（catalog-sync-*）

## 启动序列（startCatalogRuntime）

1. GET /v1/charts（只读缓存）。有数据且 12h 内 → 直接放行，排个自动同步定时器。
2. 无数据 / 过期 / charts_cache_missing → `showCatalogSyncLoading` 模态卡片（背景压暗、工具不可操作）→ `automaticCatalogSync(startup=true)`：
   - 进度：`startCatalogStatusPolling` 每 500ms GET /v1/charts/status 读后端 activity（connecting/receiving/saving + bytesReceived/contentLength）→ `updateCatalogSyncProgress`（有总长显示确定进度条，否则不定进度 + "已收 X MB"真实数字）。
   - 成功 → `showCatalogSyncSuccess`（短确认 620ms 自动退场）→ 解锁筛选。
   - 失败**有旧数据** → `showCatalogSyncError`：结构化键值行（手动重试/可重试时间/当前数据）+ [重试][使用本地数据]。
   - 失败**无数据** → [重试][退出应用]（无 X、无跳过——不能让用户进入空表伪装成功）。

## 运行期

- 手动"更新数据"按钮：`manualCatalogSync` → toast（"已更新"/"已是最新"）；冷却中后端返回 outcome=cooldown → toast 显示"可用时间"键值。按钮旁问号帮助（悬停/聚焦显示，说明 12h 自动同步 + 10 分钟手动间隔）。
- 自动同步：`maybeRunAutomaticCatalogSync`（focus/visibility 恢复/定时器触发，due = max(staleAt, 自动退避, 手动冷却)）；托盘无窗口时由后端 native toast 报告（前端这个 toast 只在窗口可见时用）。
- `publishCatalogResult`：任何响应带回**更新的 fetchedAt**（哪怕本请求没改变服务器数据——可能是托盘通道拉的）→ externalRefresh=true → 派生缓存全失效（cacheGeneration++）+ rebuild。"changed" 才 toast"已更新"。
- toast 有暂停/恢复（hostVisible/hidden）、4.2s、悬停延长；失败 toast 带双键值行（重试状态/当前数据），且区分"仅冷却未到"与真实错误。

## 与查询的关系

筛选/搜索/排序/翻页**永不**触发联网目录更新（apply 只读内存 catalog；无 catalog 的兜底 GET 是唯一例外，注释写明仅供孤立 reload）。catalogStartupBusy 时筛选控件全部禁用（syncFilters 的 busy 位）。
