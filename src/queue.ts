import { organize, type OrganizerDeps } from './organizer.js';

export class Queue {
  private chain: Promise<void> = Promise.resolve();
  private active = 0;
  private idleWaiters: (() => void)[] = [];

  constructor(private deps: OrganizerDeps) {}

  enqueue(rawId: string, note?: string) {
    this.active++;
    this.chain = this.chain.then(() => this.process(rawId, note)).catch(() => undefined).finally(() => {
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

  private async process(rawId: string, note?: string) {
    const { store } = this.deps;
    const raw = await store.getRaw(rawId);
    if (!raw) return;
    const prev = await store.getDraft(rawId);
    const version = (prev?.version ?? 0) + 1;
    await store.updateRaw(rawId, { status: 'organizing' });
    try {
      const { draft, questions } = await organize(raw, this.deps, note);
      await store.saveDraft({ id: rawId, rawId, version, draft, questions, status: 'pending' });
      await store.updateRaw(rawId, { status: 'drafted' });
    } catch (e) {
      await store.saveDraft({
        id: rawId, rawId, version, draft: prev?.draft ?? null, questions: [], status: 'failed',
        error: e instanceof Error ? e.message : String(e),
      });
      await store.updateRaw(rawId, { status: 'failed' });
    }
  }
}
