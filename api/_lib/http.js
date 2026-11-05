export function send(res, status, data, headers) {
  if (res._sent) return;
  res._sent = true;
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  if (headers) {
    for (const [key, value] of Object.entries(headers)) res.setHeader(key, value);
  }
  res.end(JSON.stringify(data));
}

export async function readBody(req, limit = 8000) {
  if (req.body && typeof req.body === 'object' && !Buffer.isBuffer(req.body)) return req.body;
  if (typeof req.body === 'string') {
    try { return JSON.parse(req.body.slice(0, limit)); } catch (e) { return {}; }
  }
  if (!req || typeof req[Symbol.asyncIterator] !== 'function') return {};
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buf.length;
    if (size > limit) break;
    chunks.push(buf);
  }
  const text = Buffer.concat(chunks).toString('utf8').slice(0, limit);
  if (!text) return {};
  try { return JSON.parse(text); } catch (e) { return {}; }
}

export function clientIp(req) {
  const header = req.headers['x-forwarded-for'];
  const raw = Array.isArray(header) ? header[0] : (header || '');
  return (String(raw).split(',')[0].trim() || 'local').slice(0, 64);
}

export function wrap(fn) {
  return async function handler(req, res) {
    try {
      await fn(req, res);
    } catch (err) {
      console.error(err);
      send(res, 500, { error: 'Что-то пошло не так' });
    }
  };
}
