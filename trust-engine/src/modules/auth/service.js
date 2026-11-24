import { many, one, q, withTransaction } from '../../db/pool.js';
import { hashPassword, hashToken, randomToken, verifyPassword } from '../../lib/crypto.js';
import { badRequest, forbidden, notFound, unauthorized } from '../../lib/errors.js';
import { ulid } from '../../lib/ids.js';
import { writeAudit } from '../../lib/audit.js';
import { config } from '../../config.js';

const LOCK_THRESHOLD = 5;
const LOCK_MINUTES = 15;

export async function login({ email, password, ip, userAgent }) {
  const user = await one('SELECT * FROM users WHERE email = ? LIMIT 1', [String(email).toLowerCase().trim()]);
  if (!user) throw unauthorized('Invalid email or password');
  if (user.status !== 'active') throw forbidden('This account is disabled');
  if (user.locked_until && new Date(user.locked_until) > new Date()) {
    throw forbidden('Account temporarily locked after repeated failed sign-in attempts');
  }
  if (!verifyPassword(password, user.password_hash)) {
    const failed = Number(user.failed_logins) + 1;
    const lock = failed >= LOCK_THRESHOLD ? `DATE_ADD(NOW(3), INTERVAL ${LOCK_MINUTES} MINUTE)` : 'NULL';
    await q(`UPDATE users SET failed_logins = ?, locked_until = ${lock} WHERE id = ?`, [failed, user.id]);
    throw unauthorized('Invalid email or password');
  }

  const token = randomToken(32);
  const csrf = randomToken(24);
  const sessionId = ulid();
  const expires = new Date(Date.now() + config.sessionHours * 3600_000);
  await q(
    `INSERT INTO sessions (id, user_id, token_hash, expires_at, ip, user_agent) VALUES (?, ?, ?, ?, ?, ?)`,
    [sessionId, user.id, hashToken(token), expires, ip ?? null, String(userAgent || '').slice(0, 500)],
  );
  await q('UPDATE users SET failed_logins = 0, locked_until = NULL, last_login_at = NOW(3) WHERE id = ?', [user.id]);

  const org = await one('SELECT * FROM organisations WHERE id = ?', [user.org_id]);
  return {
    token,
    csrf,
    expires,
    sessionId,
    user: { id: user.id, email: user.email, fullName: user.full_name, role: user.role },
    org: { id: org.id, name: org.name, orgType: org.org_type },
  };
}

export async function logout(sessionId) {
  if (sessionId) await q('UPDATE sessions SET revoked_at = NOW(3) WHERE id = ?', [sessionId]);
}

export async function currentUser(auth) {
  if (!auth?.user) return null;
  const user = await one(
    `SELECT u.id, u.email, u.full_name, u.role, u.status, u.last_login_at, o.id AS org_id, o.name AS org_name, o.org_type
       FROM users u JOIN organisations o ON o.id = u.org_id WHERE u.id = ?`,
    [auth.user.id],
  );
  return user;
}

export async function listUsers(auth) {
  const rows = await many(
    `SELECT u.id, u.email, u.full_name, u.role, u.status, u.last_login_at, u.created_at
       FROM users u WHERE u.org_id = ? ORDER BY u.created_at`,
    [auth.org.id],
  );
  return rows;
}

export async function createUser(auth, input) {
  return withTransaction(async (conn) => {
    const [existing] = await conn.query('SELECT id FROM users WHERE email = ?', [input.email.toLowerCase()]);
    if (existing.length) throw badRequest('A user with that email already exists', { field: 'email' });
    const id = ulid();
    await conn.query(
      `INSERT INTO users (id, org_id, email, password_hash, full_name, role, status) VALUES (?, ?, ?, ?, ?, ?, 'active')`,
      [id, auth.org.id, input.email.toLowerCase(), hashPassword(input.password), input.fullName, input.role],
    );
    await writeAudit(conn, {
      orgId: auth.org.id,
      actorType: auth.type,
      actorId: auth.user?.id,
      action: 'user.created',
      entityType: 'user',
      entityId: id,
      metadata: { email: input.email, role: input.role },
    });
    return { id, email: input.email, fullName: input.fullName, role: input.role };
  });
}

export async function updateUser(auth, userId, input) {
  return withTransaction(async (conn) => {
    const [rows] = await conn.query('SELECT * FROM users WHERE id = ? AND org_id = ? FOR UPDATE', [userId, auth.org.id]);
    const user = rows[0];
    if (!user) throw notFound('User not found');
    if (user.id === auth.user?.id && input.status === 'disabled') throw badRequest('You cannot disable your own account');
    const sets = [];
    const params = [];
    if (input.role) {
      sets.push('role = ?');
      params.push(input.role);
    }
    if (input.status) {
      sets.push('status = ?');
      params.push(input.status);
    }
    if (input.fullName) {
      sets.push('full_name = ?');
      params.push(input.fullName);
    }
    if (!sets.length) return { id: userId };
    params.push(userId);
    await conn.query(`UPDATE users SET ${sets.join(', ')} WHERE id = ?`, params);
    await writeAudit(conn, {
      orgId: auth.org.id,
      actorType: auth.type,
      actorId: auth.user?.id,
      action: 'user.updated',
      entityType: 'user',
      entityId: userId,
      metadata: input,
    });
    return { id: userId, ...input };
  });
}

export async function changePassword(auth, currentPassword, newPassword) {
  const user = await one('SELECT * FROM users WHERE id = ?', [auth.user.id]);
  if (!user || !verifyPassword(currentPassword, user.password_hash)) throw badRequest('Current password is incorrect');
  if (String(newPassword).length < 12) throw badRequest('New password must be at least 12 characters');
  await q('UPDATE users SET password_hash = ? WHERE id = ?', [hashPassword(newPassword), user.id]);
  await q('UPDATE sessions SET revoked_at = NOW(3) WHERE user_id = ? AND id <> ?', [user.id, auth.sessionId]);
  return { updated: true };
}

export async function listOrganisations(auth) {
  if (auth.role !== 'system_admin' && auth.org.orgType !== 'platform') throw forbidden();
  return many('SELECT id, name, org_type, country_code, status, created_at FROM organisations ORDER BY name');
}
