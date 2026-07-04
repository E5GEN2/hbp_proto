// Next.js instrumentation hook — runs once per server boot (nodejs runtime).
// Starts the lifecycle sweep loop; without it nothing in the system moves with
// time (audit B-1). Guarded against the build phase and dev double-registration.
export async function register() {
  if (process.env.NEXT_RUNTIME !== 'nodejs') return;
  if (process.env.NEXT_PHASE === 'phase-production-build') return;
  const { startSweepLoop } = await import('./lib/sweep');
  startSweepLoop();
}
