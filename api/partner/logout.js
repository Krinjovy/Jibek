import { clearSessionCookie } from '../_lib/auth.js';
import { send, wrap } from '../_lib/http.js';

export default wrap(async function logout(req, res) {
  if (req.method !== 'POST') return send(res, 405, { error: 'method' });
  return send(res, 200, { ok: true }, { 'Set-Cookie': clearSessionCookie(req) });
});
