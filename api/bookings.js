const OWNER = process.env.GITHUB_OWNER || 'BakirHadzic1';
const REPO = process.env.GITHUB_REPO || 'Fara';
const BRANCH = process.env.GITHUB_BRANCH || 'main';
const FILE_PATH = process.env.BOOKINGS_FILE || 'data/bookings.json';
const ADMIN_PIN = process.env.ADMIN_PIN || '2026';
const ADMIN_EMAIL = process.env.ADMIN_EMAIL || 'fara.termini@gmail.com';
const SMTP_HOST = process.env.SMTP_HOST || 'smtp.gmail.com';
const SMTP_PORT = Number(process.env.SMTP_PORT || 465);
const SMTP_USER = process.env.SMTP_USER || ADMIN_EMAIL;
const SMTP_PASS = process.env.SMTP_PASS || '';
const SMTP_TO = process.env.SMTP_TO || ADMIN_EMAIL;
const BREVO_API_KEY = process.env.BREVO_API_KEY || '';
const RESEND_API_KEY = process.env.RESEND_API_KEY || '';
const MAIL_FROM = process.env.MAIL_FROM || ADMIN_EMAIL;

function send(res, status, payload) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PATCH, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Admin-Pin');
  res.end(JSON.stringify(payload));
}

function githubToken() {
  return process.env.FARA_GITHUB_TOKEN || process.env.GITHUB_TOKEN;
}

function authHeaders() {
  const token = githubToken();
  const username = process.env.GITHUB_USERNAME || OWNER;
  const headers = {
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28'
  };
  if (token) headers.Authorization = `Basic ${Buffer.from(`${username}:${token}`).toString('base64')}`;
  return headers;
}

async function readBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const raw = Buffer.concat(chunks).toString('utf8');
  return raw ? JSON.parse(raw) : {};
}

async function githubRequest(url, options = {}) {
  const response = await fetch(url, {
    ...options,
    headers: { ...authHeaders(), ...(options.headers || {}) }
  });
  const text = await response.text();
  const data = text ? JSON.parse(text) : null;
  if (!response.ok) {
    const message = data?.message || `GitHub request failed: ${response.status}`;
    const error = new Error(message);
    error.status = response.status;
    throw error;
  }
  return data;
}

async function readRawJson() {
  const url = `https://raw.githubusercontent.com/${OWNER}/${REPO}/${BRANCH}/${FILE_PATH}`;
  const response = await fetch(url, { headers: { Accept: 'application/json' } });
  if (!response.ok) throw new Error(`GitHub raw read failed: ${response.status}`);
  return response.json();
}

async function readBookingsFile(options = {}) {
  const url = `https://api.github.com/repos/${OWNER}/${REPO}/contents/${FILE_PATH}?ref=${BRANCH}`;
  try {
    const data = await githubRequest(url);
    const content = Buffer.from(data.content || '', 'base64').toString('utf8');
    return { bookings: JSON.parse(content || '[]'), sha: data.sha, readonly: false };
  } catch (error) {
    if (!options.allowPublicFallback || ![401, 403].includes(error.status)) throw error;
    return { bookings: await readRawJson(), sha: '', readonly: true };
  }
}

async function writeBookingsFile(bookings, sha) {
  const url = `https://api.github.com/repos/${OWNER}/${REPO}/contents/${FILE_PATH}`;
  return githubRequest(url, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      message: 'Update FARA bookings',
      branch: BRANCH,
      sha,
      content: Buffer.from(`${JSON.stringify(bookings, null, 2)}\n`).toString('base64')
    })
  });
}

function bookingPrice(type, category, time) {
  const hour = Number(String(time || '0').split(':')[0]);
  if (type === 'monthly') return 200;
  if (category === 'school' && hour >= 8 && hour < 16) return 30;
  return 50;
}

function isSlotClosed(dateString, time) {
  const date = toLocalDate(dateString);
  const hour = Number(String(time || '0').split(':')[0]);
  return date.getDay() === 0 && (hour < 12 || hour >= 22);
}

function formatDate(dateString) {
  const date = new Date(`${dateString}T12:00:00`);
  return date.toLocaleDateString('bs-BA', { weekday: 'long', day: '2-digit', month: '2-digit', year: 'numeric' });
}

function nextRenewalDate(dateString) {
  const date = new Date(`${dateString}T12:00:00`);
  date.setMonth(date.getMonth() + 1);
  return date.toISOString().slice(0, 10);
}

function toLocalDate(dateString) {
  return new Date(`${dateString}T12:00:00`);
}

function toDateValue(date) {
  return date.toISOString().slice(0, 10);
}

function addDays(date, days) {
  const copy = new Date(date);
  copy.setDate(copy.getDate() + days);
  return copy;
}

