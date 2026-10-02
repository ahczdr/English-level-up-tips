# 内容缺口清单（发布门禁转绿路线图）

生成时间：2026-09-30，依据 `npm run content:release` 的 P07 实际输出。发布门禁当前为 **exit 78 暂缓态**：以下缺口全部补齐且逐题独立审核通过后，`content:release` 才会 exit 0，届时 CI 的 Release content gate 通知即消失。

## 一、数量缺口（P07_QUANTITY）—— 2026-10-01 全部关闭

生成批次：词汇 131 族 × 3 = 393 题、组句 24 题、听力 20 段合成语音 + 40 题、七选五 6 篇、完形 8 篇（10/10/10/15/15/20 空）、语法填空 10 篇 × 10 空、应用文 3 篇、读后续写 3 篇。真题单项填空不计入「词汇族平行题」口径（门禁已修正）。**P07_QUANTITY 与 P07_COVERAGE 全部清零。**

## 二、覆盖缺口（P07_COVERAGE）—— 2026-09-30 更新

已关闭：词汇族覆盖（131 族全部 3 平行题）、听力录音（20 段 macOS 语音合成本地 m4a，含 transcript 与解析证据）。

剩余：

- 阅读：材料 ≥18 篇，且 G0/G1/G2 每层级各 ≥6 篇（同一材料不得跨层级重复计数）。
- 七选五：≥6 篇材料。
- 完形：10 空、15 空两档各 ≥4 篇。
- 语法填空：≥12 篇。

## 三、审核缺口（REVIEW_MISSING，642 条）

现有 119 个条目均无 `content/sources/review-log.csv` 的独立审核通过记录（机器自检不替代审核）。补齐路径：

1. 按包逐题人工复核，逐行追加 `packId,version,itemId,author,reviewer,reviewedAt,result,notes`；
2. `reviewer` 不得与包作者相同；`result=pass`；`reviewedAt` 为过去时刻的 ISO 时间；
3. 任一 `fail` 记录都会拦截该条目（B2 口径）。

## 四、完成后的验收动作

```bash
npm run content:release   # 期望 exit 0
npm run check             # 单测/typecheck/lint 全绿
npm run test:e2e          # 浏览器回归
npm run test:smoke        # 发布构建冒烟
```

状态：以上建议均已于 2026-09-30/10-01 完成。发布门禁现处于最终形态——**唯一剩余是逐题独立审核记录（REVIEW_MISSING）**，需真人按包逐题复核后录入 review-log.csv（作者≠审核人），录入完成即 exit 0。
