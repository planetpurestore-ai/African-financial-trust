import { many, one, q, withTransaction } from '../../db/pool.js';
import { decryptSecret, encryptSecret, hashPassword, hashToken, randomToken, verifyPassword } from '../../lib/crypto.js';
import { badRequest, forbidden, notFound, unauthorized } from '../../lib/errors.js';
import { ulid } from '../../lib/ids.js';
import { writeAudit, writeAuditStandalone } from '../../lib/audit.js';
import { config } from '../../config.js';
import { generateTotpSecret, otpauthUri, verifyTotp } from '../../lib/totp.js';

const LOCK_THRESHOLD = 5;
const LOCK_MINUTES = 15;

async function createSession(user, { ip, userAgent }) {
  const token = randomToken(32);
  const csrf = randomToken(24);
  const sessionId = ulid();
  const expires = new Date(Date.now() + config.sessionHours * 3600_000);
  await q(
    `INSERT INTO sessions (id, user_id, token_hash, expires_at, ip, user_agent) VALUES (?, ?, ?, ?, ?, ?)`,
    [sessionId, user.id, hashToken(token), expires, ip ?? null, String(userAgent || '').slice(0, 500)],
  );
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

  const mfa = await one('SELECT enabled_at FROM user_mfa WHERE user_id = ?', [user.id]);
  await q('UPDATE users SET failed_logins = 0, locked_until = NULL, last_login_at = NOW(3) WHERE id = ?', [user.id]);
  if (mfa?.enabled_at) {
    const challengeToken = randomToken(32);
    const expires = new Date(Date.now() + 5 * 60_000);
    await q(
      `INSERT INTO mfa_challenges (id, user_id, token_hash, expires_at, ip, user_agent) VALUES (?, ?, ?, ?, ?, ?)`,
      [ulid(), user.id, hashToken(challengeToken), expires, ip ?? null, String(userAgent || '').slice(0, 500)],
    );
    return { mfaRequired: true, challengeToken, challengeExpires: expires };
  }
  return createSession(user, { ip, userAgent });
}

function recoveryCode() {
  return randomToken(9).replace(/[^A-Za-z0-9]/g, '').toUpperCase().slice(0, 12);
}

export async function mfaStatus(auth) {
  if (auth.type !== 'session') throw forbidden('MFA settings require an interactive session');
  const row = await one('SELECT enabled_at FROM user_mfa WHERE user_id = ?', [auth.user.id]);
  return { enabled: Boolean(row?.enabled_at), enabledAt: row?.enabled_at || null };
}

export async function beginMfaSetup(auth) {
  if (auth.type !== 'session') throw forbidden('MFA setup requires an interactive session');
  const user = await one('SELECT id, email FROM users WHERE id = ? AND status = \'active\'', [auth.user.id]);
  if (!user) throw unauthorized();
  const existing = await one('SELECT enabled_at FROM user_mfa WHERE user_id = ?', [user.id]);
  if (existing?.enabled_at) throw badRequest('MFA is already enabled for this account');
  const secret = generateTotpSecret();
  const encrypted = encryptSecret(secret);
  const recoveryCodes = Array.from({ length: 10 }, recoveryCode);
  await q(
    `INSERT INTO user_mfa (user_id, secret_ciphertext, secret_iv, secret_auth_tag, recovery_code_hashes)
     VALUES (?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE secret_ciphertext = VALUES(secret_ciphertext), secret_iv = VALUES(secret_iv), secret_auth_tag = VALUES(secret_auth_tag), recovery_code_hashes = VALUES(recovery_code_hashes), enabled_at = NULL`,
    [user.id, encrypted.ciphertext, encrypted.iv, encrypted.authTag, JSON.stringify(recoveryCodes.map(hashToken))],
  );
  await writeAuditStandalone({
    orgId: auth.org.id,
    actorType: auth.type,
    actorId: auth.user.id,
    action: 'mfa.setup_started',
    entityType: 'user',
    entityId: user.id,
    metadata: { email: user.email },
  });
  return { enabled: false, email: user.email, secret, otpauthUri: otpauthUri(secret, user.email), recoveryCodes };
}

export async function enableMfa(auth, code) {
  if (auth.type !== 'session') throw forbidden('MFA setup requires an interactive session');
  const row = await one('SELECT * FROM user_mfa WHERE user_id = ?', [auth.user.id]);
  if (!row) throw badRequest('Start MFA setup before enabling it');
  const secret = decryptSecret({ ciphertext: row.secret_ciphertext, iv: row.secret_iv, authTag: row.secret_auth_tag });
  if (!verifyTotp(secret, code)) throw badRequest('The authenticator code is invalid or expired');
  await q('UPDATE user_mfa SET enabled_at = NOW(3) WHERE user_id = ?', [auth.user.id]);
  await writeAuditStandalone({
    orgId: auth.org.id,
    actorType: auth.type,
    actorId: auth.user.id,
    action: 'mfa.enabled',
    entityType: 'user',
    entityId: auth.user.id,
    metadata: {},
  });
  return { enabled: true };
}

async function createSessionOnConnection(conn, user, { ip, userAgent }) {
  const token = randomToken(32);
  const csrf = randomToken(24);
  const sessionId = ulid();
  const expires = new Date(Date.now() + config.sessionHours * 3600_000);
  await conn.query(
    `INSERT INTO sessions (id, user_id, token_hash, expires_at, ip, user_agent) VALUES (?, ?, ?, ?, ?, ?)`,
    [sessionId, user.id, hashToken(token), expires, ip ?? null, String(userAgent || '').slice(0, 500)],
  );
  const [orgRows] = await conn.query('SELECT * FROM organisations WHERE id = ?', [user.org_id]);
  const org = orgRows[0];
  return {
    token,
    csrf,
    expires,
    sessionId,
    user: { id: user.id, email: user.email, fullName: user.full_name, role: user.role },
    org: { id: org.id, name: org.name, orgType: org.org_type },
  };
}

