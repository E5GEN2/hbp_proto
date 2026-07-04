import { isActionFailure, type ActionFailure } from '@/lib/action-guard';

// Client-side counterpart of guarded() (see action-guard.ts): converts a
// returned ActionFailure back into a thrown Error so component-level
// try/catch → toast(e.message) keeps working with the REAL message.
export function unwrapAction<A extends unknown[], R>(fn: (...args: A) => Promise<R>) {
  return async (...args: A): Promise<Exclude<R, ActionFailure>> => {
    const r = await fn(...args);
    if (isActionFailure(r)) throw new Error(r.__actionError);
    return r as Exclude<R, ActionFailure>;
  };
}
