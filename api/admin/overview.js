import { readSession } from '../_lib/auth.js';
import { overview } from '../_lib/domain.js';
import { send, wrap } from '../_lib/http.js';

export default wrap(async function overviewHandler(req, res) {
  if (req.method !== 'GET') return send(res, 405, { error: 'method' });
  const session = readSession(req);
  if (!session || session.role !== 'admin') return send(res, 401, { error: 'Нужно войти' });
  return send(res, 200, await overview());
});
