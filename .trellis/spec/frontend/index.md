# Frontend 层索引（web/，无框架单页）

| 文件 | 主题 |
| --- | --- |
| [app-map.md](app-map.md) | app.js 状态变量、渲染管线、模块函数地图 |
| [i18n.md](i18n.md) | 令牌绑定式 i18n 与 locales.json 规则 |
| [player.md](player.md) | 全局播放器状态机与回退链 |
| [presence.md](presence.md) | 安装状态双通道（index/check）三态模型 |
| [catalog-ui.md](catalog-ui.md) | 目录同步的 UI 状态机（启动卡片/静默 toast/冷却） |
| [reviews-tags.md](reviews-tags.md) | 评论浮层/内嵌双呈现、60s 刷新冷却、标签系统 |

## 文件构成与拼装

`index.html`（模板：CSP + 全部静态结构 + 占位标记）+ `interface.css` + `chart-card.js`（卡片构建）+ `app.js`（全部业务）→ 后端 `assemble_web_template`/`render_page` 拼成**单文件内联页面**，占位符注入运行时配置（`__SPINSHARE_RUNTIME_CONFIG__` 等 4 个，各恰好一次）。改前端**不需要**碰后端，但别引入新静态资源（CSP `default-src 'none'`，图片只允许 spinsha.re/CDN/data:）。

## 数据形状

目录行经 `compact()` 压成数组 `[id,title,subtitle,artist,charter,uploadDate,diffs[[kind,rating]...],minRating,meta]`，`meta[8]` = `{cover,thumbnail,fileReference,previewReference,updateHash,views,downloads,uploader,dlc,tags,description}`——前端一切展示/安装/预览都从这个形状出发，字段校验失败静默降级（空串/null）。

## 硬规矩（来自 PRODUCT/DESIGN，实现已就位）

- 查询不增浏览量：谱面数据只来自 searchCharts 缓存；评论经 `/api/song/{id}/reviews`（不计数）；用户档案 `/api/user/{id}`、搜索 `/api/searchUsers` 仅在上传者搜索范围时用。
- 无 HTML title 原生 tooltip；图标按钮必须有 aria-label/aria-description。
- 文字选择规则：普通内容可选择，承担点击的只可点击；折叠态只负责展开。
- 动效节奏固定：150/180/220/280ms（feedback/standard/panel/expressive），`prefers-reduced-motion`、页面隐藏时全部直切。
