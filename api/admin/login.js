import { adminEnvReady, assertNotLocked, clearFailures, loginKey, recordFailure, sessionCookie, signSession, verifyAdminLogin, verifyAdminPassword } from '../_lib/auth.js';
import { readBody, send, wrap } from '../_lib/http.js';

export default wrap(async function login(req, res) {
  if (req.method !== 'POST') return send(res, 405, { error: 'method' });
  if (!adminEnvReady()) return send(res, 500, { error: 'Сервер не настроен' });
  const body = await readBody(req);
  const key = loginKey(req, 'admin');
  if ((await assertNotLocked('admin', key)).locked) {
    return send(res, 429, { error: 'Слишком много попыток. Подождите 15 минут.' });
  }
  const loginOk = verifyAdminLogin(String(body.login || '').slice(0, 80));
  const passwordOk = verifyAdminPassword(body.password || '');
  if (!loginOk || !passwordOk) {
    await recordFailure('admin', key);
    return send(res, 401, { error: 'Неверный логин или пароль' });
  }
  await clearFailures('admin', key);
  const token = signSession({ role: 'admin' });
  return send(res, 200, { ok: true }, { 'Set-Cookie': sessionCookie(token, req) });
});
