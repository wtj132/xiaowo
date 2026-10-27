import { localDraft, organize, type OrganizerDeps } from './organizer.js';

const FINISHED = ['confirmed', 'discarded'];

export class Queue {
  private chain: Promise<void> = Promise.resolve();
  private queued = new Map<string, { note?: string }>();
  private active = 0;
  private idleWaiters: (() => void)[] = [];

  constructor(private deps: OrganizerDeps) {}

  /** 同一条原料排队中时不重复入队（只更新备注），避免连点产生多次整理。 */
  enqueue(rawId: string, note?: string) {
    const waiting = this.queued.get(rawId);
    if (waiting) {
      if (note) waiting.note = note;
      return;
    }
    this.queued.set(rawId, { note });
    this.active++;
    this.chain = this.chain.then(() => this.process(rawId)).catch(() => undefined).finally(() => {
      if (--this.active === 0) this.idleWaiters.splice(0).forEach((r) => r());
    });
  }

  redo(draftId: string, note: string) {
    this.enqueue(draftId, note);
  }

  onIdle(): Promise<void> {
    return this.active === 0 ? Promise.resolve() : new Promise((r) => this.idleWaiters.push(r));
  }

  /** 服务启动时调用：把卡在 saved / organizing 的原料重新入队。 */
  async recover() {
    const { store } = this.deps;
    for (const status of ['organizing', 'saved'] as const) {
      for (const raw of (await store.listRaw(status)).reverse()) this.enqueue(raw.id);
    }
  }

  private async process(rawId: string) {
    const { store } = this.deps;
    const note = this.queued.get(rawId)?.note;
    this.queued.delete(rawId);
    const raw = await store.getRaw(rawId);
    if (!raw || FINISHED.includes(raw.status)) return;
    const prev = await store.getDraft(rawId);
    const version = (prev?.version ?? 0) + 1;
    await store.updateRaw(rawId, { status: 'organizing' });

    const userFinished = async () => FINISHED.includes((await store.getRaw(rawId))?.status ?? '');
    try {
      const { draft, questions } = await (raw.private ? localDraft(raw, this.deps) : organize(raw, this.deps, note));
      if (await userFinished()) return; // 整理期间用户已确认/丢弃，不能覆盖
      await store.saveDraft({ id: rawId, rawId, version, draft, questions, status: 'pending' });
      await store.updateRaw(rawId, { status: 'drafted' });
    } catch (e) {
      if (await userFinished()) return;
      const error = e instanceof Error ? e.message : String(e);
      if (prev?.draft && prev.status === 'pending') {
        // 重做失败：保留上一版可用草稿，只附上错误说明
        await store.saveDraft({ ...prev, error });
        await store.updateRaw(rawId, { status: 'drafted' });
      } else {
        await store.saveDraft({ id: rawId, rawId, version, draft: prev?.draft ?? null, questions: [], status: 'failed', error });
        await store.updateRaw(rawId, { status: 'failed' });
      }
    }
  }
}
