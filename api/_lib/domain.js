import crypto from 'crypto';
import { readAll, readJson, writeJson } from './store.js';

const CODE_RE = /^[A-Z][A-Z0-9]{2,15}$/;
const TRACK_CODE_RE = /^[A-Z0-9]{3,16}$/;
const VID_RE = /^[A-Za-z0-9_-]{8,64}$/;
const TYPES = new Set(['visit', 'checkout_open', 'address_filled', 'whatsapp_click', 'order_sent']);
const STATUSES = new Set(['new', 'confirmed', 'cancelled', 'paid']);
export const DEFAULT_PAYOUT = 5000;
const DAY = 86400000;
const ALMATY = 5 * 3600000;

export function cleanCode(value, pattern = CODE_RE) {
  const code = String(value || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 16);
  return pattern.test(code) ? code : '';
}

function clip(value, max) {
  return String(value == null ? '' : value).replace(/\s+/g, ' ').trim().slice(0, max);
}

export function firstNameOf(value) {
  return clip(value, 80).split(' ')[0].slice(0, 40);
}

export function hashPin(pin, salt = crypto.randomBytes(16).toString('hex')) {
  const pinHash = crypto.scryptSync(String(pin), salt, 32).toString('hex');
  return { pinSalt: salt, pinHash };
}

export function verifyPin(pin, partner) {
  if (!partner || !partner.pinSalt || !/^[0-9a-fA-F]+$/.test(partner.pinHash || '')) return false;
  let derived;
  try {
    derived = crypto.scryptSync(String(pin), partner.pinSalt, 32);
  } catch (e) {
    return false;
  }
  const expected = Buffer.from(partner.pinHash, 'hex');
  if (derived.length !== expected.length) return false;
  return crypto.timingSafeEqual(derived, expected);
}

export function randomPin() {
  return crypto.randomInt(0, 1000000).toString().padStart(6, '0');
}

export function partnerPath(code) {
  return 'partners/' + code + '.json';
}

export async function readPartner(code) {
  if (!code) return null;
  return readJson(partnerPath(code));
}

export function publicPartner(partner) {
  return {
    code: partner.code,
    name: partner.name,
    contact: partner.contact || '',
    payoutKzt: partner.payoutKzt,
    active: !!partner.active,
    createdAt: partner.createdAt
  };
}

export async function createPartner({ code, name, contact, payoutKzt }) {
  const clean = cleanCode(code);
  if (!clean) return { error: 'Код вроде ALIYA10: латиница и цифры, от 3 символов' };
  const label = clip(name, 80);
  if (label.length < 2) return { error: 'Укажите имя' };
  if (await readPartner(clean)) return { error: 'Такой код уже есть', status: 409 };
  let payout = payoutKzt == null || payoutKzt === '' ? DEFAULT_PAYOUT : Math.round(Number(payoutKzt));
  if (!Number.isFinite(payout) || payout < 0 || payout > 10000000) return { error: 'Некорректная выплата' };
  const pin = randomPin();
  const hashed = hashPin(pin);
  const partner = {
    code: clean,
    name: label,
    contact: clip(contact, 120),
    pinSalt: hashed.pinSalt,
    pinHash: hashed.pinHash,
    payoutKzt: payout,
    active: true,
    createdAt: new Date().toISOString()
  };
  await writeJson(partnerPath(clean), partner);
  return { partner: publicPartner(partner), pin };
}

export async function setPartnerActive(code, active) {
  const partner = await readPartner(cleanCode(code));
  if (!partner) return null;
  partner.active = !!active;
  await writeJson(partnerPath(partner.code), partner);
  return publicPartner(partner);
}

export async function resetPartnerPin(code) {
  const partner = await readPartner(cleanCode(code));
  if (!partner) return null;
  const pin = randomPin();
  const hashed = hashPin(pin);
  partner.pinSalt = hashed.pinSalt;
  partner.pinHash = hashed.pinHash;
  await writeJson(partnerPath(partner.code), partner);
  return { code: partner.code, pin };
}

export async function recordTrack(input) {
  const type = String(input && input.type || '');
  if (!TYPES.has(type)) return { ok: false, error: 'Неизвестный тип' };
  const code = cleanCode(input.code, TRACK_CODE_RE);
  const visitorId = String(input && input.visitorId || '');
  if (!code || !VID_RE.test(visitorId)) return { ok: false, error: 'Некорректные данные' };
  const partner = await readPartner(code);
  if (!partner || !partner.active) return { ok: true, ignored: true };

  const event = {
    type,
    code,
    visitorId,
    ts: new Date().toISOString(),
    firstName: firstNameOf(input.firstName),
    city: clip(input.city, 80)
  };

  if (type === 'order_sent') {
    const src = input.order && typeof input.order === 'object' ? input.order : {};
    const items = Array.isArray(src.items) ? src.items.slice(0, 8).map(item => ({
      house: clip(item && item.house, 40),
      size: clip(item && item.size, 8)
    })) : [];
    const qty = Math.max(1, Math.min(20, Math.round(Number(src.qty) || items.length || 1)));
    const total = Math.max(0, Math.min(10000000, Math.round(Number(src.total) || 0)));
    const bundle = [1, 2, 4].includes(Number(src.bundle)) ? Number(src.bundle) : qty;
    const id = 'ord_' + Date.now().toString(36) + '_' + crypto.randomBytes(4).toString('hex');
    const order = {
      id,
      code,
      ts: event.ts,
      house: clip(src.house, 40) || (items[0] && items[0].house) || '',
      size: clip(src.size, 8) || (items[0] && items[0].size) || '',
      qty,
      bundle,
      total,
      promo: cleanCode(src.promo, TRACK_CODE_RE) || code,
      firstName: event.firstName,
      city: event.city,
      items,
      status: 'new',
      visitorId
    };
    await writeJson('orders/' + id + '.json', order);
    event.orderId = id;
  }

  const path = 'events/' + code + '/' + Date.now() + '-' + crypto.randomBytes(3).toString('hex') + '.json';
  await writeJson(path, event);
  return { ok: true };
}