function addMonths(dateString, months) {
  const date = toLocalDate(dateString);
  date.setMonth(date.getMonth() + months);
  return toDateValue(date);
}

function bookingMonths(value) {
  const months = Number(value || 1);
  if (!Number.isFinite(months)) return 1;
  return Math.min(12, Math.max(1, Math.round(months)));
}

function monthsLabel(value) {
  const months = bookingMonths(value);
  if (months === 1) return '1 mjesec';
  if (months >= 2 && months <= 4) return `${months} mjeseca`;
  return `${months} mjeseci`;
}

function bookingEndDate(booking) {
  return booking.type === 'monthly' ? (booking.endDate || addMonths(booking.date, booking.months || 1)) : booking.date;
}

function bookingOccurrenceDates(booking) {
  if (booking.type !== 'monthly') return [booking.date];
  const endDate = bookingEndDate(booking);
  const dates = [];
  for (let date = toLocalDate(booking.date); toDateValue(date) < endDate; date = addDays(date, 7)) {
    dates.push(toDateValue(date));
  }
  return dates;
}

function bookingCoversDate(booking, date) {
  if (booking.date === date) return true;
  if (booking.type !== 'monthly') return false;
  if (date < booking.date || date >= bookingEndDate(booking)) return false;
  return toLocalDate(date).getDay() === toLocalDate(booking.date).getDay();
}

function bookingsConflict(existing, requested) {
  if (existing.time !== requested.time || existing.status === 'cancelled' || existing.status === 'deleted') return false;
  return bookingOccurrenceDates(requested).some(date => bookingCoversDate(existing, date));
}

function isAdmin(req) {
  return req.headers['x-admin-pin'] === ADMIN_PIN;
}

function publicBooking(item) {
  return {
    id: item.id,
    date: item.date,
    time: item.time,
    type: item.type,
    months: item.months,
    endDate: item.endDate,
    category: item.category,
    status: item.status
  };
}

function ownerBooking(item) {
  return {
    id: item.id,
    date: item.date,
    time: item.time,
    type: item.type,
    months: item.months,
    endDate: item.endDate,
    category: item.category,
    status: item.status,
    price: item.price,
    paid: item.paid,
    name: item.name,
    renewalDate: item.renewalDate,
    source: item.source
  };
}

function normalizePhone(value) {
  const raw = String(value || '').trim();
  if (!raw) return '';
  const digits = raw.replace(/\D/g, '');
  if (digits.startsWith('00387')) return `387${digits.slice(5)}`;
  if (digits.startsWith('0')) return `387${digits.slice(1)}`;
  return digits;
}

function samePhone(left, right) {
  return normalizePhone(left) === normalizePhone(right);
}

function normalizeLookupName(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ');
}

function sameLookupName(left, right) {
  const a = normalizeLookupName(left);
  const b = normalizeLookupName(right);
  return Boolean(a && b && a === b);
}

function cleanText(value) {
  return String(value || '').trim().slice(0, 500);
}

function makeCancelToken() {
  return require('crypto').randomBytes(16).toString('hex');
}

function makeUserPin() {
  return String(Math.floor(1000 + Math.random() * 9000));
}

function cleanPin(value) {
  return String(value || '').replace(/\D/g, '').slice(0, 6);
}

