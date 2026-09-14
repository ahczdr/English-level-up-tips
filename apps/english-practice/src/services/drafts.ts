import type { Answer } from '../domain/answers';
import type { GaokaoDatabase } from '../data/db';

export interface DraftInput {
  sessionId: string;
  itemId: string;
  answer: Answer;
}

export interface DraftKey {
  sessionId: string;
  itemId: string;
}

// 草稿只存 JSON 字符串（drafts 表 [sessionId+itemId] 键），不进入 Dexie 事务对象路径，
// 也绝不产生 Attempt 记录——草稿不是作答。
export async function saveDraft(db: GaokaoDatabase, input: DraftInput): Promise<{ ok: true }> {
  const row = {
    sessionId: input.sessionId,
    itemId: input.itemId,
    updatedAt: new Date().toISOString(),
    content: JSON.stringify(input.answer),
  };
  await db.drafts.put(row);
  return { ok: true };
}

export async function loadDraft(db: GaokaoDatabase, input: DraftKey): Promise<{ ok: true; value: Answer | null }> {
  const row = await db.drafts.get([input.sessionId, input.itemId]);
  if (!row) return { ok: true, value: null };
  try {
    return { ok: true, value: JSON.parse(row.content) as Answer };
  } catch {
    return { ok: true, value: null };
  }
}

export async function clearDraft(db: GaokaoDatabase, input: DraftKey): Promise<{ ok: true }> {
  await db.drafts.delete([input.sessionId, input.itemId]);
  return { ok: true };
}
