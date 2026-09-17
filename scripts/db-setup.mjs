import { execSync } from 'child_process';

execSync(`psql "${process.env.DATABASE_URL}" -f db/schema.sql`, { stdio: 'inherit' });