export async function setOrderStatus(id, status) {
  const orderId = String(id || '');
  if (!/^ord_[a-z0-9_]+$/i.test(orderId) || !STATUSES.has(status)) return null;
  const order = await readJson('orders/' + orderId + '.json');
  if (!order) return null;
  order.status = status;
  await writeJson('orders/' + order.id + '.json', order);
  return publicOrder(order);
}

export async function recordPayout({ code, amount, date }) {
  const partner = await readPartner(cleanCode(code));
  if (!partner) return { error: 'Партнёр не найден' };
  const sum = Math.round(Number(amount));
  if (!Number.isFinite(sum) || sum <= 0 || sum > 100000000) return { error: 'Некорректная сумма' };
  const day = String(date || '').slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return { error: 'Укажите дату' };
  const id = 'pay_' + Date.now().toString(36) + '_' + crypto.randomBytes(3).toString('hex');
  const payout = { id, code: partner.code, amount: sum, date: day, createdAt: new Date().toISOString() };
  await writeJson('payouts/' + partner.code + '/' + id + '.json', payout);
  return { payout };
}

function payoutTime(payout) {
  if (payout.date && /^\d{4}-\d{2}-\d{2}$/.test(payout.date)) {
    return new Date(payout.date + 'T00:00:00+05:00').getTime();
  }
  return new Date(payout.createdAt || 0).getTime();
}

function windowStart(name, now) {
  if (name === 'all') return 0;
  if (name === 'd7') return now - 7 * DAY;
  return Math.floor((now + ALMATY) / DAY) * DAY - ALMATY;
}

export function publicOrder(order) {
  return {
    id: order.id,
    ts: order.ts,
    house: order.house,
    size: order.size,
    qty: order.qty,
    total: order.total,
    promo: order.promo,
    firstName: order.firstName || '',
    city: order.city || '',
    status: order.status,
    items: order.items || []
  };
}

export function buildStats({ payoutKzt, events, orders, payouts, now = Date.now() }) {
  const windows = {};
  for (const name of ['today', 'd7', 'all']) {
    const start = windowStart(name, now);
    const ev = events.filter(event => new Date(event.ts).getTime() >= start);
    const inOrders = orders.filter(order => new Date(order.ts).getTime() >= start);
    const confirmed = inOrders.filter(order => order.status === 'confirmed' || order.status === 'paid').length;
    const paidOut = payouts.filter(payout => payoutTime(payout) >= start).reduce((sum, payout) => sum + (payout.amount || 0), 0);
    windows[name] = {
      visits: new Set(ev.filter(event => event.type === 'visit').map(event => event.visitorId)).size,
      checkoutOpens: ev.filter(event => event.type === 'checkout_open').length,
      addressFilled: ev.filter(event => event.type === 'address_filled').length,
      whatsappClicks: ev.filter(event => event.type === 'whatsapp_click').length,
      ordersSent: inOrders.length,
      confirmed,
      earned: confirmed * payoutKzt,
      paidOut
    };
  }
  return {
    windows,
    balance: windows.all.earned - windows.all.paidOut
  };
}

export async function statsFor(code) {
  const partner = await readPartner(code);
  if (!partner) return null;
  const [events, orders, payouts] = await Promise.all([
    readAll('events/' + code + '/'),
    readAll('orders/').then(rows => rows.filter(order => order.code === code)),
    readAll('payouts/' + code + '/')
  ]);
  const stats = buildStats({ payoutKzt: partner.payoutKzt, events, orders, payouts });
  const recent = orders
    .slice()
    .sort((a, b) => new Date(b.ts) - new Date(a.ts))
    .slice(0, 40)
    .map(publicOrder);
  return {
    partner: publicPartner(partner),
    link: 'https://jibek.store/?ref=' + partner.code,
    ...stats,
    orders: recent
  };
}

export async function overview() {
  const partners = await readAll('partners/');
  const orders = await readAll('orders/');
  const payouts = await readAll('payouts/');
  const rows = [];
  const allEvents = [];
  for (const partner of partners) {
    const events = await readAll('events/' + partner.code + '/');
    allEvents.push(...events);
    const mineOrders = orders.filter(order => order.code === partner.code);
    const minePays = payouts.filter(payout => payout.code === partner.code);
    const stats = buildStats({ payoutKzt: partner.payoutKzt, events, orders: mineOrders, payouts: minePays });
    rows.push({ ...publicPartner(partner), ...stats, ordersSent: stats.windows.all.ordersSent, confirmed: stats.windows.all.confirmed });
  }
  rows.sort((a, b) => b.confirmed - a.confirmed || b.ordersSent - a.ordersSent || a.code.localeCompare(b.code));
  const totals = buildStats({
    payoutKzt: 0,
    events: allEvents,
    orders,
    payouts
  });
  totals.windows.today.earned = rows.reduce((sum, row) => sum + row.windows.today.earned, 0);
  totals.windows.d7.earned = rows.reduce((sum, row) => sum + row.windows.d7.earned, 0);
  totals.windows.all.earned = rows.reduce((sum, row) => sum + row.windows.all.earned, 0);
  totals.balance = totals.windows.all.earned - totals.windows.all.paidOut;
  return { totals, partners: rows };
}
