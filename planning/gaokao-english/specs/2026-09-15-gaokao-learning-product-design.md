# 高考英语个人学习工具设计

**目标：** 将现有本地优先的练习原型升级为适合高中生长期使用的高考英语个人学习工具。

## 范围与取舍

本轮包含四部分：修复答题草稿和跨日学习数据；建立高中三年课程目录与可扩充题库；补齐课程安装/更新入口；重构移动端视觉和信息层级。保留 IndexedDB、本地备份、PWA 和离线包，不引入账号、云同步、排行榜或 AI 批改。

内容以“课程骨架 + 首批可审核样例”为交付：题库元数据覆盖高一基础、高二强化、高三冲刺三阶段，按词汇、语法、阅读、完形、七选五、听力、应用文和读后续写组织。首批内容必须标明 draft/未审核；正式发布仍由既有独立审核与数量门禁决定，不能用自动生成内容冒充正式高考题。

## 关键行为

- choice、order、gaps 三种客观题均使用统一 draft answer 保存和恢复；草稿不生成 Attempt。
- session.studyDay 表示计划所属日；Attempt 和复习调度使用提交时按个人时区计算的实际学习日。
- 已安装课程页提供检查更新；新版本并存，旧会话继续读取其引用的旧版本。
- 首页只有一个主要行动：开始今天 5 分钟练习；继续会话、复习和课程管理作为次级入口。
- UI 使用高对比蓝紫主色、暖色进步反馈、44px 以上触控目标、清晰的 loading/empty/error/success 状态，并为 360px 宽屏保留可读性。

## 文件职责

- `src/domain/curriculum.ts`：高中三年阶段、栏目和学习目标的展示元数据。
- `content/curriculum/gaokao-three-years.json`：可审阅的课程目录和首批内容规划。
- `src/services/learning.ts`：学习日的统一计算和作答调度。
- `src/features/practice/SessionPage.vue`：所有题型的草稿生命周期。
- `src/services/content.ts` 与 `src/features/learn/LearnPage.vue`：课程安装和版本更新。
- `src/styles.css` 与首页/课程/成长页面：移动端设计系统和页面层级。
- `tests/unit`、`tests/e2e`：行为回归和关键用户路径。

## 验收标准

1. 客观题退出、暂停、刷新重开后答案一致；不会多出 Attempt。
2. 跨日恢复的提交按实际学习日统计，复习 dueDay 不沿用旧 session.studyDay。
3. 新用户可以从空库直接到第一题；已有用户可以检查并安装新课程包。
4. 高中三年目录可在课程页按年级/阶段/技能理解，内容状态和审核状态透明。
5. 360px、390px、768px 宽度无横向溢出；主要触控目标不小于 44px。
6. `npm run check`、`npm run test:e2e`、`npm run test:smoke` 通过；`npm run content:release` 在未完成独立审核和正式题量前继续明确失败。
