# 安装状态模型（presence，前端 + 后端核对端点）

## 三态 + 两个"未定"值

`installationPresence(row)` 返回：
- `true` 精确已安装（本地 MD5 == catalog updateHash）
- `false` 确认未安装
- `'different'` 同 fileReference 但哈希不同（含个人修改的可能，绝不称"有更新"）
- `undefined` 正在核对中（UI 显示"正在核对安装状态…"）
- `null` 无法核对（settingsStale / 任务进行中 / fileReference·updateHash 非法）——**不是**未安装

筛选语义：installed = true+different；uninstalled = 仅 false；different = 仅 'different'；未知永远被排除并计数提示。

## 双通道核对

1. **整目录清单**（常规）：`POST /v1/installations/index` 一次枚举安装目录全部 `.srtb` 返回 `{fileReference: md5}`；前端 `installationIndexValue()` 在内存里匹配候选。失败（共享锁/权限/恢复需处理/超时）→ `presenceProblem`，**保留上次确认状态**，绝不降级为未安装。
2. **单曲定向**（安装完成后）：`POST /v1/installations/check` 单首核对，立即可更新卡片不等队列；失败退回清单刷新。

触发点：窗口 focus（refreshInstallationChecks）、翻页/滚动批次、基础筛选提交、安装/删除完成后精准失效、目录变更整体失效。首次尚无清单且有合法引用 → 显示核对中。

## 缓存与失效

- `installedCharts[songId] = {key: installationKey(row), value, pending}`——key 绑定 settingsRevision+fileReference+updateHash。
- `installationMutationGeneration`：任何安装/删除/换代 +1；`readInstallationPresence` 里代号不匹配的批次回队列重排（防旧清单覆盖新事实）。
- `publishInstallationIndex` 用清单批量落值；被删/在途的记录跳过。
- 2.1.1：`settleInstallationPresence` 里安装完成但 check 结果 = 'different' → 置 `catalogInstallRecheck` → `scheduleAutomaticCatalogSync()`（afterInstall 通道，后端节流到 max(退避, fetchedAt+10min)），刷新后仍以**实际文件哈希**判定——真实差异不被自动抹除；缓存换代时 `publishCatalogResult` 的 externalRefresh 分支使旧安装状态全部失效重核。

## 互锁（interlock）

- 安装请求结果未明（requesting）或任务活跃 → 该卡片删除禁用；删除队列活跃 → 全部安装禁用（后端同样互斥 409 installer_busy）。
- `updateInstallationView` 是每卡片唯一渲染出口：状态文字、按钮标签/禁用、删除按钮可见性（仅 exact installed）、进度条、note（含 different 的覆盖提示文案）。

## 删除流（前端）

`startDeletion`（仅 presence===true）→ `deletionQueue` → `drainDeletionQueue` 串行 POST delete → `completeDeletion`（installed-only 视图卡片淡出）→ `settleDeletion`（精准失效 + 视图/计数/标签候选/页码刷新 + 焦点仅在被删卡片时转移）。失败 `failDeletion`：noteInstallationMutation 使 index 失效、delete_partial 上通告、重核实际状态。

## 首装目录确认

`requestInstallation`：config.installDirectoryConfirmed=false → 弹确认对话框（完整路径 + 修改目录 + 确认并继续）；确认成功持久化后才放行下载；服务端对未确认/旧 revision 一律 409 硬拦截（前后端双重）。
