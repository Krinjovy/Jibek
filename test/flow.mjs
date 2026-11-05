import crypto from 'crypto';

const salt = 'a1b2c3d4e5f67890';
const password = 'correct-horse';
const hash = crypto.pbkdf2Sync(password, salt, 1000, 32, 'sha256').toString('hex');
process.env.SESSION_SECRET = 'test-session-secret-value-32';
process.env.ADMIN_LOGIN = 'jibek-admin';
process.env.ADMIN_PASSWORD_HASH = 'pbkdf2_sha256$1000$' + salt + '$' + hash;
process.env.VERCEL_ENV = '';

const { useMemoryStore } = await import('../api/_lib/store.js');
const { verifyAdminPassword } = await import('../api/_lib/auth.js');
const track = (await import('../api/track.js')).default;
const promo = (await import('../api/promo.js')).default;
const partnerLogin = (await import('../api/partner/login.js')).default;
const partnerDash = (await import('../api/partner/dashboard.js')).default;
const adminLogin = (await import('../api/admin/login.js')).default;
const adminOverview = (await import('../api/admin/overview.js')).default;
const adminPartner = (await import('../api/admin/partner.js')).default;
const adminOrders = (await import('../api/admin/orders.js')).default;
const adminPayouts = (await import('../api/admin/payouts.js')).default;

const memory = useMemoryStore();
const failures = [];
const check = (name, ok, detail) => {
  console.log((ok ? 'PASS ' : 'FAIL ') + name + (detail ? ' — ' + detail : ''));
  if (!ok) failures.push(name);
};

function res() {
  return {
    _sent: false,
    statusCode: 0,
    headers: {},
    body: '',
    setHeader(key, value) { this.headers[key.toLowerCase()] = value; },
    end(value) { this.body = value == null ? '' : String(value); this._sent = true; },
    json() { return this.body ? JSON.parse(this.body) : null; }
  };
}
function req(method, url, body, headers) {
  return { method, url, body, headers: headers || {} };
}
function cookieFrom(response) {
  const raw = response.headers['set-cookie'] || '';
  return raw.split(';')[0];
}

process.env.ADMIN_PASSWORD_HASH = 'not-a-hash';
check('bad hash format is false', verifyAdminPassword(password) === false);
process.env.ADMIN_PASSWORD_HASH = 'pbkdf2_sha256$1000$' + salt + '$' + hash;
check('admin password matches hash', verifyAdminPassword(password) === true);
check('admin password rejects wrong secret', verifyAdminPassword('nope') === false);

let response = res();
await promo(req('GET', '/api/promo?code=ALIYA10'), response);
check('empty list rejects promo', response.json().valid === false);

response = res();
await adminLogin(req('POST', '/api/admin/login', { login: 'jibek-admin', password: 'wrong' }, { 'x-forwarded-for': '3.3.3.3' }), response);
check('wrong admin password', response.statusCode === 401);

response = res();
await adminLogin(req('POST', '/api/admin/login', { login: 'jibek-admin', password }, { 'x-forwarded-for': '2.2.2.2' }), response);
const adminCookie = cookieFrom(response);
check('admin login', response.statusCode === 200 && adminCookie.startsWith('jibek_session=') && response.headers['set-cookie'].includes('HttpOnly'), response.statusCode + ' ' + response.headers['set-cookie']);
response = res();
await adminLogin(req('POST', '/api/admin/login', { login: 'jibek-admin', password }, { 'x-forwarded-for': '8.8.8.8', 'x-forwarded-proto': 'https' }), response);
check('secure cookie on https', (response.headers['set-cookie'] || '').includes('Secure'));

response = res();
await adminPartner(req('POST', '/api/admin/partner', {
  action: 'create', code: 'aliya10', name: 'Алия', contact: 'tg @aliya', payoutKzt: 5000
}, { cookie: adminCookie }), response);
const created = response.json();
check('create partner shows pin once', response.statusCode === 200 && /^\d{6}$/.test(created.pin) && created.partner.code === 'ALIYA10');
const stored = JSON.parse(memory.get('partners/ALIYA10.json'));
check('pin is hashed', stored.pinHash && stored.pinHash !== created.pin && !JSON.stringify(stored).includes(created.pin));

response = res();
await promo(req('GET', '/api/promo?code=aliya10'), response);
check('active promo', response.json().valid === true && response.json().discount === 0.1);

response = res();
await track(req('POST', '/api/track', { type: 'visit', code: 'NOBODY10', visitorId: 'visitor-one-1' }), response);
check('unknown code ignored', response.json().ignored === true && ![...memory.keys()].some(key => key.startsWith('events/NOBODY10')));

