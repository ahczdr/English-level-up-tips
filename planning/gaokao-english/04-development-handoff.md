T15「正式课程包生产与独立审核」工具与门禁部分完成：固定 26 skillIds 目录（content/sources/skills.json + RELEASE_SKILL_IDS 钉死）、P07 规模/覆盖门禁（checkP07 既有）+ 平行题干唯一性检查、30 次学习计划（learning-plan-30.json：24 新课×5 目标 + 6 复测，长文不进 <10 分钟任务）、review-log.csv 8 字段交叉验证（pass + reviewer≠author + 时间有效，逐 item 全审才放行）；release-gates.ts 纯函数 + 9 项单测（TDD）；draft 平行变体 vocab-join-b 起步。独立评审（B1-B4 阻塞 + R1-R10）已闭环：B1 独立性校验 normalize+author 交叉比对、B2 任一 fail 即拦、B3 ISO+拒未来时间、B4 CI release-smoke 接入 content:release（T16 部署前必须转绿）；R4 26 技能全覆盖门禁、R5 跨包平行题干、R7 修复门禁逮出的真实缺陷 listening.gist（版本 bump 1.0.1）并删孤儿脚手架、R9/R10 测试加固（15 项含对抗性钉死）。实测：check **245/245**、test:e2e **29+3 全绿**、content:check exit 0、content:release **exit 1 且仅剩 11×REVIEW_MISSING**（设计内正确：无独立审核人不填虚构记录，正式 catalog 不出）。详见 verification-log 十八章 18.5。**未完成移交**：718 项正式内容与 20 段录音（15-25 日人工）、逐题/逐段独立审核——机器自检不等于审核完成。

T16「HTTPS 部署准备与真机验收」可自动化部分完成：构建版本可确认（vite define 注入 __APP_VERSION__/__BUILD_SHA__ + 设置页「关于与版本」块 + scripts/collect-release-info.mjs 生成 dist/release-info.json）；planning/gaokao-english/deployment-runbook.md（发布门禁表/缓存头/混合内容/根路径口径/发布流程/回滚/发布授权——content:release 未转绿前禁止发布正式 catalog）与 device-matrix.md（四类真机×8 场景逐行矩阵，待真机执行）就绪。期间收敛了并发出现的 profileId 贯穿修订（AttemptRecord/Exposure + CR3 packs 读缓存 + v2 迁移回填）并如实记录 db.spec 截断事故与重建。随后经上下文无关子代理静态评审（同会话生成，非独立第三方；独立复跑 unit 与 dist 逐字节核验）发现 B1（SW 缺 SKIP_WAITING 监听器）与 B2（BUILD_SHA/release-info 链不可复现）并已修复：sw.ts 补 message→skipWaiting 监听、smoke 门禁校验 dist/sw.js 含 SKIP_WAITING；build:release 串接 collect-release-info.mjs、CI 注入 BUILD_SHA=github.sha、smoke 校验 release-info.json 与 BUILD_SHA 一致；R1 失败态仍显示构建期版本、R2 跨 profile 独立判定语义修正（Dexie 不支持改主键，注释入 migrations）、R4 矩阵补 iPad/安卓平板行、R5 db.spec fallback 断言精确化。最终门禁：check **260/260**、test:smoke **SMOKE OK**（含新门禁）、test:e2e **29+3 全绿**。**未验证移交**：四类真机全部场景行、回滚演练、HTTPS 托管入口与发布授权、content:release 门禁（T15 审核未完成）。

T17「七天试用与 v0.1 验收」可自动化部分完成：planning/gaokao-english/pilot-report.md 建立（每日记录协议、阻塞判定、P09 逐条真实状态、D1-D7 占位不伪造）；第 7 天平行题抽取自动化（src/services/pilot-day7.ts 纯函数 + scripts/pilot-day7.ts CLI + npm run pilot:day7，同 family/同技能/同层级/未曝光、确定性可复现，缺口如实标注）；验证：check **265/265**。**v0.1 不标注完成**（P09-3 内容审核、P09-6 真机、P09-8 试用记录均未完成，结论与局限预置）。

至此 03-implementation-plan T01-T17 全部任务的可自动化部分完成。剩余全部为人工移交：七天真人试用与每日记录（需真实用户）、第 7 天平行题实际抽取（试点备份产生后跑 pilot:day7——评审 B1 修复后 CLI 已兼容 envelope 备份格式并校验摘要，空输入/旧 schema 会明确报错）、四类真机验收矩阵、音频人工听辨与截图目视复核、CI 实际 runner 验证、718 项内容生产与独立审核（content:release 转绿）、HTTPS 托管选择与发布授权、回滚演练。

## 后续模型工作协议

1. 先读取本文档以及 `01-product-and-curriculum.md`、`02-data-and-behavior.md`、`03-implementation-plan.md`。
2. 先确认实际 cwd、分支、Node/npm 版本和 git 状态。
3. 每个任务先由 GPT-5.6 Sol 给出范围和验收标准。
4. OpenCode 开发任务必须明确使用 `opencode-go/glm-5.3`，返回文件、命令、测试和风险；模型输出需由实际 diff 和测试验证。
5. 改代码前先写/补测试；改动保持在任务范围内，不回滚用户已有改动。
6. 完成后运行聚焦测试、`npm run check`、`npm run build` 和相关 E2E，再由 Sol 独立验收。
7. 不把静态检查、Mock/fake-indexeddb 或本地构建证据表述成真实部署、真实数据库、第三方服务或生产内容已验证。