function escapeHtml(value) {
  return String(value || '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function mailEnabled() {
  return Boolean((BREVO_API_KEY || RESEND_API_KEY || (SMTP_USER && SMTP_PASS)) && SMTP_TO);
}

function bookingMailHtml(booking) {
  const type = booking.type === 'monthly' ? 'Stalni mjesečni termin' : 'Jedan termin';
  const category = booking.category === 'school' ? 'Školarci / akademije / klubovi' : 'Standardni termin';
  const period = booking.type === 'monthly' ? `<p><strong>Period:</strong> ${escapeHtml(monthsLabel(booking.months))}, do ${escapeHtml(formatDate(booking.endDate))}</p>` : '';
  return `
    <div style="font-family:Arial,sans-serif;color:#181b1f;line-height:1.5">
      <h2 style="margin:0 0 12px;color:#df1f2d">Nova rezervacija termina</h2>
      <p><strong>Termin:</strong> ${escapeHtml(formatDate(booking.date))} u ${escapeHtml(booking.time)}</p>
      ${period}
      <p><strong>Cijena:</strong> ${escapeHtml(booking.price)} KM mjesečno</p>
      <p><strong>Tip:</strong> ${escapeHtml(type)}</p>
      <p><strong>Kategorija:</strong> ${escapeHtml(category)}</p>
      <hr style="border:none;border-top:1px solid #ddd;margin:18px 0">
      <p><strong>Ime:</strong> ${escapeHtml(booking.name)}</p>
      <p><strong>Telefon:</strong> ${escapeHtml(booking.phone)}</p>
      <p><strong>Email:</strong> ${escapeHtml(booking.email || 'Nije upisan')}</p>
      <p><strong>Napomena:</strong> ${escapeHtml(booking.note || 'Nema napomene')}</p>
      <p style="margin-top:18px"><a href="https://www.fara.ba/admin.html">Otvori admin panel</a></p>
    </div>
  `;
}

function bookingMailText(booking) {
  const type = booking.type === 'monthly' ? 'Stalni mjesečni termin' : 'Jedan termin';
  const category = booking.category === 'school' ? 'Školarci / akademije / klubovi' : 'Standardni termin';
  const period = booking.type === 'monthly' ? [`Period: ${monthsLabel(booking.months)}, do ${formatDate(booking.endDate)}`] : [];
  return [
    'Nova rezervacija termina',
    '',
    `Termin: ${formatDate(booking.date)} u ${booking.time}`,
    ...period,
    `Cijena: ${booking.price} KM mjesečno`,
    `Tip: ${type}`,
    `Kategorija: ${category}`,
    '',
    `Ime: ${booking.name}`,
    `Telefon: ${booking.phone}`,
    `Email: ${booking.email || 'Nije upisan'}`,
    `Napomena: ${booking.note || 'Nema napomene'}`,
    '',
    'Admin panel: https://www.fara.ba/admin.html'
  ].join('\n');
}

async function sendBookingEmail(booking) {
  if (!mailEnabled()) return false;

  if (BREVO_API_KEY) {
    const response = await fetch('https://api.brevo.com/v3/smtp/email', {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
        'api-key': BREVO_API_KEY
      },
      body: JSON.stringify({
        sender: { name: 'FARA rezervacije', email: MAIL_FROM },
        to: [{ email: SMTP_TO }],
        replyTo: booking.email ? { email: booking.email, name: booking.name } : undefined,
        subject: `Nova rezervacija: ${booking.date} u ${booking.time}`,
        htmlContent: bookingMailHtml(booking),
        textContent: bookingMailText(booking)
      })
    });
    if (!response.ok) throw new Error(`Brevo mail failed: ${response.status}`);
    return true;
  }

  if (RESEND_API_KEY) {
    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${RESEND_API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        from: `FARA rezervacije <${MAIL_FROM}>`,
        to: [SMTP_TO],
        reply_to: booking.email || undefined,
        subject: `Nova rezervacija: ${booking.date} u ${booking.time}`,
        html: bookingMailHtml(booking),
        text: bookingMailText(booking)
      })
    });
    if (!response.ok) throw new Error(`Resend mail failed: ${response.status}`);
    return true;
  }

  const nodemailer = require('nodemailer');
  const transporter = nodemailer.createTransport({
    host: SMTP_HOST,
    port: SMTP_PORT,
    secure: SMTP_PORT === 465,
    auth: {
      user: SMTP_USER,
      pass: SMTP_PASS
    }
  });

  await transporter.sendMail({
    from: `"FARA rezervacije" <${MAIL_FROM}>`,
    to: SMTP_TO,
    replyTo: booking.email || undefined,
    subject: `Nova rezervacija: ${booking.date} u ${booking.time}`,
    text: bookingMailText(booking),
    html: bookingMailHtml(booking)
  });
  return true;
}

