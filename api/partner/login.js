import { assertNotLocked, clearFailures, loginKey, recordFailure, sessionCookie, signSession } from '../_lib/auth.js';
import { cleanCode, readPartner, verifyPin } from '../_lib/domain.js';
import { readBody, send, wrap } from '../_lib/http.js';

export default wrap(async function login(req, res) {
  if (req.method !== 'POST') return send(res, 405, { error: 'method' });
  const body = await readBody(req);
  const code = cleanCode(body.code);
  const pin = String(body.pin || '').replace(/\D/g, '').slice(0, 8);
  const key = loginKey(req, code || 'none');
  if ((await assertNotLocked('partner', key)).locked) {
    return send(res, 429, { error: 'Слишком много попыток. Подождите 15 минут.' });
  }
  const partner = code ? await readPartner(code) : null;
  if (!partner || !verifyPin(pin, partner)) {
    await recordFailure('partner', key);
    return send(res, 401, { error: 'Неверный код или PIN' });
  }
  if (!partner.active) return send(res, 403, { error: 'Доступ закрыт' });
  await clearFailures('partner', key);
  const token = signSession({ role: 'partner', code: partner.code });
  return send(res, 200, { ok: true, code: partner.code, name: partner.name }, { 'Set-Cookie': sessionCookie(token, req) });
});
