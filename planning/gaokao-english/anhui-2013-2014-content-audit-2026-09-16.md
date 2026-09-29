# 安徽高考英语 2013、2014 结构化内容审计

日期：2026-09-16
审计范围：2013、2014 安徽高考英语公开原卷的非听力部分
审计状态：`draft-structured`

## 1. 覆盖情况

| 年份 | 单项填空 | 完形填空 | 阅读理解 | 语篇填空 | 书面表达 | 听力 |
| --- | ---: | ---: | ---: | ---: | ---: | --- |
| 2013 | 21-35（15） | 36-55（20 空） | 56-75（20） | 76-85（10 空） | 1 题 | 原卷已归档，音频未接入 |
| 2014 | 21-35（15） | 36-55（20 空） | 56-75（20） | 76-85（10 空） | 1 题 | 原卷已归档，音频未接入 |

每年均已拆成 5 个独立草稿包：单项填空、完形填空、阅读理解、语篇填空和书面表达。复合题按应用模型保存为一个题目记录，但保留实际空数或题数，不能按记录数误算覆盖量。

## 2. 答案序列核对

答案序列来自各年份原卷长图中的参考答案页，用于结构化后的机器抽查。

### 2013

- 21-35：`C C B A C D A D D B D C A B B`
- 36-55：`C D A B C D C A B C B A B A A D B D B A`
- 56-75：`D D C B C B D D A A B A C A B A D C C B`
- 76-85：`looking/searching/seeking; forward/ahead/on; experts/researchers; steps/ways; greatest; express; sharing; focus/concentrate; feeling/mood/sense; these/those`

### 2014

- 21-35：`B D D C A A C A C D B B C B D`
- 36-55：`A B C D D C B A A B C D D C B D B C C D`
- 56-75：`B D B C D B A C B A C A A C C D A D C D`
- 76-85：`relevant; most; realize/know/recognise/recognize; basis; use; technology; comfortably; kinds/types/sorts; ranges; enjoyed/loved/liked`

## 3. 机器验证结果

- `npm run content:check`：通过，15 个作者内容包（preview）。
- `npm run content:build`：通过，生成 31 个不可变内容版本包。
- `npm run test:unit`：通过，30 个测试文件、291 个测试。
- `npm run test:e2e`：通过，29 个浏览器回归测试、3 个离线测试。
- 2013/2014 年语法、完形、阅读六组答案序列审计：全部通过。
- `git diff --check`：通过。

2014 年第 30 题答案已按参考答案页修正为 D（`would have thrown`），并将语法题包版本从
`0.1.0` 升为 `0.1.1`，遵守内容版本不可覆盖规则；2013 年第 53 题同样已修正并升为
`0.1.1`。

## 4. 发布边界

这些包全部保持 `status: draft`。原因不是机器结构不完整，而是仍缺少：

1. 每道题的原图页段/坐标级证据和独立复核记录；
2. 听力音频、听力原文和可核验授权；
3. 原题内容的再分发授权确认。

因此，当前结果已经可以作为个人本地练习和审核工作包使用，但不能宣称为已授权、已发布的“高中三年正式题库”。

## 4. 发布记录（2026-09-29）

- 项目维护者确认本批公开附件纳入个人学习用途的正式内容包；`content/inbox/anhui-gaokao/README.md` 与 `content/sources/catalog.json` 的权利说明同步更新，保留来源出处。
- 全部 15 个 manifest 转为 `published`（作者与审核人分离：导入作者 + 维护者复核），版本号 minor 提升（anhui 包 0.2.0、listening 1.1.0）。
- 真题条目引入的 38 个细粒度 skillIds 已映射回 T15 钉死的 26 技能目录（粗粒度训练抓手，见下表要点）：`vocabulary.*→vocab.*/grammar.*`、`sentence.*→sentence.core/grammar.tense`、`grammar.细类→grammar.tense/clause/word-form/infinitive`、`reading.*→reading.detail/main-idea/inference/cohesion/word-meaning`、`writing.*→writing.task`。映射只影响训练归类，不影响判分。
- `content:release` 现仅剩 REVIEW_MISSING / P07 数量与覆盖缺口（exit 78 暂缓，符合 CR31 设计）；UNKNOWN_SKILL 与 CATALOG_DRIFT 清零。