async function mutateBookings(mutator) {
  let current = await readBookingsFile();
  let next = await mutator(current.bookings);
  try {
    await writeBookingsFile(next.bookings, current.sha);
  } catch (error) {
    if (error.status !== 409) throw error;
    current = await readBookingsFile();
    next = await mutator(current.bookings);
    await writeBookingsFile(next.bookings, current.sha);
  }
  return next.result;
}

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return send(res, 200, { ok: true });

  if (!githubToken() && req.method !== 'GET') {
    return send(res, 500, { error: 'Server nije podešen: nedostaje GitHub token.' });
  }

  try {
    if (req.method === 'GET') {
      const url = new URL(req.url || '/', `https://${req.headers.host || 'www.fara.ba'}`);
      const mine = url.searchParams.get('mine') === '1';
      const phone = cleanText(url.searchParams.get('phone'));
      const name = cleanText(url.searchParams.get('name'));
      const userPin = cleanPin(url.searchParams.get('pin'));
      const { bookings, readonly } = await readBookingsFile({ allowPublicFallback: true });
      const active = bookings.filter(item => item.status !== 'deleted');
      if (mine) {
        if (!normalizeLookupName(name) && !normalizePhone(phone)) return send(res, 400, { error: 'Unesite ime rezervacije.' });
        if (!userPin) return send(res, 400, { error: 'Unesite PIN za pristup.' });
        const mineBookings = active
          .filter(item => item.status !== 'cancelled' && (normalizeLookupName(name) ? sameLookupName(item.name, name) : samePhone(item.phone, phone)))
          .filter(item => cleanPin(item.userPin) === userPin)
          .map(ownerBooking);
        return send(res, 200, { bookings: mineBookings, readonly, owner: true });
      }
      return send(res, 200, {
        bookings: isAdmin(req) ? active : active.map(publicBooking),
        admin: isAdmin(req),
        adminEmail: isAdmin(req) ? ADMIN_EMAIL : undefined,
        readonly
      });
    }

    if (req.method === 'POST') {
      const body = await readBody(req);
      const adminRequest = isAdmin(req);
      const date = cleanText(body.date);
      const time = cleanText(body.time);
      const type = body.type === 'monthly' ? 'monthly' : 'single';
      const category = body.category === 'school' ? 'school' : 'standard';
      const months = type === 'monthly' ? bookingMonths(body.months) : 1;
      const name = cleanText(body.name);
      const phone = cleanText(body.phone);
      const email = cleanText(body.email);
      const note = cleanText(body.note);
      const userPin = cleanPin(body.userPin) || makeUserPin();

      if (!date || !time || !name || !phone) {
        return send(res, 400, { error: 'Datum, vrijeme, ime i telefon su obavezni.' });
      }
      if (type === 'monthly' && !adminRequest) {
        return send(res, 403, { error: 'Stalni mjesečni termini se dogovaraju telefonom na 062 290 622.' });
      }
      if (isSlotClosed(date, time)) {
        return send(res, 400, { error: 'Nedjeljom su dostupni termini od 12:00 do 22:00.' });
      }

      const result = await mutateBookings(async bookings => {
        const requested = { date, time, type, months, endDate: addMonths(date, months), status: 'pending' };
        const taken = bookings.some(item => bookingsConflict(item, requested));
        if (taken) {
          const error = new Error('Ovaj termin je već rezervisan.');
          error.publicStatus = 409;
          throw error;
        }

        const booking = {
          id: `fara-${Date.now()}`,
          createdAt: new Date().toISOString(),
          date,
          day: formatDate(date).split(',')[0],
          time,
          type,
          months,
          category,
          name,
          phone,
          email,
          note,
          userPin,
          price: bookingPrice(type, category, time),
          paid: adminRequest ? Boolean(body.paid) : false,
          status: 'pending',
          renewalDate: type === 'monthly' ? nextRenewalDate(date) : '',
          endDate: type === 'monthly' ? addMonths(date, months) : '',
          cancelToken: makeCancelToken(),
          adminEmail: ADMIN_EMAIL,
          source: adminRequest ? 'admin' : 'web'
        };
        bookings.push(booking);
        return { bookings, result: booking };
      });

      let emailSent = false;
      if (!adminRequest) {
        try {
          emailSent = await sendBookingEmail(result);
        } catch (mailError) {
          console.error('Booking email failed:', mailError.message);
        }
      }

      return send(res, 201, { booking: result, emailSent });
    }

    if (req.method === 'PATCH') {
      if (!isAdmin(req)) return send(res, 401, { error: 'Pogrešan PIN.' });
      const body = await readBody(req);
      const id = cleanText(body.id);
      const action = cleanText(body.action);
      if (!id) return send(res, 400, { error: 'Nedostaje ID rezervacije.' });

      const result = await mutateBookings(async bookings => {
        let updated = null;
        const next = bookings.map(item => {
          if (item.id !== id) return item;
          if (action === 'paid') updated = { ...item, paid: !item.paid, status: item.status === 'cancelled' ? 'pending' : item.status };
          if (action === 'cancel') updated = { ...item, status: item.status === 'cancelled' ? 'pending' : 'cancelled' };
          if (action === 'delete') updated = { ...item, status: 'deleted' };
          if (action === 'pin') updated = { ...item, userPin: makeUserPin() };
          return updated || item;
        });
        return { bookings: next, result: updated };
      });

      if (!result) return send(res, 404, { error: 'Rezervacija nije pronađena ili se ne može otkazati.' });
      return send(res, 200, { booking: result });
    }

    return send(res, 405, { error: 'Metoda nije podržana.' });
  } catch (error) {
    if (error.status === 401 || error.status === 403 || error.message === 'Bad credentials') {
      return send(res, 500, { error: 'GitHub token za čuvanje podataka nije ispravan. Admin može čitati podatke, ali za izmjene treba osvježiti Vercel env FARA_GITHUB_TOKEN.' });
    }
    return send(res, error.publicStatus || error.status || 500, { error: error.message || 'Greška na serveru.' });
  }
};
