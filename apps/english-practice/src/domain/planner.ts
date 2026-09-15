export type PlannerLevel = 'G0' | 'G1' | 'G2'

export interface PlanItem {
  id: string;
  familyId: string;
  reviewMode: string;
  level: PlannerLevel;
  estimatedSeconds: number;
  packId: string;
  packVersion: string;
  unitId: string;
  unitTitleZh: string;
}

export interface PlanGroup {
  packId: string;
  packVersion: string;
  unitId: string;
  unitTitleZh: string;
  items: PlanItem[];
  kind: 'review' | 'new';
  dueDay?: string;
  familiarRetry?: boolean;
}

export interface PlanDueReview {
  familyId: string;
  reviewMode: string;
  dueDay: string;
}

export interface PlanTodayInput {
  today: string;
  budgetSeconds: number;
  seed: string;
  groups: PlanGroup[];
  dueReviews: PlanDueReview[];
  exposedItemIds: string[];
}

export interface PlanTodayResult {
  groups: PlanGroup[];
  totalSeconds: number;
  newCount: number;
  reviewCount: number;
  needsLongerSession: boolean;
}

// djb2 字符串散列：仅用于同一 dueDay 内的确定性排序（seed=sessionId，冻结抽题）
const seedHash = (value: string): number => {
  let hash = 5381;
  for (let index = 0; index < value.length; index += 1) {
    hash = ((hash << 5) + hash + value.charCodeAt(index)) >>> 0;
  }
  return hash;
};

const groupSeconds = (candidate: PlanGroup): number => candidate.items.reduce((sum, item) => sum + item.estimatedSeconds, 0);

const reviewKey = (familyId: string, reviewMode: string): string => `${familyId}|${reviewMode}`;

export function planToday(input: PlanTodayInput): PlanTodayResult {
  const seen = new Set(input.exposedItemIds);

  // 到期复习索引：同一 familyId+reviewMode 取最早到期日；只统计 today 及以前到期
  const dueMap = new Map<string, string>();
  for (const review of input.dueReviews) {
    if (review.dueDay > input.today) continue;
    const key = reviewKey(review.familyId, review.reviewMode);
    const current = dueMap.get(key);
    if (current === undefined || review.dueDay < current) dueMap.set(key, review.dueDay);
  }

  // 分类：组内任一条目命中到期复习即整组按复习处理（共享材料组不拆分）
  const reviewGroups: PlanGroup[] = [];
  const newGroups: PlanGroup[] = [];
  for (const candidate of input.groups) {
    const matchedDueDays = candidate.items
      .map((item) => dueMap.get(reviewKey(item.familyId, item.reviewMode)))
      .filter((value): value is string => value !== undefined);
    if (matchedDueDays.length > 0) {
      const familiarRetry = candidate.items.every((item) => seen.has(item.id));
      reviewGroups.push({ ...candidate, kind: 'review', dueDay: matchedDueDays.reduce((left, right) => (left < right ? left : right)), familiarRetry });
    } else if (candidate.items.every((item) => seen.has(item.id))) {
      // CR17：整组已曝光且无到期复习——熟题未到期不作为新内容重排，
      // 否则再次做对会被判 needs-help 并把间隔复习打回调度起点
      continue;
    } else {
      newGroups.push({ ...candidate, kind: 'new', familiarRetry: false });
    }
  }

  // 复习组按 dueDay 升序；同日用 seed 散列做确定性平局打破（不使用随机数）
  reviewGroups.sort((left, right) => {
    if (left.dueDay !== right.dueDay) return (left.dueDay ?? '') < (right.dueDay ?? '') ? -1 : 1;
    return seedHash(`${input.seed}:${left.unitId}`) - seedHash(`${input.seed}:${right.unitId}`);
  });
  const ordered = [...reviewGroups, ...newGroups];
  // CR17：候选全部被排除（内容已学完且无到期复习）时是真实空态，不是预算不足
  if (ordered.length === 0) {
    return { groups: [], totalSeconds: 0, newCount: 0, reviewCount: 0, needsLongerSession: false };
  }

  const selected: PlanGroup[] = [];
  let remaining = input.budgetSeconds;
  let newCount = 0;
  for (const candidate of ordered) {
    const seconds = groupSeconds(candidate);
    // 新词句上限 5：整组超限则跳过（不拆组），不视为预算停止
    if (candidate.kind === 'new' && newCount + candidate.items.length > 5) continue;
    // 加入下一组超过预算则停止本轮（随后的回退扫描只在整计划为空时推荐短组）
    if (seconds > remaining) break;
    selected.push(candidate);
    remaining -= seconds;
    if (candidate.kind === 'new') newCount += candidate.items.length;
  }

  // 没有可放下的组：推荐最短的可放下组；仍然没有则给真实空态
  if (selected.length === 0) {
    let shortest: PlanGroup | null = null;
    for (const candidate of ordered) {
      if (candidate.kind === 'new' && candidate.items.length > 5) continue;
      const seconds = groupSeconds(candidate);
      if (seconds > input.budgetSeconds) continue;
      if (shortest === null || seconds < groupSeconds(shortest)) shortest = candidate;
    }
    if (shortest === null) {
      return { groups: [], totalSeconds: 0, newCount: 0, reviewCount: 0, needsLongerSession: true };
    }
    selected.push(shortest);
  }

  const totalSeconds = selected.reduce((sum, candidate) => sum + groupSeconds(candidate), 0);
  const reviewCount = selected
    .filter((candidate) => candidate.kind === 'review')
    .reduce((sum, candidate) => sum + candidate.items.length, 0);
  return { groups: selected, totalSeconds, newCount, reviewCount, needsLongerSession: false };
}

export interface LevelUpEvidence {
  firstAttempts: number;
  distinctDays: number;
  families: number;
  accuracy: number;
  consecutiveFirstErrors: number;
}

export type LevelUpSuggestion =
  | { kind: 'up'; toLevel: PlannerLevel; evidence: LevelUpEvidence }
  | { kind: 'support'; evidence: LevelUpEvidence }
  | { kind: 'hold'; sampleShown: string; evidence: LevelUpEvidence };

export const nextLevel = (level: PlannerLevel): PlannerLevel => (level === 'G0' ? 'G1' : 'G2');

// P03 分层建议：连续 3 次首次错误给基础支持；最近 ≥10 次有效独立首次、
// ≥2 个学习日、≥3 个家族且正确率 ≥80% 才建议升层；否则待复测并展示样本数
export function suggestLevelUp(evidence: LevelUpEvidence, currentLevel: PlannerLevel): LevelUpSuggestion {
  if (evidence.consecutiveFirstErrors >= 3) return { kind: 'support', evidence };
  if (evidence.firstAttempts >= 10 && evidence.distinctDays >= 2 && evidence.families >= 3 && evidence.accuracy >= 0.8) {
    return { kind: 'up', toLevel: nextLevel(currentLevel), evidence };
  }
  return { kind: 'hold', sampleShown: `样本 ${evidence.firstAttempts}/10`, evidence };
}
