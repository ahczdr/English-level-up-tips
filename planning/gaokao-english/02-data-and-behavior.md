# 数据与行为契约

本文件中的类型和规则是首版实现契约；类型代码在 T02 写入应用，当前不是已实现的 SDK。根路径均为 `apps/english-practice/`。

## D01 工程与依赖

应用拥有独立 `package.json` 和 `package-lock.json`，暂不改根目录为 npm workspace。运行依赖：Vue、Vue Router、Dexie、Zod。开发依赖：Vite、Vue 插件、TypeScript、vue-tsc、Vitest、Vue Test Utils、jsdom、fake-indexeddb、Playwright、vite-plugin-pwa、workbox-precaching、ESLint 及 Vue/TypeScript 配置。

不照搬原书稿的旧 Vite 版本约束。T01 用 Node 24 校验所选版本的 engines、peer dependencies 和生产构建，所有依赖使用精确版本写入应用包文件，不使用长期漂移的 latest。运行时不加载第三方 CDN 字体或脚本。

目录结构：

```text
src/app/router.ts
src/app/App.vue
src/components/{AppButton,FeedbackPanel,AudioPlayer,PassagePanel}.vue
src/content/{types,schema,validate,repository}.ts
src/domain/{answers,calendar,scheduler,planner,progress}.ts
src/data/{db,migrations,backup}.ts
src/services/{learning,writing,downloads}.ts
src/features/onboarding/OnboardingPage.vue
src/features/today/TodayPage.vue
src/features/learn/LearnPage.vue
src/features/practice/{SessionPage,ChoiceTask,GapTask,OrderTask}.vue
src/features/writing/WritingPage.vue
src/features/review/ReviewPage.vue
src/features/progress/ProgressPage.vue
src/features/settings/{SettingsPage,DownloadsPage,BackupPage}.vue
src/pwa/{register,sw}.ts
content/{profiles,sources,units,items,resources}/
scripts/{check-content,build-packs}.ts
tests/{unit,e2e,fixtures}/
```

大括号表示分别创建文件，不能实际创建带大括号的文件名。视图不直接操作 IndexedDB，所有写入经服务层，纯规则不依赖 Vue。

## D02 内容类型

以下定义复制到 `src/content/types.ts`，Zod schema 必须严格对应并拒绝未知字段。ID 只允许 `[a-z0-9][a-z0-9._-]{0,95}`；版本为三段数值语义版本。

```ts
export type Level = 'G0' | 'G1' | 'G2';
export type Section = 'vocabulary' | 'sentence' | 'reading' |
  'gap-reading' | 'cloze' | 'grammar' | 'listening' |
  'application-writing' | 'continuation';
export type Status = 'draft' | 'reviewed' | 'published';
export type ReviewMode = 'recognition' | 'recall' | 'transfer';
export interface Option { id: string; text: string }
export interface Source {
  id: string; kind: 'original' | 'licensed' | 'official-reference';
  title: string; url: string | null; rightsNote: string;
}
export interface Resource {
  id: string;
  paragraphs: Array<{ id: string; text: string }>;
  audioAssetId: string | null;
  transcript: string | null;
}
export interface Asset {
  id: string; path: string; mime: 'audio/mpeg' | 'image/webp';
  bytes: number; sha256: string;
}
export interface Explanation {
  summaryZh: string; ruleZh: string;
  evidence: Array<{ resourceId: string; paragraphId: string; quote: string }>;
  distractors: Array<{ optionId: string; reasonZh: string }>;
}
export interface CommonItem {
  id: string; familyId: string; skillIds: string[];
  level: Level; section: Section; reviewMode: ReviewMode;
  promptZh: string; resourceId: string | null;
  estimatedSeconds: number; sourceIds: string[];
  explanation: Explanation;
}
export interface ChoiceItem extends CommonItem {
  kind: 'choice'; options: Option[]; answerOptionId: string;
}
export interface OrderItem extends CommonItem {
  kind: 'order'; tokens: Option[]; acceptedOrders: string[][];
}
export interface TextPolicy {
  caseSensitive: boolean; allowTerminalPunctuation: boolean;
}
export interface Gap {
  id: string; label: string; clue: string | null;
  options: Option[]; accepted: string[];
  explanationZh: string;
}
export interface GapsItem extends CommonItem {
  kind: 'gaps'; inputMode: 'text' | 'options';
  sharedOptions: Option[]; uniqueOptions: boolean;
  segments: Array<
    { type: 'text'; text: string } | { type: 'gap'; gapId: string }
  >;
  gaps: Gap[]; policy: TextPolicy;
}
export interface WritingItem extends CommonItem {
  kind: 'writing'; wordRange: [number, number];
  requirementsZh: string[]; openingSentences: string[];
  checklistZh: string[]; modelAnswer: string;
}
export type Item = ChoiceItem | OrderItem | GapsItem | WritingItem;
export interface Unit {
  id: string; titleZh: string; familyIds: string[];
  itemIds: string[]; prerequisiteSkillIds: string[];
}
export interface CoursePack {
  schemaVersion: 1; id: string; version: string;
  titleZh: string; status: Status;
  author: string; reviewer: string | null; reviewedAt: string | null;
  profileIds: string[]; sources: Source[];
  assets: Asset[]; resources: Resource[]; items: Item[]; units: Unit[];
}
export interface ExamProfile {
  id: string; nameZh: string; region: string | null;
  examYear: number | null; verified: boolean;
  sourceUrls: string[]; checkedAt: string | null;
  enabledSections: Section[]; allowMockExam: boolean;
  scoring: null | { total: number; sections: Array<{
    section: Section; maxScore: number; itemCount: number;
  }> };
}
```

