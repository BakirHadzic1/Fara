const OWNER = process.env.GITHUB_OWNER || 'BakirHadzic1';
const REPO = process.env.GITHUB_REPO || 'Fara';
const BRANCH = process.env.GITHUB_BRANCH || 'main';
const FILE_PATH = process.env.GYM_FILE || 'data/gym.json';
const ADMIN_PIN = process.env.ADMIN_PIN || '2026';
const DEFAULT_TENANT = process.env.DEFAULT_GYM_TENANT || 'fara-sport-centar';

const DEFAULT_TYPES = [
  { id: 'daily', name: 'Dnevna karta', price: 5, durationDays: 1 },
  { id: 'monthly-until-16', name: 'Mjesečna do 16h', price: 30, durationDays: 30 },
  { id: 'monthly-regular', name: 'Mjesečna redovna', price: 40, durationDays: 30 }
];

function send(res, status, payload) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
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

function defaultData() {
  return {
    tenants: {
      [DEFAULT_TENANT]: {
        name: 'FARA Sport Centar',
        membershipTypes: DEFAULT_TYPES,
        members: [],
        payments: [],
        visits: []
      }
    }
  };
}

function normalizeData(data) {
  const normalized = data && typeof data === 'object' ? data : defaultData();
  normalized.tenants = normalized.tenants || {};
  if (!normalized.tenants[DEFAULT_TENANT]) normalized.tenants[DEFAULT_TENANT] = defaultData().tenants[DEFAULT_TENANT];
  Object.values(normalized.tenants).forEach(tenant => {
    tenant.membershipTypes = Array.isArray(tenant.membershipTypes) && tenant.membershipTypes.length ? tenant.membershipTypes : DEFAULT_TYPES;
    tenant.members = Array.isArray(tenant.members) ? tenant.members : [];
    tenant.payments = Array.isArray(tenant.payments) ? tenant.payments : [];
    tenant.visits = Array.isArray(tenant.visits) ? tenant.visits : [];
  });
  return normalized;
}

async function readGymFile(options = {}) {
  const url = `https://api.github.com/repos/${OWNER}/${REPO}/contents/${FILE_PATH}?ref=${BRANCH}`;
  try {
    const data = await githubRequest(url);
    const content = Buffer.from(data.content || '', 'base64').toString('utf8');
    return { gym: normalizeData(JSON.parse(content || '{}')), sha: data.sha, readonly: false };
  } catch (error) {
    if (!options.allowPublicFallback || ![401, 403].includes(error.status)) throw error;
    return { gym: normalizeData(await readRawJson()), sha: '', readonly: true };
  }
}

async function writeGymFile(gym, sha) {
  const url = `https://api.github.com/repos/${OWNER}/${REPO}/contents/${FILE_PATH}`;
  return githubRequest(url, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      message: 'Update FARA gym data',
      branch: BRANCH,
      sha,
      content: Buffer.from(`${JSON.stringify(gym, null, 2)}\n`).toString('base64')
    })
  });
}

async function mutateGym(mutator) {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const { gym, sha } = await readGymFile();
    const result = await mutator(gym);
    try {
      await writeGymFile(gym, sha);
      return result;
    } catch (error) {
      if (error.status !== 409 || attempt === 2) throw error;
    }
  }
  throw new Error('Podaci nisu sačuvani.');
}

function isAdmin(req) {
  return req.headers['x-admin-pin'] === ADMIN_PIN;
}

function tenantIdFrom(req, body = {}) {
  const url = new URL(req.url, 'https://www.fara.ba');
  return cleanId(body.tenantId || url.searchParams.get('tenantId') || DEFAULT_TENANT);
}

function cleanText(value, limit = 500) {
  return String(value || '').trim().slice(0, limit);
}

function cleanId(value) {
  return cleanText(value, 80).toLowerCase().replace(/[^a-z0-9-]/g, '') || DEFAULT_TENANT;
}

function todayValue() {
  return new Date().toISOString().slice(0, 10);
}

function addDays(dateString, days) {
  const date = new Date(`${dateString}T12:00:00`);
  date.setDate(date.getDate() + Number(days || 0));
  return date.toISOString().slice(0, 10);
}

function memberStatus(member) {
  if (member.deleted) return 'deleted';
  const today = todayValue();
  if (member.endDate < today) return 'expired';
  if (member.endDate <= addDays(today, 7)) return 'expiring';
  return 'active';
}

function publicTenant(tenant) {
  return {
    name: tenant.name,
    membershipTypes: tenant.membershipTypes,
    members: tenant.members.filter(member => !member.deleted),
    payments: tenant.payments.filter(payment => !payment.deleted),
    visits: tenant.visits.filter(visit => !visit.deleted)
  };
}

