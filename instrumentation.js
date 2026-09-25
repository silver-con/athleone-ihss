// Runs once when the Next.js server starts (Next's instrumentation hook).
// Checks the environment before any request is served — see lib/env-check.js.
export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    const { runStartupCheck } = await import('./lib/startup-check.js');
    runStartupCheck();
  }
}
