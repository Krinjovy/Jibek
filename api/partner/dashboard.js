import { readSession } from '../_lib/auth.js';
import { statsFor } from '../_lib/domain.js';
import { send, wrap } from '../_lib/http.js';

export default wrap(async function dashboard(req, res) {
  if (req.method !== 'GET') return send(res, 405, { error: 'method' });
  const session = readSession(req);
  if (!session || session.role !== 'partner' || !session.code) return send(res, 401, { error: 'Нужно войти' });
  const stats = await statsFor(session.code);
  if (!stats || !stats.partner.active) return send(res, 403, { error: 'Доступ закрыт' });
  return send(res, 200, stats);
});
