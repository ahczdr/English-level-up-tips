import type { GaokaoDatabase } from '../data/db';
import type { WritingVersionRecord } from '../data/migrations';

export type WritingErrorCode =
  | 'INVALID_ANSWER'
  | 'STALE_SESSION'
  | 'NOT_FOUND'
  | 'CONTENT_MISSING'
  | 'STORAGE_FAILED';

export type WritingResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: { code: WritingErrorCode; messageZh: string } };

export interface WritingDraftBody {
  content: string;
  outline: string;
  checklist: string[];
  revision: number;
}

export interface WritingVersionBody {
  content: string;
  outline: string;
  checklist: string[];
  version: number;
}

// 英文单词计数：连续字母为骨干，内部撇号（含弯撇号）或连字符连接仍算一词；
// 纯数字不计；紧贴数字的字母串（如 2nd）也不计。仅作信息展示，不改变通过状态。
const WORD_PATTERN = /(?<![0-9A-Za-z])[A-Za-z]+(?:['\u2018\u2019-]+[A-Za-z]+)*/g;

export function countEnglishWords(text: string): number {
  const matches = text.match(WORD_PATTERN);
  return matches ? matches.length : 0;
}

// 同一草稿键的写操作串行化：调用顺序即落盘顺序，杜绝并发交错覆盖
const queues = new Map<string, Promise<unknown>>();
const enqueue = <T>(key: string, task: () => Promise<T>): Promise<T> => {
  const previous = queues.get(key) ?? Promise.resolve();
  const next = previous.then(task, task);
  queues.set(
    key,
    next.catch(() => undefined),
  );
  return next;
};

const draftKey = (sessionId: string, itemId: string): string => `${sessionId}::${itemId}`;

const parseBody = (raw: string | undefined): WritingDraftBody | null => {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<WritingDraftBody> | null;
    if (!parsed || typeof parsed.content !== 'string') return null;
    return {
      content: parsed.content,
      outline: typeof parsed.outline === 'string' ? parsed.outline : '',
      checklist: Array.isArray(parsed.checklist) ? parsed.checklist.filter((item): item is string => typeof item === 'string') : [],
      revision: typeof parsed.revision === 'number' ? parsed.revision : 0,
    };
  } catch {
    return null;
  }
};

export interface LoadWritingDraftInput {
  db: GaokaoDatabase;
  sessionId: string;
  itemId: string;
}

export async function loadWritingDraft(input: LoadWritingDraftInput): Promise<WritingResult<WritingDraftBody | null>> {
  try {
    const row = await input.db.drafts.get([input.sessionId, input.itemId]);
    return { ok: true, value: parseBody(row?.content) };
  } catch {
    return { ok: false, error: { code: 'STORAGE_FAILED', messageZh: '写作草稿读取失败' } };
  }
}

export interface SaveWritingDraftInput {
  db: GaokaoDatabase;
  sessionId: string;
  itemId: string;
  content: string;
  outline: string;
  checklist: string[];
  expectedRevision: number;
}

export async function saveWritingDraft(input: SaveWritingDraftInput): Promise<WritingResult<{ revision: number }>> {
  try {
    return await enqueue(draftKey(input.sessionId, input.itemId), async () => {
      const row = await input.db.drafts.get([input.sessionId, input.itemId]);
      const stored = parseBody(row?.content);
      const currentRevision = stored?.revision ?? 0;
      if (currentRevision !== input.expectedRevision) {
        return { ok: false, error: { code: 'STALE_SESSION', messageZh: '写作草稿已在其他页面更新，请以最新内容继续' } };
      }
      const next: WritingDraftBody = {
        content: input.content,
        outline: input.outline,
        checklist: [...input.checklist],
        revision: input.expectedRevision + 1,
      };
      await input.db.drafts.put({
        sessionId: input.sessionId,
        itemId: input.itemId,
        updatedAt: new Date().toISOString(),
        content: JSON.stringify(next),
      });
      return { ok: true, value: { revision: next.revision } };
    });
  } catch {
    return { ok: false, error: { code: 'STORAGE_FAILED', messageZh: '写作草稿保存失败' } };
  }
}

export interface FinalizeWritingInput {
  db: GaokaoDatabase;
  sessionId: string;
  slotId: string;
  expectedRevision: number;
}

// 冻结当前草稿为新版本（只追加，不改写既有版本），并把 slot 置为 submitted。
// 不产生客观 Attempt，也不写复习状态——写作不计入客观正确率分母。
export async function finalizeWriting(input: FinalizeWritingInput): Promise<WritingResult<{ version: number; versions: number }>> {
  try {
    return await input.db.transaction('rw', input.db.sessions, input.db.packs, input.db.writingVersions, input.db.drafts, async () => {
      const session = await input.db.sessions.get(input.sessionId);
      if (!session) return { ok: false as const, error: { code: 'NOT_FOUND' as const, messageZh: '会话不存在' } };
      const slot = session.slots.find((candidate) => candidate.id === input.slotId);
      if (!slot) return { ok: false as const, error: { code: 'NOT_FOUND' as const, messageZh: '未找到写作题目' } };
      if (session.revision !== input.expectedRevision) {
        return { ok: false as const, error: { code: 'STALE_SESSION' as const, messageZh: '学习记录已在其他页面更新，请刷新后再提交' } };
      }
      const row = await input.db.drafts.get([input.sessionId, slot.ref.itemId]);
      const body = parseBody(row?.content) ?? { content: '', outline: '', checklist: [], revision: 0 };
      const existing = await input.db.writingVersions.where('[sessionId+itemId]').equals([input.sessionId, slot.ref.itemId]).toArray();
      const version = existing.length + 1;
      const record: WritingVersionRecord = {
        id: `${input.sessionId}:${slot.ref.itemId}:v${version}`,
        sessionId: input.sessionId,
        itemId: slot.ref.itemId,
        createdAt: new Date().toISOString(),
        content: JSON.stringify({ content: body.content, outline: body.outline, checklist: body.checklist, version } satisfies WritingVersionBody),
      };
      await input.db.writingVersions.put(record);
      slot.state = 'submitted';
      session.revision += 1;
      session.updatedAt = new Date().toISOString();
      await input.db.sessions.put(session);
      return { ok: true as const, value: { version, versions: version } };
    });
  } catch (error) {
    console.error('finalizeWriting failed:', error);
    return { ok: false, error: { code: 'STORAGE_FAILED', messageZh: '写作提交失败，请重试' } };
  }
}

export interface ListWritingVersionsInput {
  db: GaokaoDatabase;
  sessionId: string;
  itemId: string;
}

export async function listWritingVersions(input: ListWritingVersionsInput): Promise<WritingVersionBody[]> {
  const rows = await input.db.writingVersions.where('[sessionId+itemId]').equals([input.sessionId, input.itemId]).toArray();
  return rows
    .sort((left, right) => (left.createdAt === right.createdAt ? left.id.localeCompare(right.id) : left.createdAt.localeCompare(right.createdAt)))
    .map((row: WritingVersionRecord) => {
      try {
        const parsed = JSON.parse(row.content) as Partial<WritingVersionBody>;
        return {
          content: typeof parsed.content === 'string' ? parsed.content : '',
          outline: typeof parsed.outline === 'string' ? parsed.outline : '',
          checklist: Array.isArray(parsed.checklist) ? parsed.checklist.filter((item): item is string => typeof item === 'string') : [],
          version: typeof parsed.version === 'number' ? parsed.version : 0,
        };
      } catch {
        return { content: '', outline: '', checklist: [], version: 0 };
      }
    });
}