七选五使用 `gaps`、`inputMode=options`、共享 7 个选项、`uniqueOptions=true`；5 个 gap 各接受对应选项 ID。完形使用每个 gap 自己的 options，`uniqueOptions=false`。语法填空使用 text，每个 gap 的 accepted 为可接受文本，不使用正则或任意代码评分。

阅读/听力用 choice，多题共享同一个 Resource；从 Resource 自动组成不可拆的调度组。听力 Resource 必须有音频；字幕直到显式请求才显示。不得把英语听力脚本放入可见题干。

写作 `modelAnswer` 只有显式请求才显示，该动作记录为辅助。续写可带两条 openingSentences；应用文为空数组。wordRange 是当前训练任务目标，不被宣称为所有地区的考试要求。

每个评分类 family 的平行题可有多个 Item；同一个 Item 所有历史引用通过 pack ID + version + item ID 定位。题文、答案或解析改变必须发布新包版本，旧会话继续绑定旧包。内容目录保证至少有 1 个备用平行题；数量不足时不能声称独立迁移已测。

## D03 内容结构校验

`validatePack(pack, purpose)` 的 purpose 为 `preview` 或 `release`。预览允许 draft 和无 reviewer；release 必须 published、实际 reviewer、reviewedAt ISO 日期、author 与 reviewer 不同，且满足 P07 内容数量与覆盖检查。整个首版语料集合统计发布最低量，不强制每个拆分包包含所有专项。

- ID 在各集合内唯一；source/resource/asset/unit/item/family 外键全部可解析；unit 的 familyIds 等于其 itemIds 对应家族集合。
- 所有对象答案必须非空且在选项中；共享选项和 gap 本地选项互斥；uniqueOptions 时标准答案有可行的一一对应。
- order 的每个 acceptedOrders 必须恰好包含 tokens 的所有 ID 一次；相同单词可以有不同 token ID。
- gap segments 每个 gap 恰好出现一次，不能有孤立空位；options 模式 accepted 为 ID，text 模式 options 与 sharedOptions 都为空。
- choice 有 2-7 个选项且恰好一个标准答案；解释中的 optionId 必须存在。阅读和听力至少一条有效 evidence，quote 是对应段落的精确子串。
- release 状态的完整七选五为 5 空/7 选项；简化教学材料不能标成完整七选五。完形题注明 G0/G1 简化或 G2 完整训练，不据此提供官方计分。
- 听力发布项必须含本地 audio asset 和 transcript，数字语音人工复核；技术测试的假音频不能计入发布数量。
- 禁止 HTML、可执行脚本和任意外部媒体地址；素材 path 只允许 `assets/` 下不含 `..` 的相对路径。
- sha256 是实际二进制的 64 位小写十六进制摘要，bytes 必须与构建文件一致；不接受占位 hash。

