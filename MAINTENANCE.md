# 内容与站点维护指南

这份文档说明《人生进阶指南》的日常维护、验证、预览、发布和回滚流程。

## 书稿结构

当前中文主线按“从提出问题到完成交付，再回到生活”的阅读弧线组织：

- 序章：建立作者立场与阅读契约；
- 终身学习与 AI：把问题、基线、练习、交付、验证和复盘连成系统；
- 基础能力：英语：用词汇、听说读写和 CEFR 目标打开输入；
- 实践、复盘与恢复：记录创业、关系、失败、身体与重新出发；
- 行动章节：用模板、项目和复测把方法变成可见证据；
- 旧文归档与词表：保留来路，但明确哪些内容只属于历史语境。

新增章节先判断它的读者任务和证据类型，再同步更新 `docs/.vitepress/navigation.mjs`、中英文入口和 frontmatter。不要只把新文章堆进“杂谈”或“扩展”栏目。

## 子项目：english-practice 应用

- `apps/english-practice/` 是独立的高考英语练习 PWA（Vue 3 + Dexie + Workbox），依赖、lockfile、lint 与测试配置均独立于书稿根项目。
- 应用校验在其目录内运行 `npm run check`（内容门禁 + typecheck + lint + 单测）；E2E 运行 `npm run test:e2e`；发布冒烟运行 `npm run test:smoke`。
- 应用 CI 见 `.github/workflows/english-practice-ci.yml`：push 仅在 master 分支且路径命中 `apps/english-practice/**` 时触发；根 `deploy.yml` 已忽略 `apps/**` 与 `planning/**`，app 改动不触发全书部署。
- `BUILD_SHA` 约定：构建与冒烟步骤都注入 `${{ github.sha }}`，本地留空即为 `unversioned`；冒烟脚本会拒绝非 40 位十六进制的污染值。
- 内容管线：`content/inbox/`（来源留档）→ `content/items|resources|units`（结构化）→ `content/pack-manifests/`（打包清单）→ `npm run content:build` 生成 `public/content-packs/` 与 `public/content-catalog.json`（只保留当前 manifest 版本；同版本内容不可变，改内容必须提升版本号）。
- 发布门禁：`npm run content:release`；审核缺项与题量/覆盖缺口以 exit 78 暂缓（CI 放行并提示），schema/素材/工具错误仍硬失败。

## 环境与命令

- 使用 Node.js 24，版本约束见 `.nvmrc`、`.node-version` 和 `package.json`。
- GitHub Actions 使用 Node.js 24 兼容的官方 major 版本；升级 action 前先查对应仓库的 release，升级后运行 CI、Pages 部署和外链检查。
- 首次安装运行 `npm ci`。
- 本地开发运行 `npm run docs:dev`。
- 完整校验运行 `npm run check`。
- 生产构建运行 `npm run docs:build`；构建完成后会自动检查搜索索引、框架和主题脚本的原始与 gzip 体积预算。
- 本地预览生产产物运行 `npm run docs:preview`。
- 端到端测试运行 `npm run test:smoke`。

## 导航与生成文件

`docs/.vitepress/navigation.mjs` 是中英文导航的唯一来源。修改导航后运行：

```bash
npm run sync
```

该命令会同步：

- 根目录 `SUMMARY.md`；
- `docs/SUMMARY.md`；
- `docs/en/SUMMARY.md`；
- 根目录 `README.md`；
- 英文词表镜像；
- VitePress `public` 分享图。

CI 会再次生成这些文件，并阻止未提交的差异进入主分支。
同步脚本还会检查每个导航条目的字段、重复链接和 `source` 文件是否存在；路径写错时会在 `npm run check:navigation` 阶段失败。
它还会反向检查 `docs/` 下的所有公开 Markdown 是否都被中英文导航收录，避免新页面成为孤岛。

Playwright 的 `test-results/` 和 `playwright-report/` 只保存失败诊断与 HTML 报告，属于生成文件，不是书稿内容；它们已被 Git 和 Markdown lint 忽略。测试失败后可以安全清理，再重新运行 `npm run check`。
本地会话凭据文件 `docs/assets/session.json` 被精确加入 `.gitignore`，并由 VitePress 开发服务器、构建钩子和浏览器烟测共同拦截；任何本地会话文件都不得进入仓库或站点产物。

本地搜索按读者任务控制索引粒度：第二至第五部保留 H2 级入口；第一部已经按技能拆成独立页面，工具模板、术语、归档和词表使用页面级入口。H3 正文仍会并入所属页面或 H2，因此关键词不会消失。代码块不进入倒排索引，避免复制用工作表和重复示例放大下载体积。调整规则后必须运行 `npm run docs:build`，并确认 `check:bundle` 通过。

## 内容规则

