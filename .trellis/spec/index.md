# SpinShare Browser — GLM 认知库索引

> 这是 GLM 对本项目的深度认知库。动代码前按层加载，避免从源码重新推导。
> 内容全部来自 2026-10-23 的全量源码精读，关键机制标注源函数名（行号会漂移，一律不标）。

## 项目一句话

Windows 桌面工具：浏览/试听/安装/管理 spinsha.re（Spin Rhythm XD 社区谱面站）的谱面。
Python 本地服务（127.0.0.1 随机端口）+ WebView2 单页界面（四个 web 文件拼装成内联页面）。
中英双语，MIT 许可，发布在 github.com/a3ho/SpinShareBrowser，只保留最新稳定版。

## 层地图（按需读）

| 层 | 什么时候读 |
| --- | --- |
| [backend/](backend/index.md) | 改任何 `src/*.py` 之前（API、缓存、安装、窗口、维护、音频） |
| [frontend/](frontend/index.md) | 改任何 `web/*` 之前（状态模型、渲染管线、播放器、安装状态、评论） |
| [release/](release/index.md) | 构建、发版、打包、测试、CI 之前 |
| [guides/](guides/index.md) | 本地调试怎么做、红线是什么 |

## 一图流（数据从哪来到哪去）

```
spinsha.re /api/searchCharts  ──(手动/自动同步)──▶  charts-cache.json (状态目录)
                                                        │ GET /v1/charts（只读）
                                                        ▼
                                              web/app.js  compact() → 本地筛选/搜索/标签/排序
                                                        │
spinsha.re /api/song/{id}/download ──▶ installer.py 下载队列 → ZIP 白名单校验 → 事务化安装
                                                        │                     → Spin Rhythm XD Custom 目录
CDN _0.ogg/_0.mp3 ──▶ 顶栏全局播放器；都失败 → audio_preview.py 读本机 Steam 游戏 OGG（只读直传）
```

## 权威文档优先级

产品行为契约在 `PRODUCT.md`，视觉/交互契约在 `DESIGN.md`（含大量 superseded 历史，只认非 superseded 部分），版本历史在 `CHANGELOG.md`。本 spec 库是这三者的**机制层补充**（怎么实现的、坑在哪），冲突时以 PRODUCT/DESIGN 为准并向用户确认。