const visitor = 'visitor-one-1';
const other = 'visitor-two-22';
async function postTrack(body) {
  const out = res();
  await track(req('POST', '/api/track', body), out);
  return out;
}
await postTrack({ type: 'visit', code: 'ALIYA10', visitorId: visitor });
await postTrack({ type: 'visit', code: 'ALIYA10', visitorId: visitor });
await postTrack({ type: 'visit', code: 'ALIYA10', visitorId: other });
await postTrack({ type: 'checkout_open', code: 'ALIYA10', visitorId: visitor });
await postTrack({ type: 'address_filled', code: 'ALIYA10', visitorId: visitor, firstName: 'Айгерим Сериккызы', city: 'Семей', phone: '+77001112233', street: 'Secret street 1' });
await postTrack({ type: 'whatsapp_click', code: 'ALIYA10', visitorId: visitor });
const ordered = await postTrack({
  type: 'order_sent',
  code: 'ALIYA10',
  visitorId: visitor,
  firstName: 'Айгерим Сериккызы',
  city: 'Семей',
  phone: '+77001112233',
  street: 'Secret street 1',
  order: { house: 'Гриффиндор', size: 'M', qty: 2, bundle: 2, total: 43990, promo: 'ALIYA10', items: [{ house: 'Гриффиндор', size: 'M' }, { house: 'Пуффендуй', size: 'XL' }], phone: '+77001112233' }
});
check('order tracked', ordered.json().ok === true && !ordered.json().ignored);
const dumped = [...memory.values()].join('\n');
check('phone and street never stored', !dumped.includes('+77001112233') && !dumped.includes('Secret street'));
const orderBlob = [...memory.entries()].find(([key]) => key.startsWith('orders/'));
const order = JSON.parse(orderBlob[1]);
check('order keeps first name and city', order.firstName === 'Айгерим' && order.city === 'Семей' && order.qty === 2 && order.total === 43990 && order.status === 'new');

response = res();
await partnerLogin(req('POST', '/api/partner/login', { code: 'ALIYA10', pin: '000000' }, { 'x-forwarded-for': '1.1.1.1' }), response);
check('bad partner pin', response.statusCode === 401);

response = res();
await partnerLogin(req('POST', '/api/partner/login', { code: 'ALIYA10', pin: created.pin }, { 'x-forwarded-for': '1.1.1.1' }), response);
const partnerCookie = cookieFrom(response);
check('partner login', response.statusCode === 200);
response = res();
await partnerDash(req('GET', '/api/partner/dashboard', null, { cookie: partnerCookie }), response);
const dash = response.json();
check('unique visits', dash.windows.all.visits === 2, JSON.stringify(dash.windows.all));
check('funnel counts', dash.windows.all.checkoutOpens === 1 && dash.windows.all.addressFilled === 1 && dash.windows.all.whatsappClicks === 1 && dash.windows.all.ordersSent === 1 && dash.orders[0].firstName === 'Айгерим');
check('link', dash.link === 'https://jibek.store/?ref=ALIYA10');
check('nothing earned yet', dash.windows.all.earned === 0 && dash.balance === 0);

response = res();
await adminOverview(req('GET', '/api/admin/overview', null, { cookie: partnerCookie }), response);
check('partner cannot open admin', response.statusCode === 401);

response = res();
await adminOrders(req('POST', '/api/admin/orders', { id: order.id, status: 'confirmed' }, { cookie: adminCookie }), response);
check('confirm order', response.json().order.status === 'confirmed');
response = res();
await partnerDash(req('GET', '/api/partner/dashboard', null, { cookie: partnerCookie }), response);
check('earned payout', response.json().windows.all.earned === 5000 && response.json().balance === 5000);

response = res();
await adminPayouts(req('POST', '/api/admin/payouts', { code: 'ALIYA10', amount: 2000, date: '2026-11-05' }, { cookie: adminCookie }), response);
check('payout recorded', response.statusCode === 200);
response = res();
await partnerDash(req('GET', '/api/partner/dashboard', null, { cookie: partnerCookie }), response);
check('balance after payout', response.json().windows.all.paidOut === 2000 && response.json().balance === 3000, JSON.stringify({ paid: response.json().windows.all.paidOut, balance: response.json().balance }));

response = res();
await adminPartner(req('POST', '/api/admin/partner', { action: 'reset_pin', code: 'ALIYA10' }, { cookie: adminCookie }), response);
const newPin = response.json().pin;
response = res();
await partnerLogin(req('POST', '/api/partner/login', { code: 'ALIYA10', pin: created.pin }, { 'x-forwarded-for': '4.4.4.4' }), response);
check('old pin rejected', response.statusCode === 401);
response = res();
await partnerLogin(req('POST', '/api/partner/login', { code: 'ALIYA10', pin: newPin }, { 'x-forwarded-for': '4.4.4.4' }), response);
check('new pin works', response.statusCode === 200 && /^\d{6}$/.test(newPin) && newPin !== created.pin);

response = res();
await adminPartner(req('POST', '/api/admin/partner', { action: 'set_active', code: 'ALIYA10', active: false }, { cookie: adminCookie }), response);
response = res();
await promo(req('GET', '/api/promo?code=ALIYA10'), response);
check('inactive promo', response.json().valid === false);
response = await postTrack({ type: 'visit', code: 'ALIYA10', visitorId: 'visitor-three3' });
check('inactive track ignored', response.json().ignored === true);

for (let i = 0; i < 5; i++) {
  response = res();
  await adminLogin(req('POST', '/api/admin/login', { login: 'jibek-admin', password: 'wrong' }, { 'x-forwarded-for': '9.9.9.9' }), response);
}
response = res();
await adminLogin(req('POST', '/api/admin/login', { login: 'jibek-admin', password }, { 'x-forwarded-for': '9.9.9.9' }), response);
check('admin lockout', response.statusCode === 429, String(response.statusCode));

response = res();
await adminOverview(req('GET', '/api/admin/overview', null, { cookie: adminCookie }), response);
const overview = response.json();
check('partners sorted', overview.partners[0].code === 'ALIYA10' && overview.partners[0].confirmed === 1);

if (failures.length) {
  console.error('FAILURES\n' + failures.join('\n'));
  process.exit(1);
}
console.log('ALL PASS');
