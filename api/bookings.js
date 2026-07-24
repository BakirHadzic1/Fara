const OWNER = process.env.GITHUB_OWNER || 'BakirHadzic1';
const REPO = process.env.GITHUB_REPO || 'Fara';
const BRANCH = process.env.GITHUB_BRANCH || 'main';
const FILE_PATH = process.env.BOOKINGS_FILE || 'data/bookings.json';
const ADMIN_PIN = process.env.ADMIN_PIN || '2026';
const ADMIN_EMAIL = process.env.ADMIN_EMAIL || 'fara.termini@gmail.com';

function send(res, status, payload) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify(payload));
}

function githubToken() {
  return process.env.FARA_GITHUB_TOKEN || process.env.GITHUB_TOKEN;
}

function authHeaders() {
  const token = githubToken();
  const username = process.env.GITHUB_USERNAME || OWNER;
  return {
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
    Authorization: token ? `Basic ${Buffer.from(`${username}:${token}`).toString('base64')}` : ''
  };
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

async function readBookingsFile() {
  const url = `https://api.github.com/repos/${OWNER}/${REPO}/contents/${FILE_PATH}?ref=${BRANCH}`;
  const data = await githubRequest(url);
  const content = Buffer.from(data.content || '', 'base64').toString('utf8');
  return { bookings: JSON.parse(content || '[]'), sha: data.sha };
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

function formatDate(dateString) {
  const date = new Date(`${dateString}T12:00:00`);
  return date.toLocaleDateString('bs-BA', { weekday: 'long', day: '2-digit', month: '2-digit', year: 'numeric' });
}

function nextRenewalDate(dateString) {
  const date = new Date(`${dateString}T12:00:00`);
  date.setMonth(date.getMonth() + 1);
  return date.toISOString().slice(0, 10);
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
    category: item.category,
    status: item.status
  };
}

function cleanText(value) {
  return String(value || '').trim().slice(0, 500);
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

  if (!githubToken()) {
    return send(res, 500, { error: 'Server nije podešen: nedostaje GitHub token.' });
  }

  try {
    if (req.method === 'GET') {
      const { bookings } = await readBookingsFile();
      const active = bookings.filter(item => item.status !== 'deleted');
      return send(res, 200, {
        bookings: isAdmin(req) ? active : active.map(publicBooking),
        admin: isAdmin(req),
        adminEmail: isAdmin(req) ? ADMIN_EMAIL : undefined
      });
    }

    if (req.method === 'POST') {
      const body = await readBody(req);
      const date = cleanText(body.date);
      const time = cleanText(body.time);
      const type = body.type === 'monthly' ? 'monthly' : 'single';
      const category = body.category === 'school' ? 'school' : 'standard';
      const name = cleanText(body.name);
      const phone = cleanText(body.phone);
      const email = cleanText(body.email);
      const note = cleanText(body.note);

      if (!date || !time || !name || !phone) {
        return send(res, 400, { error: 'Datum, vrijeme, ime i telefon su obavezni.' });
      }

      const result = await mutateBookings(async bookings => {
        const taken = bookings.some(item => item.date === date && item.time === time && item.status !== 'cancelled' && item.status !== 'deleted');
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
          category,
          name,
          phone,
          email,
          note,
          price: bookingPrice(type, category, time),
          paid: false,
          status: 'pending',
          renewalDate: type === 'monthly' ? nextRenewalDate(date) : '',
          adminEmail: ADMIN_EMAIL
        };
        bookings.push(booking);
        return { bookings, result: booking };
      });

      return send(res, 201, { booking: result });
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
          return updated || item;
        });
        return { bookings: next, result: updated };
      });

      return send(res, 200, { booking: result });
    }

    return send(res, 405, { error: 'Metoda nije podržana.' });
  } catch (error) {
    return send(res, error.publicStatus || error.status || 500, { error: error.message || 'Greška na serveru.' });
  }
};
