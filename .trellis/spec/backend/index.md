# Backend 层索引（src/*.py，Python 宿主）

| 文件 | 主题 |
| --- | --- |
| [architecture.md](architecture.md) | 进程模型、启动链路、线程、状态目录、单实例 |
| [local-api.md](local-api.md) | 本地 HTTP API：端点表、鉴权、请求校验、错误码 |
| [catalog-cache.md](catalog-cache.md) | charts-cache.json 双通道同步：冷却、退避、预约协议 |
| [install-pipeline.md](install-pipeline.md) | 下载→校验→事务化安装→崩溃恢复；删除管线；队列模型 |
| [desktop-host.md](desktop-host.md) | WebView2 窗口、自定义边框、托盘/toast、关闭流 |
| [maintenance.md](maintenance.md) | 安装器协作：升级/卸载、门锁、所有权标记、清理 |
| [audio-preview.md](audio-preview.md) | 游戏音乐回退：SRTB→GUID→Steam 定位→只读流式 |

## 模块依赖方向

`spinshare_portable.py`（入口+API）→ `installer.py`（安装）+ `audio_preview.py`（音频）；`desktop.py`（窗口）与 `maintenance.py`（维护）都 import 前两者。`desktop.run(application)` 是有窗口模式的真正主循环；`--no-browser` 模式只跑 `application.serve_forever()`。

## 跨模块不变量

1. 所有状态文件 IO 走 `_directory_guard`/`_safe_info`/`_atomic_write`（spinshare_portable）——符号链接/reparse point/硬链接一律拒绝，Windows 下用句柄钉住祖先目录防换名。
2. JSON 一律 `_parse_json`（拒绝重复键、拒绝 NaN/Infinity 常量）；序列化 `_json_bytes`（紧凑、无 NaN、尾换行）。
3. 一切对用户可见的错误消息都是英文原文 + 前端 locales.json 翻译；错误经 `APIError(status, code, message)` 结构化。
