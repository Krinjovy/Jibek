import { recordTrack } from './_lib/domain.js';
import { readBody, send, wrap } from './_lib/http.js';

export default wrap(async function track(req, res) {
  if (req.method !== 'POST') return send(res, 405, { error: 'method' });
  const body = await readBody(req);
  const result = await recordTrack(body);
  if (!result.ok) return send(res, 400, { error: result.error || 'Некорректные данные' });
  return send(res, 200, { ok: true, ignored: !!result.ignored });
});
