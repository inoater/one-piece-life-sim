import type { TickStep } from '../engine/pipeline';

/**
 * Step 6: compile news.
 *
 * Events raise news drafts while they fire (step 5); this step turns them into news items in the
 * order they were raised. Phase 3 adds delivery delay (news reaches each node 0 to 3 months late)
 * and generated headlines; for now news is delivered the month it happens.
 */
export const compileNews: TickStep = {
  id: 'compileNews',
  run(state, ctx) {
    for (const draft of ctx.newsDrafts) {
      state.counters.newsSeq += 1;
      state.news.push({
        id: state.counters.newsSeq,
        tick: ctx.tick,
        text: draft.text,
        tags: draft.tags,
        ...(draft.sourceSeq !== undefined ? { sourceSeq: draft.sourceSeq } : {}),
      });
    }
  },
};
