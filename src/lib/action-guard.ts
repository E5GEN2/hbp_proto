// Server-action error transport (audit B-9). Next.js PRODUCTION masks the
// message of any Error thrown inside a server action ("An error occurred in
// the Server Components render… omitted in production builds…"), so domain
// errors must travel to the client as RETURN VALUES, not throws.
//
// Every exported action in src/lib/*-actions.ts is wrapped in guarded();
// client components import the mirror module from src/lib/ui-actions/, where
// unwrapAction() re-throws the failure as a normal Error — so the existing
// `try { await action() } catch (e) { toast(e.message) }` call sites keep
// working and show the real message again.

export type ActionFailure = { __actionError: string };

export function isActionFailure(r: unknown): r is ActionFailure {
  return !!r && typeof r === 'object' && typeof (r as ActionFailure).__actionError === 'string';
}

export function guarded<A extends unknown[], R>(fn: (...args: A) => Promise<R>) {
  return async (...args: A): Promise<R | ActionFailure> => {
    try {
      return await fn(...args);
    } catch (e: any) {
      // redirect()/notFound() communicate via thrown control-flow errors —
      // those must keep propagating for Next to handle them.
      if (typeof e?.digest === 'string' && e.digest.startsWith('NEXT_')) throw e;
      console.error(`[action:${fn.name || 'anonymous'}]`, e);
      // Write conflict / deadlock between two writers on the same rows —
      // Postgres aborted this side, the other change landed; a reload shows
      // the winner. Prisma's raw text is nothing an admin can act on.
      if (e?.code === 'P2034') return { __actionError: 'Another change to this record landed at the same time — reload and try again.' };
      return { __actionError: e?.message || 'Something went wrong' };
    }
  };
}
