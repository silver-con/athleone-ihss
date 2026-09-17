import { Pool } from 'pg';
import bcrypt from 'bcryptjs';

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

const id = 'cg-docusign-test';
const email = 'docusign.test@hearth.demo';
const password = 'CaregiverTest123!';
const passwordHash = await bcrypt.hash(password, 10);

await pool.query(
  `INSERT INTO caregivers (id, organization_id, name, role, phone, email, status)
   VALUES ($1, 'org-hearth-demo', $2, 'Home Care Aide', '(555) 000-0000', $3, 'onboarding')
   ON CONFLICT (id) DO UPDATE SET status = 'onboarding', email = EXCLUDED.email`,
  [id, 'DocuSign Test Caregiver', email]
);

await pool.query(
  `INSERT INTO users (id, organization_id, email, password_hash, name, role, caregiver_id)
   VALUES ($1, 'org-hearth-demo', $2, $3, 'DocuSign Test Caregiver', 'CAREGIVER', $4)
   ON CONFLICT (email) DO UPDATE SET password_hash = EXCLUDED.password_hash, caregiver_id = EXCLUDED.caregiver_id`,
  ['user-docusign-test', email, passwordHash, id]
);

const { rows } = await pool.query('SELECT password_hash FROM users WHERE email = $1', [email]);
const verified = await bcrypt.compare(password, rows[0].password_hash);

console.log('Login:', email, '/', password);
console.log('Hash verified locally:', verified);
await pool.end();
