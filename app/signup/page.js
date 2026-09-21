import { redirect } from 'next/navigation';

// Self-service signup is closed — organizations are created by a platform
// admin only (see actions/signup.js for the full note). Kept as a redirect
// rather than a 404 so any bookmark or stale link lands somewhere useful.
export default function SignupPage() {
  redirect('/login');
}
