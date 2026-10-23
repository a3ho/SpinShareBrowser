# 本地端到端调试手册（GLM 实测方法，2026-10-23 验证）

## 起隔离实例（不弹窗口、不碰正式数据）

```bash
# 状态目录必须绝对路径（安全校验拒绝相对路径——真踩过）
.venv/Scripts/python.exe src/spinshare_portable.py \
  --state-dir "<项目绝对路径>\tmp\agent-debug" --no-browser
```

## 拿密钥入口

```python
import json, http.client, pathlib
state = pathlib.Path('tmp/agent-debug')
token = json.loads((state/'config.json').read_text(encoding='utf-8'))['token']
port  = json.loads((state/'runtime.json').read_text(encoding='utf-8'))['port']
conn = http.client.HTTPConnection('127.0.0.1', port, timeout=5)
conn.request('GET', '/v1/health', headers={'Origin':'null','X-SpinShare-Key':token,'X-SpinShare-Native':'1'})
ui_path = json.loads(conn.getresponse().read())['uiPath']   # → http://127.0.0.1:<port><ui_path>
```

native 头三件套（Origin:null + X-SpinShare-Native:1 + token）可直调任何端点做后端调试。

## 浏览器验证（我能"看见"界面）

ZCode 浏览器控制（browser-use skill）打开 UI URL →
- `domSnapshot()` 读可访问性树（比截图便宜，先看结构/状态/disabled）；
- 真实点击/输入/等待异步（例：等"筛选谱面"按钮 enabled = 启动同步完成）；
- `screenshot()` + `emitImage` 截图进视觉上下程（看布局/配色/渲染问题必须用这个）。
首次打开会触发真实 searchCharts 同步（联网、几 MB、不计数）——是设计内行为，可接受。

## 收尾

```bash
# 优雅关掉实例（空闲时）：对 /v1/shutdown POST {}（native 头）；或直接结束后台任务
```
调试产物都在 tmp/agent-debug（gitignored），可整目录删。

## 各层调试入口速查

- 后端单测瞄准：`python -m unittest tests.test_chart_cache -v`（按文件点名）
- 前端单测瞄准：`node tests/test_audio_player.cjs`
- 窗口原生部分（自定义边框/托盘/toast）普通浏览器看不到 → 靠 test_desktop_frame/test_desktop_notifications + 必要时 Win32 截真实窗口
- 安装/卸载真机验收只能在隔离 Windows runner（windows_smoke.py 拒绝工作站）
