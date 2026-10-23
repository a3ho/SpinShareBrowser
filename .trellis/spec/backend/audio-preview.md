# 音频预览（audio_preview.py + spinshare_portable 的预览端点）

## 回退链（前端主导，后端只负责第三级）

1. CDN `https://spinshare.b-cdn.net/uploads/audio/<ref>_0.ogg`（15s 加载边界）
2. 失败 → `_0.mp3`（只回退一次）
3. 再失败 → 本地游戏音频解析（本文件）：`POST /v1/preview/resolve` → 随机短期 URL → `/v1/preview/audio/<48hex>` 只读流。

前两级是静态 CDN 文件，**不增加**静态谱面请求；第三级也不碰任何计数接口。

## 解析（resolve_preview）

1. `_load_chart(reference)`：GET `https://spinshare.b-cdn.net/uploads/srtb/<ref>.srtb`（静态 SRTB，12s 上限、32MiB 上限、重定向直接报错）。
2. `_game_clip`：解析 JSON，取 `largeStringValuesContainer.values` 里 key=`SO_ClipInfo_ClipInfo_0` 的唯一条目 → `clipAssetReference.{bundle,m_guid}`。bundle 为空/"CUSTOM" 或 GUID 不合法 → `preview_unavailable`（**不是**游戏未装的意思——上传音频缺失不能推断用户需要装游戏）。
3. Steam 定位 `_game_directories`：
   - 候选 = 安装目录及其 ≤6 级父目录（游戏装在谱面目录旁边的场景）+ 注册表 SteamPath（HKCU/HKLM 32/64）+ ProgramFiles 猜测；
   - `libraryfolders.vdf` 解析全部 library（自写 VDF 字符串提取器，256KiB 限制）；
   - `appmanifest_1058830.acf`（Spin Rhythm XD 的 Steam AppID）校验 appid 后取 installdir；
   - 候选必须 `resolve(strict)` 且同时有 `SpinRhythm.exe` 和 `SpinRhythm_Data/`。
4. 找 `<guid>.ogg`：`SpinRhythm_Data/StreamingAssets/` 与 `dlc/StreamingAssets/`；`_valid_audio`：解析后路径必须在游戏根内、普通文件、nlink==1、58B–256MiB、头 64 字节含 OggS + vorbis/OpusHead 标记。
5. 找不到 → `game_audio_not_found`（前端文案"请检查游戏安装"）。

## 发放与流式（spinshare_portable）

- `PortableManager.resolve_preview`：2 并发信号量；缓存键 = (fileReference,updateHash)+revision，命中要 `preview_file_signature`（dev,ino,size,mtime_ns）仍匹配；新 URL = `secrets.token_hex(24)`（48hex），存 `preview_sources`（≤32 条，6h 过期，LRU 逐出）。
- `_preview_audio` handler：媒体元素无法带鉴权头，放行条件 = loopback + Host 精确 + `Sec-Fetch-Dest: audio`；4 并发流信号量；打开时再验签名 + 前 4 字节 OggS；单 Range 支持（206/416/200）；`Cross-Origin-Resource-Policy: same-origin`。
- 安全要点：**只读直传**——不复制、不转码、不改游戏文件；URL 随机短期且绑定单一文件；路径永不暴露给前端。

## 坑

- `updateHash` 允许为空串（目录里没有时）；缓存绑定 revision，切目录/换版本后旧解析作废（409 → 前端提示重试）。
- 解析线程**不持**安装锁（远程查 SRTB 和扫 Steam 库可能慢），只在写入 preview_sources 前回锁复核 revision/退出态。