## D04 作答与会话类型

在 `src/services/learning.ts` 导出：

```ts
export type Answer =
  | { kind: 'choice'; optionId: string }
  | { kind: 'order'; tokenIds: string[] }
  | { kind: 'gaps'; values: Record<string, string> };
export interface Grade {
  earned: number; possible: number;
  perGap: Record<string, boolean>;
}
export interface ItemRef {
  packId: string; packVersion: string; itemId: string;
}
export interface SubmitCommand {
  id: string; sessionId: string; slotId: string;
  expectedRevision: number; answer: Answer;
}
export type AppErrorCode = 'INVALID_CONTENT' | 'INVALID_ANSWER' |
  'NOT_FOUND' | 'STALE_SESSION' | 'CONTENT_MISSING' |
  'ALREADY_SUBMITTED' | 'STORAGE_FAILED' | 'INVALID_BACKUP' |
  'NEWER_SCHEMA' | 'DOWNLOAD_FAILED' | 'INSUFFICIENT_SPACE';
export type Result<T> = { ok: true; value: T } |
  { ok: false; error: { code: AppErrorCode; messageZh: string } };
export interface Attempt {
  id: string; sessionId: string; slotId: string; ref: ItemRef;
  familyId: string; phase: 'first' | 'correction';
  answer: Answer; grade: Grade;
  assistance: string[]; replayCount: number; audioSpeed: number;
  createdAt: string; studyDay: string; revision: number;
}
export interface Slot {
  id: string; ref: ItemRef;
  state: 'unseen' | 'answering' | 'submitted' | 'skipped';
  assistance: string[]; replayCount: number; audioSpeed: number;
}
export interface Session {
  id: string; profileId: string; unitId: string | null;
  slots: Slot[]; currentIndex: number; revision: number;
  state: 'active' | 'paused' | 'completed';
  createdAt: string; updatedAt: string; studyDay: string;
}
```

初次呈现题目时就保存 exposure，不等答题才保存；exposure 保存 firstSeenSessionId 以区分当前会话首次呈现与历史已见。已看过题目但未提交也不能再当未见题。assistance 是白名单枚举字符串：`translation`、`rule`、`answer`、`transcript`、`model-answer`、`word-bank`、`slow-audio`。组句本身属于有词块支架的题型，只提供对应层次证据。

所有创建/更新时钟由服务层注入 Clock，在测试中固定；UI 不提交可信时间或分数。允许保存草稿但不增加 Attempt；首次答案与 correction 独立存储。空白提交返回 INVALID_ANSWER，多空题允许部分提交，未填空计 0，UI 先确认“仍有未答空位”。

## D05 IndexedDB 数据表

数据库名 `gaokao-english-v1`。应用 schemaVersion 与课程 schemaVersion 分开；用 Dexie 版本迁移，首版 version(1)。

| 表 | 主键/必要索引 | 数据 |
| --- | --- | --- |
| settings | `id` 固定 personal | 年级、目标、默认时长、profileId、timeZone、声音和动画设置 |
| packs | `[id+version]`, status | 校验过的课程 JSON、installedAt、资源可用状态 |
| sessions | `id`, state, studyDay | Session |
| attempts | `id`, `[sessionId+slotId+phase]`, familyId, studyDay | Attempt，索引不代替提交事务 |
| exposures | `[packId+packVersion+itemId]`, familyId | 首次查看时刻、日期和firstSeenSessionId |
| reviewStates | `[profileId+familyId+reviewMode]`, dueDay | stage、lastAppliedDay、dueDay、lapses、参考包与题目 |
| drafts | `[sessionId+itemId]` | 当前正文、保存序号、assistance、更新时间 |
| writingVersions | `id`, `[sessionId+itemId]` | 不可变初稿/修改稿、字数、自评、时间 |
| achievements | `id` | 确定性唯一键、获得时间、来源 |
| downloadJobs | `[packId+version]` | state、verifiedAssets、errorCode |

