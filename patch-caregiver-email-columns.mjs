import { Pool } from 'pg';
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

const { rows: before } = await pool.query(
  `SELECT column_name FROM information_schema.columns WHERE table_name = 'caregivers' ORDER BY ordinal_position`
);
console.log('caregivers columns BEFORE:', before.map(r => r.column_name).join(', '));

await pool.query(`
  ALTER TABLE caregivers
    ADD COLUMN IF NOT EXISTS email text,
    ADD COLUMN IF NOT EXISTS hired_on text
`);

const { rows: after } = await pool.query(
  `SELECT column_name FROM information_schema.columns WHERE table_name = 'caregivers' ORDER BY ordinal_position`
);
console.log('caregivers columns AFTER:', after.map(r => r.column_name).join(', '));

const { rows: cg3 } = await pool.query(`SELECT id, name, email FROM caregivers WHERE id = 'cg3'`);
console.log('cg3 (Thomas) row:', JSON.stringify(cg3[0]));

await pool.end();