function findType(tenant, typeId) {
  return tenant.membershipTypes.find(type => type.id === typeId) || tenant.membershipTypes[0] || DEFAULT_TYPES[0];
}

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return send(res, 200, { ok: true });

  if (!githubToken() && req.method !== 'GET') {
    return send(res, 500, { error: 'Server nije podešen: nedostaje GitHub token.' });
  }

  if (!isAdmin(req)) {
    return send(res, 401, { error: 'Potreban je admin PIN.' });
  }

  try {
    if (req.method === 'GET') {
      const { gym, readonly } = await readGymFile({ allowPublicFallback: true });
      const tenantId = tenantIdFrom(req);
      const tenant = gym.tenants[tenantId] || gym.tenants[DEFAULT_TENANT];
      return send(res, 200, { tenantId, tenant: publicTenant(tenant), admin: true, readonly });
    }

    if (req.method === 'POST') {
      const body = await readBody(req);
      const action = cleanText(body.action, 60);
      const tenantId = tenantIdFrom(req, body);

      const result = await mutateGym(async gym => {
        gym.tenants[tenantId] = gym.tenants[tenantId] || {
          name: body.tenantName || tenantId,
          membershipTypes: DEFAULT_TYPES,
          members: [],
          payments: [],
          visits: []
        };
        const tenant = gym.tenants[tenantId];

        if (action === 'saveMember') {
          const type = findType(tenant, cleanId(body.membershipTypeId));
          const member = {
            id: cleanText(body.id, 80) || `gym-${Date.now()}`,
            createdAt: cleanText(body.createdAt, 40) || new Date().toISOString(),
            updatedAt: new Date().toISOString(),
            firstName: cleanText(body.firstName, 80),
            lastName: cleanText(body.lastName, 80),
            phone: cleanText(body.phone, 40),
            note: cleanText(body.note, 800),
            membershipTypeId: type.id,
            startDate: cleanText(body.startDate, 20) || todayValue(),
            endDate: cleanText(body.endDate, 20) || addDays(todayValue(), type.durationDays),
            deleted: false
          };
          if (!member.firstName || !member.phone) throw Object.assign(new Error('Ime i telefon su obavezni.'), { publicStatus: 400 });
          const index = tenant.members.findIndex(item => item.id === member.id);
          if (index >= 0) tenant.members[index] = { ...tenant.members[index], ...member };
          else tenant.members.push(member);

          if (body.paidNow) {
            tenant.payments.push({
              id: `pay-${Date.now()}`,
              memberId: member.id,
              date: todayValue(),
              amount: Number(type.price || 0),
              note: `Uplata: ${type.name}`,
              deleted: false
            });
          }
          return { member };
        }

        if (action === 'deleteMember') {
          const member = tenant.members.find(item => item.id === body.id);
          if (!member) throw Object.assign(new Error('Član nije pronađen.'), { publicStatus: 404 });
          member.deleted = true;
          member.updatedAt = new Date().toISOString();
          return { ok: true };
        }

        if (action === 'addPayment') {
          const member = tenant.members.find(item => item.id === body.memberId && !item.deleted);
          if (!member) throw Object.assign(new Error('Član nije pronađen.'), { publicStatus: 404 });
          const payment = {
            id: `pay-${Date.now()}`,
            memberId: member.id,
            date: cleanText(body.date, 20) || todayValue(),
            amount: Number(body.amount || 0),
            note: cleanText(body.note, 300) || 'Uplata članarine',
            deleted: false
          };
          tenant.payments.push(payment);
          return { payment };
        }

        if (action === 'addVisit') {
          const member = tenant.members.find(item => item.id === body.memberId && !item.deleted);
          if (!member) throw Object.assign(new Error('Član nije pronađen.'), { publicStatus: 404 });
          const visit = {
            id: `visit-${Date.now()}`,
            memberId: member.id,
            date: cleanText(body.date, 20) || todayValue(),
            time: new Date().toISOString().slice(11, 16),
            deleted: false
          };
          tenant.visits.push(visit);
          return { visit };
        }

        if (action === 'saveMembershipType') {
          const type = {
            id: cleanId(body.id) || `type-${Date.now()}`,
            name: cleanText(body.name, 120),
            price: Number(body.price || 0),
            durationDays: Math.max(1, Number(body.durationDays || 30))
          };
          if (!type.name) throw Object.assign(new Error('Naziv članarine je obavezan.'), { publicStatus: 400 });
          const index = tenant.membershipTypes.findIndex(item => item.id === type.id);
          if (index >= 0) tenant.membershipTypes[index] = type;
          else tenant.membershipTypes.push(type);
          return { type };
        }

        throw Object.assign(new Error('Nepoznata akcija.'), { publicStatus: 400 });
      });

      return send(res, 200, result);
    }

    return send(res, 405, { error: 'Metoda nije podržana.' });
  } catch (error) {
    if (error.status === 401 || error.status === 403 || error.message === 'Bad credentials') {
      return send(res, 500, { error: 'GitHub token za čuvanje podataka nije ispravan. Admin može čitati podatke, ali za izmjene treba osvježiti Vercel env FARA_GITHUB_TOKEN.' });
    }
    return send(res, error.publicStatus || error.status || 500, { error: error.message || 'Greška na serveru.' });
  }
};