`attempts.id` 为命令 idempotency key，`achievements.id` 如 `unit:first:<unitId>` 或 `day:<YYYY-MM-DD>`。不依赖按钮 disabled 防止重复计账。

提交事务涵盖 sessions、attempts、reviewStates、achievements：先查已存在命令 ID 并原样返回；否则核对 session.revision，再判题、保存、更新复习、更新 slot 和 revision，一次提交。异常全部回滚。已有 first 时新命令不能写第二次 first；需显式“订正”接口产生 correction。多标签页 revision 冲突时刷新会话，不静默覆盖。

## D06 判题规则

choice 按稳定 ID 判，不按显示顺序。order 按 token ID 序列匹配任意 acceptedOrders。gaps 独立按空判，全部正确才算该调度组通过；组通过率与空级正确率分开。多空组的总可能分等于 gaps.length，choice/order 为 1，写作无客观分。

文本只按下列明确规则归一化，不做模糊相似度、不把错误单词自动修对：

```ts
export function normalizeAnswer(value: string, policy: TextPolicy): string {
  let text = value.normalize('NFKC')
    .replace(/[\u2018\u2019]/g, "'")
    .trim().replace(/\s+/g, ' ');
  if (policy.allowTerminalPunctuation) text = text.replace(/[.!?]+$/, '');
  return policy.caseSensitive ? text : text.toLocaleLowerCase('en-US');
}
```

`TextPolicy` 来自 D02。`gradeAnswer(item: Exclude<Item, WritingItem>, answer: Answer): Grade` 对 kind 不一致抛领域错误，由 service 转 Result；内部不得把字符串注入 DOM。默认 grammar policy 为大小写不敏感、句末标点不忽略；特别考点由内容显式覆盖。

统计“独立首次”要求当前 phase=first、无 assistance、该 item 在本次 session 前未出现过；听力回放/变速另列条件。总体客观率按原子作答项分母汇总，展示题型筛选，不能把它换算成高考分数。

## D07 日期与复习调度

学习日为设置的 IANA 时区下 YYYY-MM-DD，默认 Asia/Shanghai。首次设置时保存，设备跨时区不自动改变；用户改设置仅影响后续新记录，历史不重写。日历天运算对日期字符串的年月日使用 UTC 构造，不对本地时间加 86400000，避免夏令时漂移。

复习规则键包含 familyId 与 reviewMode，辨认不能替代回忆。固定间隔 `[1,3,7,14]` 是每次成功后相对本次学习日的间隔，不是都相对首次学习日。

```ts
export interface ReviewState {
  stage: 0 | 1 | 2 | 3;
  dueDay: string;
  lastAppliedDay: string | null;
  lapses: number;
}
export function scheduleReview(
  state: ReviewState | null,
  result: 'independent-pass' | 'needs-help',
  today: string,
): ReviewState;
```

确定语义：无状态则 stage=0；independent-pass 对已有且已经到期的记录推进一级，最高3，dueDay=today+该级间隔；needs-help 重置为0，dueDay=today+1，lapses+1。无状态首次正确安排次日，不直接跳3天。当天只应用一次，lastAppliedDay=today 后的重试不再改变 schedule；订正与跳过不更新调度，提前练习不到期项目不推进原 schedule。第一遍错误即使订正正确，也保持次日复习。

今日规划：固定随机 seed=sessionId；先按 dueDay 升序收集可用复习组，再选所选层级的当前单元；不拆共享材料的题组。预计时间上限是用户预算，加入下一组超过预算则停止；没有可放下的组时推荐短词句组或显示需要较长时间，不制造空会话。新词句最多5个，复习积压时可为0。

复习选择同家族同 reviewMode 的未见版本优先；没有未见版本可用则允许熟题并标识“熟题复习”，不记为迁移证据。holdout 首先按 exposures 排除已见题，而非仅排除已答题。

## D08 应用服务接口

