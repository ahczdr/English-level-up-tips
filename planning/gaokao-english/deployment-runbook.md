# 部署手册（deployment-runbook）— gaokao-english v0.1

> T16。发布静态产物为 `apps/english-practice/dist`。**默认不修改原书稿 GitHub Pages 地址**；选择用户已有可用 HTTPS 托管入口，独立部署。发布前必须取得实际发布授权（见 §7）。

## 0. 发布前置门禁（全部满足才允许执行 §3）

| 门禁 | 命令 | 期望 |
| --- | --- | --- |
| 内容/类型/静态检查 | `npm run check` | exit 0 |
| 生产构建 | `npm run build:release` | exit 0，dist 生成 |
| **发布内容门禁（T15）** | `npm run content:release` | **exit 0（当前 BLOCKED：独立审核未完成）** |
| 发布冒烟 | `npm run test:smoke` | SMOKE OK |
| E2E（E2E 构建） | `npm run test:e2e` | 29+3 全绿 |

**content:release 未转绿（独立审核未完成）前，禁止发布正式 catalog**；只能发布 draft 演示环境（内网/受控入口）用于真机验收与试用，且页面须可辨识「预览内容（未审核）」标记（应用已内置 draft 徽标）。

## 1. 构建

```bash
cd apps/english-practice
BUILD_SHA=<git-commit-or-dist-digest> npm run build:release
BUILD_SHA=<同上> node scripts/collect-release-info.mjs   # 生成 dist/release-info.json
```

- `BUILD_SHA`：有 git 仓库时取 `git rev-parse HEAD`；本仓当前无提交历史（工作树未纳管），可用 dist 内容摘要或发布批次号，但**必须与手机页面「设置 → 关于与版本」显示一致**。
- `dist/release-info.json`：应用版本 / build SHA / 内容包版本与摘要，随托管产物归档（发布批次对账凭证）。

## 2. 产物清单与缓存头（可更新缓存策略）

| 路径 | 缓存策略 | 说明 |
| --- | --- | --- |
| `/sw.js` | `Cache-Control: no-cache` | SW 必须每次可更新（T12 prompt 更新依赖） |
| `/content-catalog.json` | `Cache-Control: max-age=60` | SW 内部已 network-first（4s 超时回退缓存），HTTP 头仅兜底 |
| `/index.html` | `Cache-Control: no-cache` | shell 入口 |
| `/assets/*`（带 hash） | `Cache-Control: public, max-age=31536000, immutable` | 指纹文件长期缓存 |
| `/content-packs/<id>/<version>/*` | `Cache-Control: public, max-age=31536000, immutable` | 课程版本不可变（T15 纪律） |
| `/icons/*`, `/manifest.webmanifest` | `max-age=86400` | |

- **混合内容**：页面全部资源同源相对路径（catalog `./content-packs/...`），HTTPS 域名下无 http:// 引用；上线前用浏览器 DevTools Security 面板核查一次。
- **部署路径**：v0.1 以**域名根路径**部署为准（catalog/SW fetch 使用 `/content-catalog.json` 绝对路径）；子路径部署需改 base 与 fetch 前缀，不在首版承诺内。
- 托管无法自定义头（如对象存储静态站）时的折衷：仅确保 `sw.js` 与 `index.html` 不被长缓存（至少 ≤60s），其余按默认；记录在发布批次备注。

## 3. 发布流程（取得授权后）

1. 按 §0 完成门禁，归档 `dist/release-info.json`。
2. 归档当前线上版本：`dist-archive/<当前-buildSha>/`（回滚用，见 §6）。
3. 上传 `dist/` 全量到托管入口；SW 与 catalog 不预热（首次访问自动注册）。
4. 发布后核查（桌面 + 手机各一次）：页面「设置 → 关于与版本」的 应用版本/build SHA/包版本 与 `release-info.json` 一致；DevTools → Application → Service Workers 状态 activated。

## 4. 手机页面确认版本（不能只看构建日志）

- 路径：**设置 → 关于与版本**：应用版本、构建 SHA（8 位）、每个内容包 `id@version · sha256 前 8 位`。
- catalog 获取失败时页面显示「版本信息不可用」——按故障处理，不得口头代报版本。

## 5. 浏览器与安装降级

- iOS Safari：分享菜单 → 添加到主屏幕（PWA standalone）。
- 国产安卓浏览器（微信内置/部分厂商浏览器）可能不提供 PWA 安装入口：**仍以网页方式使用**（地址栏直接访问；离线能力以浏览器支持为准），不阻塞使用。
- 主屏幕与浏览器标签页共用同一 IndexedDB 库（同源）；T13 备份导出/恢复用于跨浏览器迁移。

## 6. 回滚

- 静态产物：将 `dist-archive/<上一-buildSha>/` 重新上传/切回软链接。SW 更新是 prompt 制：回滚后用户端出现更新提示并保留旧壳直至确认。
- **个人数据不回滚**：IndexedDB schema 向前兼容（T03/T13 schemaVersion 门禁），回滚静态产物不清除、不降级用户库；损坏恢复走 T13 备份。
- 课程更新保持不可变版本：catalog 回滚仅改指针（回到旧 catalog 即用旧包），已下载的新版本包在本地仍可用。

## 7. 发布授权

v0.1 未获得公开发布授权前，本手册 §3 不执行；允许的动作仅限：受控环境（内网/本地）部署用于真机验收（device-matrix.md）与七天试用（T17）。
