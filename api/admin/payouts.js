import { readSession } from '../_lib/auth.js';
import { recordPayout } from '../_lib/domain.js';
import { readBody, send, wrap } from '../_lib/http.js';

export default wrap(async function payouts(req, res) {
  if (req.method !== 'POST') return send(res, 405, { error: 'method' });
  const session = readSession(req);
  if (!session || session.role !== 'admin') return send(res, 401, { error: 'Нужно войти' });
  const result = await recordPayout(await readBody(req));
  if (result.error) return send(res, 400, { error: result.error });
  return send(res, 200, result);
});
