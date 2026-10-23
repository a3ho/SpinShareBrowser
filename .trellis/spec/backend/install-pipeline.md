# 安装管线（installer.py）

## 队列模型（JobManager）

- 有界：MAX_ACTIVE_JOBS=128（活跃+等待），MAX_STORED_JOBS=256（保留已完成结果），QueueFullError→429。
- DOWNLOAD_WORKERS=2 并发下载线程 + 1 个串行安装线程；MAX_READY_ARCHIVES=2 个预取槽（含等待安装的 ZIP）；全局下载连接信号量 4。
- 单任务 15 分钟 deadline（下载段计时，等待安装线程不消耗）。
- requestId 幂等：同 requestId 重复 submit 返回同一 job；songId 不同则拒绝。

## 下载（download_archive）

- `GET https://spinsha.re/api/song/{id}/download`——这是**唯一**允许碰的计数接口（用户明确点了下载）。
- 重定向仅允许 → `https://spinsha.re` 或 `https://spinshare.b-cdn.net`:443（OfficialRedirects，≤3 跳）。
- Content-Type 必须是 zip 三种之一；Content-Disposition 文件名必须匹配 `spinshare_[a-f0-9]{1,64}.zip`，否则用 `spinshare-download-<id>.zip`；队列模式加随机后缀防并发同名。
- 512MiB 上限；`read1` 读防慢速；is_zipfile 预检；临时文件 → fsync → `os.replace`。

## ZIP 白名单校验（_archive_plan）

合法结构**只有**：根级恰好一个 `spinshare_<ref>.srtb` + 可选 `AlbumArt/<ref>.png` + 可选 `AudioClips/<ref>_<n>.(ogg|mp3)`；目录只允许 AlbumArt/AudioClips。拒绝：路径穿越/Windows 非法名/保留名、casefold 重复、加密位、链接/特殊文件、目录项类型不符、单文件 512MiB/总解压 2GiB/条目 4096、CRC 由 `_copy_member` 全量读出时验证。

## 事务化安装（install_archive）——两阶段提交

阶段一（staging）：全部成员写到同目录 `.spinshare-stage-<rand>.tmp`，fsync；已有原文件先备份到 `.spinshare-rollback-<rand>.tmp` 并记录身份。
**事务文件** `.spinshare-install-transaction.json`：`{phase: installing|committed, archive:{path,identity}, files:[{target,temp,backup,old,new,oldMode}]}`，`identity = [dev,ino,size,mtime_ns,sha256]`。Windows 下用 `MoveFileExW(WRITE_THROUGH|NO_BUFFERING)` 保证映射先于任何原文件替换到达磁盘。
阶段二（commit）：逐个核对目标身份未变 → 原→备份（`_move_absent`，rename 的"目标必须不存在"语义防竞态）→ 暂存→目标。
异常时：已 committed 就当成功收尾；否则走恢复或 `_rollback`；回滚不完整报"部分原件无法恢复，备份保留"。
成功后 `_recover_transaction(phase=committed)` 清理暂存/备份/ZIP/事务文件。

## 崩溃恢复（recover_installation → _recover_transaction）

- 谁调用：PortableManager 每次安装/核对/删除/索引前的 `_recover_installation()`、`install_archive` 开头、UI 空闲核对。
- 先**全体预检**（任何文件身份与事务记录不符 → 全部保留备份报 RecoveryError），再按 `.srtb` 优先的顺序恢复。
- installing 相：目标已是 new → 挪回去当暂存继续；有备份 → 恢复原文件+原权限；否则核对必须是 old 或不存在。
- committed 相：只清理（目标必须仍是 new），不动已完成的安装。
- 预检发现"目标=new 且暂存也在"等冲突 → 明确报需要人工处理，绝不猜。

## 删除（delete_chart_files）

前提：调用方（PortableManager.delete_installation）已经核对 `.srtb` 的 MD5 精确匹配 updateHash。流程：`.srtb` 先暂存 → **暂存态**再验一次 MD5（关闭"点删除瞬间文件被改"的窗口）→ 封面 + 全部 `AudioClips/<ref>_<n>.*`（≤4096、casefold 冲突拒绝）逐个暂存 → 全部成功才逐个删备份；`.srtb` 的备份最后删（清理失败时优先恢复谱面文件）。部分不可恢复 → DeletePartialError。

## 目标目录防护（_root/_owned/_no_link）

一切路径先 `_owned(root, path)`：相对路径必须在 root 内、逐级类型核对、`commonpath` 防.resolve 逃逸；拒绝 root 本身被覆盖/删除；拒绝链接/硬链接。`validate_target`（PortableManager）另拒绝安装目录与状态目录/程序目录互相包含。

## 上限速查

archive 512MiB / unpacked 2GiB / 单文件 512MiB / 4096 条 / chart 单文件 32MiB / 索引 4096 条·512MiB·8s / 目录条目 65536。

## 测试锚点

test_install_pipeline / test_install_recovery(13) / test_download_transport / test_install_queue / test_chart_deletion(19+JS) / test_installation_status。
