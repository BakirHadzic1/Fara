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
        visits: [],
        dailyPasses: []
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
    tenant.dailyPasses = Array.isArray(tenant.dailyPasses) ? tenant.dailyPasses : [];
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

function cleanAccessCode(value) {
  return String(value || '').replace(/\D/g, '').slice(0, 8);
}

function makeAccessCode() {
  return String(Math.floor(1000 + Math.random() * 9000));
}

function normalizePhone(value) {
  return String(value || '').replace(/\D/g, '');
}

function samePhone(left, right) {
  const a = normalizePhone(left);
  const b = normalizePhone(right);
  return Boolean(a && b && (a === b || a.endsWith(b) || b.endsWith(a)));
}

function normalizeLookupName(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ');
}

function memberLookupName(member) {
  return normalizeLookupName(`${member.firstName || ''} ${member.lastName || ''}`);
}

function sameMemberName(member, value) {
  return Boolean(memberLookupName(member) && memberLookupName(member) === normalizeLookupName(value));
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
    visits: tenant.visits.filter(visit => !visit.deleted),
    dailyPasses: tenant.dailyPasses.filter(pass => !pass.deleted)
  };
}

function publicMemberProfile(tenant, member) {
  const type = findType(tenant, member.membershipTypeId);
  return {
    member: {
      id: member.id,
      firstName: member.firstName,
      lastName: member.lastName,
      phone: member.phone,
      note: member.note,
      membershipTypeId: member.membershipTypeId,
      startDate: member.startDate,
      endDate: member.endDate,
      status: memberStatus(member)
    },
    membershipType: type,
    payments: tenant.payments.filter(payment => payment.memberId === member.id && !payment.deleted),
    visits: tenant.visits.filter(visit => visit.memberId === member.id && !visit.deleted)
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

  try {
    if (req.method === 'GET') {
      const { gym, readonly } = await readGymFile({ allowPublicFallback: true });
      const tenantId = tenantIdFrom(req);
      const tenant = gym.tenants[tenantId] || gym.tenants[DEFAULT_TENANT];
      const url = new URL(req.url, 'https://www.fara.ba');
      if (url.searchParams.get('mine') === '1') {
        const phone = cleanText(url.searchParams.get('phone'), 40);
        const name = cleanText(url.searchParams.get('name'), 120);
        const accessCode = cleanAccessCode(url.searchParams.get('code'));
        if (!normalizeLookupName(name) && !normalizePhone(phone)) return send(res, 400, { error: 'Unesite ime i prezime.' });
        if (!accessCode) return send(res, 400, { error: 'Unesite kod za pristup.' });
        const member = tenant.members.find(item => !item.deleted && (normalizeLookupName(name) ? sameMemberName(item, name) : samePhone(item.phone, phone)) && cleanAccessCode(item.accessCode) === accessCode);
        if (!member) return send(res, 404, { error: 'Član nije pronađen za uneseno ime i kod.' });
        return send(res, 200, { tenantId, owner: true, readonly, ...publicMemberProfile(tenant, member) });
      }
      if (!isAdmin(req)) return send(res, 401, { error: 'Potreban je admin PIN.' });
      return send(res, 200, { tenantId, tenant: publicTenant(tenant), admin: true, readonly });
    }

    if (!isAdmin(req)) {
      return send(res, 401, { error: 'Potreban je admin PIN.' });
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
          visits: [],
          dailyPasses: []
        };
        const tenant = gym.tenants[tenantId];

        if (action === 'saveMember') {
          const type = findType(tenant, cleanId(body.membershipTypeId));
          const existing = tenant.members.find(item => item.id === cleanText(body.id, 80));
          const member = {
            id: cleanText(body.id, 80) || `gym-${Date.now()}`,
            createdAt: cleanText(body.createdAt, 40) || existing?.createdAt || new Date().toISOString(),
            updatedAt: new Date().toISOString(),
            firstName: cleanText(body.firstName, 80),
            lastName: cleanText(body.lastName, 80),
            phone: cleanText(body.phone, 40),
            note: cleanText(body.note, 800),
            accessCode: cleanAccessCode(body.accessCode) || cleanAccessCode(existing?.accessCode) || makeAccessCode(),
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

        if (action === 'accessCode') {
          const member = tenant.members.find(item => item.id === body.id && !item.deleted);
          if (!member) throw Object.assign(new Error('Član nije pronađen.'), { publicStatus: 404 });
          member.accessCode = makeAccessCode();
          member.updatedAt = new Date().toISOString();
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

        if (action === 'renewMember') {
          const member = tenant.members.find(item => item.id === body.memberId && !item.deleted);
          if (!member) throw Object.assign(new Error('Član nije pronađen.'), { publicStatus: 404 });
          const type = findType(tenant, cleanId(body.membershipTypeId || member.membershipTypeId));
          const startDate = cleanText(body.startDate, 20) || todayValue();
          const amount = Number(body.amount || type.price || 0);
          member.membershipTypeId = type.id;
          member.startDate = startDate;
          member.endDate = addDays(startDate, type.durationDays);
          member.updatedAt = new Date().toISOString();
          if (amount > 0) {
            tenant.payments.push({
              id: `pay-${Date.now()}`,
              memberId: member.id,
              date: startDate,
              amount,
              note: cleanText(body.note, 300) || `Produženje: ${type.name}`,
              deleted: false
            });
          }
          return { member };
        }

        if (action === 'dailyPass') {
          const type = findType(tenant, 'daily');
          const pass = {
            id: `daily-${Date.now()}`,
            date: cleanText(body.date, 20) || todayValue(),
            amount: Number(body.amount || type.price || 0),
            name: cleanText(body.name, 120) || 'Dnevna karta',
            phone: cleanText(body.phone, 40),
            note: cleanText(body.note, 300),
            deleted: false
          };
          tenant.dailyPasses.push(pass);
          return { pass };
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