首版是进程内服务，没有必须部署的 REST API。不要为了“接口完整”新增账号、服务器或数据库服务。类型 Item/Session/Attempt/ReviewState 均在前文定义。

| 服务函数 | 输入 | 输出 | 关键约束 |
| --- | --- | --- | --- |
| createSession | `{unitId: string|null, minutes:5|10|15|25, profileId:string}` | `Promise<Result<Session>>` | 固定计划后持久化，重开不重新抽题 |
| loadSession | `sessionId:string` | `Promise<Result<Session>>` | 检查绑定包版本可用 |
| revealHint | `{sessionId,slotId,hint,expectedRevision}` | `Promise<Result<Session>>` | 保存 assistance 后才显示提示 |
| submitAnswer | `SubmitCommand` | `Promise<Result<Attempt>>` | D05 原子提交与幂等 |
| correctAnswer | `SubmitCommand` | `Promise<Result<Attempt>>` | first 已存在，写 correction，不改首次成绩 |
| skipSlot | `{sessionId,slotId,expectedRevision}` | `Promise<Result<Session>>` | 跳过不是答错 |
| saveDraft | `{sessionId,itemId,text,expectedRevision}` | `Promise<Result<{revision:number}>>` | 乐观并发保存，禁止旧请求覆盖新文本 |
| finalizeWriting | `{id,sessionId,itemId,phase:'first'|'revision',selfCheck:boolean[]}` | `Promise<Result<{versionId:string}>>` | id 幂等，先保存最后正文再冻结版本 |
| downloadPack | `{id,version}` | `Promise<Result<{ready:boolean}>>` | 完整校验后才 ready |
| exportBackup | 无 | `Promise<Result<Blob>>` | 可移植记录包，排除缓存音频 |
| validateBackup | `file:File` | `Promise<Result<{records:number,packRefs:string[]}>>` | 不改库，仅校验和预览 |
| restoreBackup | `file:File` | `Promise<Result<{restored:number}>>` | 全量校验后事务替换 |

表内未标类型的 ID/hint 为 string，expectedRevision 为 number。hint 必须通过 D04 白名单，selfCheck 长度等于题目 checklistZh。写作 drafts 使用独立 revision 计数，不复用 session.revision。音频开始、重播、变速同样经 `updateAudioState({sessionId,slotId,replayCount,audioSpeed,expectedRevision})` 返回 Session；合法速度限0.75、1，次数只增，UI不可回减。

写作自动保存延迟500ms，输入时生成递增本地序号；只允许串行写入最新待保存正文。离开页面前显式等待保存；不能只依赖 beforeunload。写入失败保留正文、显示未保存、允许复制，不能显示绿色“已保存”。首版每份正文上限10000字符。finalizeWriting 将 writingVersions、drafts、sessions、achievements 放入同一数据库事务，冻结版本与会话完成状态同时提交；不写客观 attempts 或客观复习成绩。

## D08a 内容作者文件到运行包

作者输入格式固定：`content/sources/catalog.json` 是 Source 数组；`content/assets/catalog.json` 是 Asset 数组，二进制放 `content/assets/`；`content/resources/<id>.json`、`content/items/<id>.json`、`content/units/<id>.json` 分别保存单个 Resource/Item/Unit。`content/profiles/<id>.json` 保存 ExamProfile。

`content/pack-manifests/<id>.json` 定义包：`{schemaVersion:1,id,version,titleZh,status,author,reviewer,reviewedAt,profileIds,sourceIds,assetIds,resourceIds,itemIds,unitIds}`。各ID数组只引用上述目录中的实体；每个清单独立组装成D02的完整CoursePack再校验。构建按各数组给定顺序组装，生成结果稳定可复现，不随机遍历文件系统。

样例JSON是已组装的完整CoursePack，测试直接读取；T02将其拆为上述作者文件验证组装再输出，与样例进行语义比较。小型draft样例没有audio资产，因此只可验证文字题型；T08补真实音频fixture，不能因为当前assets为空就绕过听力资源校验。

每个Gap.explanationZh必须非空，UI逐空显示；整题Explanation用于篇章逻辑和公共说明。options模式每个错误选项的理由可以统一放整题distractors，但ID必须能定位，完整题库不允许只写“见答案”。