- 每个公开中文页面必须有完整英文对应页，反之亦然。
- 中英文对应页的一级至六级标题顺序必须一致；翻译可以不同，但章节结构不能漂移。
- 中英文对应页的 `updated` 日期必须一致；它表示稿件版本同步，不代替 `sources_checked` 的外部资料核验日期。
- 页面必须提供 `title`、`description` 和 `updated` frontmatter。
- 研究结论、个人经验和推测应明确区分。
- AI 产品、模型能力、政策、价格和考试规则必须注明资料日期，并优先引用官方来源。
- 图片必须有描述场景或用途的替代文本；`image`、`photo`、`hotel` 等占位词会被内容校验拒绝，英文页面的 alt 也不得混入中文字符。图片不得包含 GPS、EXIF、IPTC 或 XMP 元数据。构建会为本地位图自动注入真实宽高以预留版面，外链图片和 SVG 不推测尺寸。
- 英文正文应优先使用英文表达；语言切换标签、书名/产品的官方原名和无法可靠翻译的专名可以保留原文，并在需要时提供英文解释。
- 站内链接使用 VitePress 干净路径，不新增 `#/` 路由；旧 hash 链接仅由兼容脚本处理。
- 外部素材必须登记在 `ATTRIBUTIONS.md`，无法确认再分发权限时不进入仓库。
- `check-content.mjs` 会验证归属表中明确写出的本地路径；删除或移动素材时必须同步更新登记，合法 glob 路径除外。
- `check-content.mjs` 还会检查 `docs/assets/` 中的图片和 SVG 是否被正文、配置或构建脚本引用；归属表和变更记录不会把文件伪装成正在使用的资产。
- `check-content.mjs` 会检查 Git 跟踪清单，拒绝 `.DS_Store`、`Thumbs.db` 和 `desktop.ini` 等系统元数据；本地忽略文件不会被删除。

## 章节发布门禁

每次新增或大幅改写页面，都按下面顺序检查：

1. **确定页面类型**：方法、个人叙事、项目披露、历史归档或模板；不同类型不要混用同一套证据标准。
2. **标记事实层级**：研究结论写来源与适用条件，个人经历写视角和误差，计划与推测明确标为待验证。
3. **核对动态信息**：产品、模型、价格、政策、考试规则和外部链接保留核验日期；没有重新检查时，不要把日期伪装成最新状态。
4. **完成隐私审查**：确认第三方授权、最少必要细节、删除请求和公开范围；健康、法律、财务与安全内容必须写清专业支持边界。
5. **同步双语语义**：英文页不逐字翻译，但必须保留任务、限制、证据等级和风险提示；新增页面必须加入 `navigation.mjs` 和烟测路由。
6. **运行发布命令**：按顺序执行 `npm run sync`、`npm run check`、`npm run docs:build` 和 `npm run test:smoke`，检查生成文件差异后再提交。烟测会从导航 source 自动生成中英文页面覆盖。

## 外链与日期策略

- 外链是任务入口，不是永久承诺；优先使用官方、稳定、可公开访问的页面，避免短链和带会话签名的地址。
- 链接失效时，保留原任务和难度，替换为同一来源的当前页面或明确标注“历史归档”；不要为了保留数量而堆入新链接。
- 平台返回 403、需要登录或依赖一次性签名的旧链接，不作为主要证据入口；保留事实背景时，改用稳定的本地章节或明确标注不可复查范围。
- AI 产品资料的 `sources_checked` 必须在 120 天内；功能、地区和套餐变化时，重新检查页面和正文措辞。
- `updated` 表示稿件文字被修改，`sources_checked` 表示外部资料被核验，两者不能互相替代。
- 公开文章、截图和个人故事只提供线索，不自动成为独立测评、客户案例或收益证明。

## 发布流程

1. 运行 `npm ci`、`npm run check`、`npm run docs:build` 和 `npm run test:smoke`。
2. 在拉取请求的 `site-preview` 构建产物中检查待发布站点。
3. 合并到 `master` 后，由 GitHub Pages Actions 工作流部署。
4. 部署后检查中文首页、英文首页、代表性章节、搜索、语言切换和旧 hash 跳转。

仓库的 Pages 发布源必须保持为 **GitHub Actions**，不要切回 `master:/docs` 的 Legacy 模式；`deploy.yml` 会在发布后请求中文首页、英文首页和代表性章节，并校验每个入口的期望标题与当前提交的 `build-revision`。正文使用 VitePress clean URLs，文章入口按无尾斜杠路径检查；任何公开入口返回非成功状态、错误页面或旧构建标识都会使部署失败。

Pages 发布组启用 `cancel-in-progress`：快速连续提交时，旧的构建或部署会被取消，只允许最新提交继续发布。需要回看旧版本时，应从 Git 历史或 CI 构建产物查看，不要依赖线上页面暂时保留旧内容。

GitHub Actions 不包含分析脚本、广告或用户追踪器。

## 定期维护

- 每周定时任务检查外链；Douban、`token.love` 和 `ku0.com` 由浏览器 User-Agent 的独立 `curl` 探针检查，Lychee 负责其余外链。第三方站点短暂失败不会阻塞普通提交，但会留下可追踪的自动 issue。
- 每月至少检查一次 AI 章节；超过 120 天未更新会被内容校验阻止。
- 每季度检查依赖、安全公告、素材授权和无障碍回归。
- 合并图片前先运行 `npm run assets:sanitize`，再执行完整校验。

## 回滚

迁移前的 Docsify 版本保留在 Git 历史提交 `42e6faa` 中，包括原 `docs/index.html`。若新站点发布后出现路径或索引故障，优先在 GitHub Pages 中重新运行上一次成功部署；需要恢复旧站时，从该提交创建临时回滚分支并部署其 `docs/` 目录，不覆盖当前内容分支。

回滚后应保留故障页面、URL、浏览器和时间信息，再修复 VitePress 构建并通过预览产物验证后重新发布。
