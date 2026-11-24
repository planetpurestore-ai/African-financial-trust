import mysql from 'mysql2/promise';
import { hashPassword, hashToken, randomToken } from '../src/lib/crypto.js';
import { writeAudit } from '../src/lib/audit.js';
import { ulid } from '../src/lib/ids.js';

const email = String(process.argv[2] || '').toLowerCase().trim();
const fullName = String(process.argv[3] || 'AFT Administrator').trim();
if (!/^\S+@\S+\.\S+$/.test(email)) throw new Error('Usage: node scripts/invite-admin.js admin@example.com "Full Name"');
if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required');

const c = await mysql.createConnection(process.env.DATABASE_URL);
const token = randomToken(32);
const expires = new Date(Date.now() + 48 * 3600_000);
try {
  await c.beginTransaction();
  const [[platform]] = await c.query("SELECT id FROM organisations WHERE org_type='platform' AND status='active' ORDER BY created_at LIMIT 1");
  if (!platform) throw new Error('No active platform organisation exists');
  const [[existing]] = await c.query('SELECT id, status FROM users WHERE email = ? LIMIT 1', [email]);
  if (existing) throw new Error(`A user already exists for ${email} with status ${existing.status}`);
  const userId = ulid();
  const invitationId = ulid();
  await c.query(
    `INSERT INTO users (id, org_id, email, password_hash, full_name, role, status)
     VALUES (?, ?, ?, ?, ?, 'system_admin', 'invited')`,
    [userId, platform.id, email, hashPassword(randomToken(32)), fullName],
  );
  await c.query(
    `INSERT INTO user_invitations (id, user_id, email, token_hash, expires_at, created_by_user_id)
     VALUES (?, ?, ?, ?, ?, NULL)`,
    [invitationId, userId, email, hashToken(token), expires],
  );
  await writeAudit(c, {
    orgId: platform.id,
    actorType: 'system',
    action: 'user.invited',
    entityType: 'user',
    entityId: userId,
    metadata: { email, role: 'system_admin', invitationId, expiresAt: expires.toISOString(), reason: 'Initial production administrator bootstrap' },
  });
  await c.commit();
  const origin = process.env.PUBLIC_ORIGIN || 'https://aftengine-dgfbrcn2.manus.space';
  console.log(JSON.stringify({ email, role: 'system_admin', invitationId, expiresAt: expires.toISOString(), activationUrl: `${origin}/activate/${token}` }, null, 2));
} catch (error) {
  await c.rollback();
  throw error;
} finally {
  await c.end();
}