## D09 离线包、更新与备份

> **v0.1 实现说明（T12）**：资源字节（音频）与课程 JSON 存 IndexedDB（T08 既定介质，逐资产 bytes+sha256 校验），Cache Storage 仅承载应用 shell precache 与 catalog 回退；「临时版本 cache」对应 downloadJobs 作业在全部校验通过前不落资产字节的两阶段流程；启动对账校验作业内资产键存在性。以下原文的「cache」按此口径理解。

发布产物：`/catalog.json` 列出包 ID、版本、JSON path、bytes、sha256；`/packs/<id>/<version>/pack.json` 和对应 `assets/` 为不可变资源。catalog 用网络优先并有超时回退；资源按确切版本缓存，不覆盖已有路径内容。

下载状态 absent -> downloading -> verifying -> ready 或 failed。资源进入临时版本 cache，逐个检查 MIME、bytes、sha256；全部成功后在 DB 写包与 ready，恢复启动时交叉检查 cache 存在，缺失则标为 needs-download。Cache 与 IndexedDB 无法跨存储原子事务，所以必须有启动对账，不能假设一次事务解决所有缓存更新。

下载前估算空间，失败显示 INSUFFICIENT_SPACE；不自动删除正在使用的旧课程。安装新版本不改变已有 session 引用，旧包仅在无未完成会话依赖且用户允许时清理。Service Worker 更新先提示，练习结束后才激活，保留旧 shell 缓存直到新版本可启动。

备份 envelope：`{format:'gaokao-personal-backup',schemaVersion:1,exportedAt,appVersion,payloadSha256,payload}`。payload 为 settings、课程 JSON 快照、sessions、attempts、exposures、reviewStates、drafts、writingVersions、achievements；排除 downloadJobs、音频缓存及任何密钥。为了离线查看历史，备份包含被引用的旧课程 JSON，恢复后音频需重新下载并明确标识。

摘要采用对递归键排序的 JSON UTF-8 字节 SHA256，不依赖对象插入顺序。限制50 MiB、50000条作答记录；超限报告清晰错误，不静默丢数据。恢复前校验结构、摘要、版本、外键、ID重复；同schema有效备份才允许整库恢复，未来schema返回 NEWER_SCHEMA。先建议导出现有记录，再经明确确认事务替换；失败保留原库。首版不合并两台设备的记录。

## D10 错误与安全

- 内容从网络或导入文件进入前必须校验，文字用 Vue 文本绑定，禁用 v-html，不执行内容脚本。
- 单个坏包不能阻止其他包使用；当前题缺失显示返回课程/重新下载，不能提交空答案。
- 加载超时可重试，网络重试只针对读取，提交已在本地且使用幂等 ID。
- 发布站点全程 HTTPS，学习数据不上传，日志不写作文正文和个人信息。
- 下载站只能访问同源 pack paths；source.url 仅展示引用，不参与自动下载。
- 无痕或受限存储需实际试写后提示“本次不能可靠保存”，不得承诺持久化。
- Safari 浏览器页和主屏幕应用存储可能独立；安装引导要求先备份，进入主屏幕发现空库时提供导入路径。
- 关闭声音/动画后学习流程完整可用；拒绝播放或音频错误不计入错误率。

## D11 性能与可观测性预算

首屏 JS gzip <=300 KiB（不含课程），单包<=25 MiB，答题反馈在本地提交后典型设备目标<=200ms，超时显示保存中而非允许重复提交。上述是验收预算，不是当前测量结果。浏览器日志记录错误代码、应用版本和匿名任务ID，保留最近100条供手动导出诊断，不记录答案正文。

技术依据：[Vue 官方入门](https://vuejs.org/guide/quick-start.html)、[Dexie Vue 用法](https://dexie.org/docs/Tutorial/Vue)、[MDN PWA 离线](https://developer.mozilla.org/en-US/docs/Web/Progressive_web_apps/Guides/Offline_and_background_operation)、[WebKit 存储策略](https://webkit.org/blog/14403/updates-to-storage-policy/)。
