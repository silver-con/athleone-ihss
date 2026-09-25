// Node-only half of instrumentation.js (kept in its own file so the Edge
// build never sees process.exit). See lib/env-check.js.
import { checkEnvironment } from './env-check.js';

export function runStartupCheck() {
  const { errors, warnings, info, prod } = checkEnvironment();
  console.log(`[hearth] starting (${prod ? 'production' : 'development'}) — ${info.join(' · ')}`);
  for (const w of warnings) console.warn(`[hearth] WARNING: ${w}`);
  if (errors.length) {
    for (const e of errors) console.error(`[hearth] CONFIG ERROR: ${e}`);
    if (prod) {
      console.error('[hearth] Refusing to start with the configuration errors above. Fix the environment and restart.');
      process.exit(1);
    }
  }
}
