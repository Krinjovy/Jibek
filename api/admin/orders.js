import { readSession } from '../_lib/auth.js';
import { setOrderStatus } from '../_lib/domain.js';
import { readBody, send, wrap } from '../_lib/http.js';

export default wrap(async function orders(req, res) {
  if (req.method !== 'POST') return send(res, 405, { error: 'method' });
  const session = readSession(req);
  if (!session || session.role !== 'admin') return send(res, 401, { error: 'Нужно войти' });
  const body = await readBody(req);
  const order = await setOrderStatus(body.id, String(body.status || ''));
  if (!order) return send(res, 404, { error: 'Заказ не найден' });
  return send(res, 200, { order });
});
