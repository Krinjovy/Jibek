import { cleanCode, readPartner } from './_lib/domain.js';
import { send, wrap } from './_lib/http.js';

export default wrap(async function promo(req, res) {
  if (req.method !== 'GET') return send(res, 405, { error: 'method' });
  const url = new URL(req.url, 'http://localhost');
  const code = cleanCode(url.searchParams.get('code'));
  const partner = code ? await readPartner(code) : null;
  if (!partner || !partner.active) return send(res, 200, { valid: false });
  return send(res, 200, { valid: true, discount: 0.1 });
});
