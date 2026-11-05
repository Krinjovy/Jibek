import { readSession } from '../_lib/auth.js';
import { cleanCode, createPartner, resetPartnerPin, setPartnerActive, statsFor } from '../_lib/domain.js';
import { readBody, send, wrap } from '../_lib/http.js';

export default wrap(async function partnerAdmin(req, res) {
  const session = readSession(req);
  if (!session || session.role !== 'admin') return send(res, 401, { error: 'Нужно войти' });
  if (req.method === 'GET') {
    const url = new URL(req.url, 'http://localhost');
    const stats = await statsFor(cleanCode(url.searchParams.get('code')));
    if (!stats) return send(res, 404, { error: 'Партнёр не найден' });
    return send(res, 200, stats);
  }
  if (req.method !== 'POST') return send(res, 405, { error: 'method' });
  const body = await readBody(req);
  const action = String(body.action || 'create');
  if (action === 'create') {
    const created = await createPartner(body);
    if (created.error) return send(res, created.status || 400, { error: created.error });
    return send(res, 200, created);
  }
  if (action === 'reset_pin') {
    const result = await resetPartnerPin(body.code);
    if (!result) return send(res, 404, { error: 'Партнёр не найден' });
    return send(res, 200, result);
  }
  if (action === 'set_active') {
    const partner = await setPartnerActive(body.code, !!body.active);
    if (!partner) return send(res, 404, { error: 'Партнёр не найден' });
    return send(res, 200, { partner });
  }
  return send(res, 400, { error: 'Неизвестное действие' });
});
