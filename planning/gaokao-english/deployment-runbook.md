# 部署手册（deployment-runbook）— gaokao-english v0.1

> T16。发布静态产物为 `apps/english-practice/dist`。**默认不修改原书稿 GitHub Pages 地址**；选择用户已有可用 HTTPS 托管入口，独立部署。发布前必须取得实际发布授权（见 §7）。

## 0. 发布前置门禁（全部满足才允许执行 §3）

| 门禁 | 命令 | 期望 |
| --- | --- | --- |
| 内容/类型/静态检查 | `npm run check` | exit 0 |
| 生产构建 | `npm run build:release` | exit 0，dist 生成 |
| **发布内容门禁（T15）** | `npm run content:release` | **exit 78（2026-09-29 已发布 0.2.0：审核缺项与题量缺口暂缓，完整性/素材/工具错误仍硬失败）** |
| 发布冒烟 | `npm run test:smoke` | SMOKE OK |
| E2E（E2E 构建） | `npm run test:e2e` | 29+2 全绿（离线产物断言已迁入冒烟） |

**状态（2026-09-29）：正式 catalog 已发布**（15 个包 published，anhui 0.2.0 / listening 1.1.0）。此后仅审核缺项与题量/覆盖缺口以 exit 78 暂缓；schema、素材、工具错误仍硬失败，出现硬失败时禁止发布。

## 1. 构建

```bash
cd apps/english-practice
BUILD_SHA=<git-commit-or-dist-digest> npm run build:release
BUILD_SHA=<同上> node scripts/collect-release-info.mjs   # 生成 dist/release-info.json
```

- `BUILD_SHA`：有 git 仓库时取 `git rev-parse HEAD`；主仓库已有完整提交历史（HEAD 见 git log），可用 dist 内容摘要或发布批次号，但**必须与手机页面「设置 → 关于与版本」显示一致**。
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

v0.2.0 已由维护者确认发布（2026-09-29，个人学习用途）；后续公开发布前仍需按 §3 复核授权与门禁；允许的动作仅限：受控环境（内网/本地）部署用于真机验收（device-matrix.md）与七天试用（T17）。

## 8. 本地真机验收入口（2026-10-01 增补）

`npm run build:release` 后运行 `npm run serve:lan`，预览服务会监听本机所有网卡（0.0.0.0:4174）；同一 Wi-Fi 下的手机/平板访问 `http://<电脑局域网IP>:4174` 即可执行 device-matrix.md 的场景行。注意：这是明文 HTTP 局域网入口，仅用于验收，不替代 §3 的正式 HTTPS 发布。

## 9. Cloudflare Pages 上线（2026-10-01 选定路线 A）

仓库侧已就绪：`apps/english-practice/wrangler.toml`（项目名 gaokao-english-practice）、`public/_headers`（index/sw/catalog 不缓存，assets 与内容包长缓存 immutable，已随构建进入 dist）。

面板操作（一次）：

1. Cloudflare Dashboard → Workers & Pages → Create → Pages → Connect to Git → 选 fork 仓库 ahczdr/English-level-up-tips，分支 `codex/gaokao-english-local-release`（或合并后的 master）。
2. 构建设置：
   - Build command：`cd apps/english-practice && npm ci && npm run build:release`
   - Build output directory：`apps/english-practice/dist`
   - 环境变量：`NODE_VERSION=24`、`BUILD_SHA=${CF_COMMIT_SHA}`
3. Save and Deploy。首次部署后按 device-matrix.md 在真机过八个场景。

注意：仓库根 `.node-version=24` 会被 Cloudflare 识别；`CF_COMMIT_SHA` 是 Cloudflare 内置变量，符合 smoke 的 40 位十六进制要求。