export async function verifyMfaChallenge({ challengeToken, code, ip, userAgent }) {
  const result = await withTransaction(async (conn) => {
    const [challengeRows] = await conn.query(
      `SELECT c.*, u.id AS user_id, u.org_id, u.email, u.full_name, u.role, u.status AS user_status,
              o.name AS org_name, o.org_type, o.status AS org_status
         FROM mfa_challenges c JOIN users u ON u.id = c.user_id JOIN organisations o ON o.id = u.org_id
        WHERE c.token_hash = ? AND c.used_at IS NULL AND c.expires_at > NOW(3)
        FOR UPDATE`,
      [hashToken(challengeToken)],
    );
    const challenge = challengeRows[0];
    if (!challenge || challenge.attempts >= 5 || challenge.user_status !== 'active' || challenge.org_status === 'suspended') return { valid: false };
    const [mfaRows] = await conn.query('SELECT * FROM user_mfa WHERE user_id = ? FOR UPDATE', [challenge.user_id]);
    const mfa = mfaRows[0];
    let valid = false;
    let recoveryIndex = -1;
    if (mfa) {
      const secret = decryptSecret({ ciphertext: mfa.secret_ciphertext, iv: mfa.secret_iv, authTag: mfa.secret_auth_tag });
      valid = verifyTotp(secret, code);
      if (!valid) {
        const hashes = Array.isArray(mfa.recovery_code_hashes) ? mfa.recovery_code_hashes : JSON.parse(mfa.recovery_code_hashes || '[]');
        recoveryIndex = hashes.indexOf(hashToken(String(code || '').trim().toUpperCase()));
        valid = recoveryIndex >= 0;
        if (valid) {
          hashes.splice(recoveryIndex, 1);
          await conn.query('UPDATE user_mfa SET recovery_code_hashes = ? WHERE user_id = ?', [JSON.stringify(hashes), challenge.user_id]);
        }
      }
    }
    if (!valid) {
      await conn.query('UPDATE mfa_challenges SET attempts = attempts + 1 WHERE id = ?', [challenge.id]);
      return { valid: false };
    }
    await conn.query('UPDATE mfa_challenges SET used_at = NOW(3) WHERE id = ?', [challenge.id]);
    const session = await createSessionOnConnection(conn, {
      id: challenge.user_id,
      org_id: challenge.org_id,
      email: challenge.email,
      full_name: challenge.full_name,
      role: challenge.role,
    }, { ip, userAgent });
    return { valid: true, session };
  });
  if (!result.valid) throw unauthorized('The MFA code is invalid or the challenge has expired');
  return result.session;
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

export async function createInvitation(auth, input) {
  return withTransaction(async (conn) => {
    const email = input.email.toLowerCase().trim();
    const [existing] = await conn.query('SELECT id FROM users WHERE email = ?', [email]);
    if (existing.length) throw badRequest('A user with that email already exists', { field: 'email' });
    const userId = ulid();
    const invitationId = ulid();
    const token = randomToken(32);
    const expires = new Date(Date.now() + 48 * 3600_000);
    await conn.query(
      `INSERT INTO users (id, org_id, email, password_hash, full_name, role, status)
       VALUES (?, ?, ?, ?, ?, ?, 'invited')`,
      [userId, auth.org.id, email, hashPassword(randomToken(32)), input.fullName, input.role],
    );
    await conn.query(
      `INSERT INTO user_invitations (id, user_id, email, token_hash, expires_at, created_by_user_id)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [invitationId, userId, email, hashToken(token), expires, auth.user?.id ?? null],
    );
    await writeAudit(conn, {
      orgId: auth.org.id,
      actorType: auth.type,
      actorId: auth.user?.id,
      action: 'user.invited',
      entityType: 'user',
      entityId: userId,
      metadata: { email, role: input.role, invitationId, expiresAt: expires.toISOString() },
    });
    return { id: userId, email, fullName: input.fullName, role: input.role, status: 'invited', invitationId, token, expiresAt: expires };
  });
}

export async function activateInvitation({ token, password, fullName }) {
  return withTransaction(async (conn) => {
    const [rows] = await conn.query(
      `SELECT i.*, u.org_id, u.status AS user_status
         FROM user_invitations i JOIN users u ON u.id = i.user_id
        WHERE i.token_hash = ? AND i.used_at IS NULL AND i.expires_at > NOW(3)
        FOR UPDATE`,
      [hashToken(token)],
    );
    const invitation = rows[0];
    if (!invitation || invitation.user_status !== 'invited') throw unauthorized('This invitation is invalid or expired');
    const fields = ["password_hash = ?", "status = 'active'"];
    const params = [hashPassword(password)];
    if (fullName) { fields.push('full_name = ?'); params.push(fullName.trim()); }
    params.push(invitation.user_id);
    await conn.query(`UPDATE users SET ${fields.join(', ')} WHERE id = ?`, params);
    await conn.query('UPDATE user_invitations SET used_at = NOW(3) WHERE id = ?', [invitation.id]);
    await writeAudit(conn, {
      orgId: invitation.org_id,
      actorType: 'invitation',
      action: 'user.activated',
      entityType: 'user',
      entityId: invitation.user_id,
      metadata: { email: invitation.email, invitationId: invitation.id },
    });
    return { activated: true, email: invitation.email };
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
