// After `next build`: copy public/ and .next/static into .next/standalone so
// `npm start` (node .next/standalone/server.js) serves them. The Dockerfile
// does the same copy itself.
import { cpSync, existsSync } from 'node:fs';

if (existsSync('.next/standalone')) {
  cpSync('public', '.next/standalone/public', { recursive: true });
  cpSync('.next/static', '.next/standalone/.next/static', { recursive: true });
  console.log('Copied public/ and .next/static into .next/standalone.');
}
