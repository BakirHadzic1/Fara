const API_URL = 'https://www.fara.ba/api/bookings';
const GYM_API_URL = 'https://www.fara.ba/api/gym';
const GYM_TENANT_ID = 'fara-sport-centar';
const DAY_ORDER = ['ponedjeljak', 'utorak', 'srijeda', 'četvrtak', 'petak', 'subota', 'nedjelja'];

let adminPin = localStorage.getItem('faraDesktopAdminPin') || '';
let bookings = [];
let gymData = { membershipTypes: [], members: [], payments: [], visits: [], dailyPasses: [] };
let activeMode = localStorage.getItem('faraDesktopMode') || 'terms';

const modeTabs = Array.from(document.querySelectorAll('[data-mode]'));
const moduleViews = Array.from(document.querySelectorAll('[data-module]'));
const moduleEyebrow = document.getElementById('moduleEyebrow');
const moduleTitle = document.getElementById('moduleTitle');
const loginPanel = document.getElementById('loginPanel');
const loginForm = document.getElementById('loginForm');
const pinInput = document.getElementById('adminPin');
const loginMessage = document.getElementById('loginMessage');
const dashboard = document.getElementById('dashboard');
const rows = document.getElementById('bookingRows');
const empty = document.getElementById('emptyState');
const refreshButton = document.getElementById('refreshData');
const dateFilter = document.getElementById('dateFilter');
const statusFilter = document.getElementById('statusFilter');
const searchFilter = document.getElementById('searchFilter');
const standingTerms = document.getElementById('standingTerms');
const lastUpdated = document.getElementById('lastUpdated');
const createForm = document.getElementById('createBookingForm');
const createDate = document.getElementById('createDate');
const createTime = document.getElementById('createTime');
const createType = document.getElementById('createType');
const createMonthsWrap = document.getElementById('createMonthsWrap');
const createMonths = document.getElementById('createMonths');
const createCategory = document.getElementById('createCategory');
const createName = document.getElementById('createName');
const createPhone = document.getElementById('createPhone');
const createNote = document.getElementById('createNote');
const createPaid = document.getElementById('createPaid');
const createMessage = document.getElementById('createMessage');
const gymRows = document.getElementById('gymRows');
const gymEmpty = document.getElementById('gymEmpty');
const gymMemberForm = document.getElementById('gymMemberForm');
const gymMemberId = document.getElementById('gymMemberId');
const gymFirstName = document.getElementById('gymFirstName');
const gymLastName = document.getElementById('gymLastName');
const gymPhone = document.getElementById('gymPhone');
const gymAccessCode = document.getElementById('gymAccessCode');
const gymMembershipType = document.getElementById('gymMembershipType');
const gymStartDate = document.getElementById('gymStartDate');
const gymEndDate = document.getElementById('gymEndDate');
const gymNote = document.getElementById('gymNote');
const gymPaidNow = document.getElementById('gymPaidNow');
const gymResetForm = document.getElementById('gymResetForm');
const gymMessage = document.getElementById('gymMessage');
const gymTypeList = document.getElementById('gymTypeList');
const gymStatusFilter = document.getElementById('gymStatusFilter');
const gymSearchFilter = document.getElementById('gymSearchFilter');
const gymDailyName = document.getElementById('gymDailyName');
const gymDailyAmount = document.getElementById('gymDailyAmount');
const gymDailyAdd = document.getElementById('gymDailyAdd');

if (adminPin) pinInput.value = adminPin;

const today = new Date().toISOString().slice(0, 10);

if (createDate) {
  createDate.min = today;
  createDate.value = today;
}

if (gymStartDate) gymStartDate.value = today;

if (createTime) {
  for (let hour = 8; hour <= 22; hour += 1) {
    const value = `${String(hour).padStart(2, '0')}:00`;
    const option = document.createElement('option');
    option.value = value;
    option.textContent = `${value} - ${String(hour + 1).padStart(2, '0')}:00`;
    createTime.appendChild(option);
  }
  createTime.value = '18:00';
}

function money(value) {
  return `${Number(value || 0)} KM`;
}

function addDays(dateString, days) {
  const date = new Date(`${dateString}T12:00:00`);
  date.setDate(date.getDate() + Number(days || 0));
  return date.toISOString().slice(0, 10);
}

function memberName(member) {
  return `${member.firstName || ''} ${member.lastName || ''}`.trim();
}

function gymStatus(member) {
  if (!member?.endDate || member.endDate < today) return 'expired';
  if (member.endDate <= addDays(today, 7)) return 'expiring';
  return 'active';
}

function gymStatusLabel(status) {
  if (status === 'active') return 'Aktivna';
  if (status === 'expiring') return 'Ističe';
  if (status === 'expired') return 'Isteklo';
  return status;
}

function formatDate(dateString) {
  const date = new Date(`${dateString}T12:00:00`);
  return date.toLocaleDateString('bs-BA', { weekday: 'long', day: '2-digit', month: '2-digit', year: 'numeric' });
}

function inCurrentWeek(dateString) {
  const date = new Date(`${dateString}T12:00:00`);
  const now = new Date();
  const day = (now.getDay() + 6) % 7;
  const start = new Date(now);
  start.setDate(now.getDate() - day);
  start.setHours(0, 0, 0, 0);
  const end = new Date(start);
  end.setDate(start.getDate() + 7);
  return date >= start && date < end;
}

function inCurrentMonth(dateString) {
  const date = new Date(`${dateString}T12:00:00`);
  const now = new Date();
  return date.getFullYear() === now.getFullYear() && date.getMonth() === now.getMonth();
}

function paidTotal(predicate) {
  return bookings
    .filter(item => item.paid && item.status !== 'cancelled' && item.status !== 'deleted' && predicate(item.date))
    .reduce((total, item) => total + Number(item.price || 0), 0);
}

function typeLabel(item) {
  return item.type === 'monthly' ? `Stalni mjesečni (${item.months || 1} mj.)` : 'Jedan termin';
}

function statusText(item) {
  if (item.status === 'cancelled') return 'Otkazano';
  return item.paid ? 'Plaćeno' : 'Nije plaćeno';
}

async function apiRequest(options = {}) {
  const response = await fetch(API_URL, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      'X-Admin-Pin': adminPin,
      ...(options.headers || {})
    }
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || 'Greška pri spajanju.');
  return data;
}

async function gymRequest(options = {}) {
  const response = await fetch(GYM_API_URL, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      'X-Admin-Pin': adminPin,
      ...(options.headers || {})
    }
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || 'Greška pri spajanju teretane.');
  return data;
}

async function createBooking(booking) {
  const data = await apiRequest({
    method: 'POST',
    body: JSON.stringify(booking)
  });
  return data.booking;
}

async function loadGymData() {
  const data = await gymRequest({ method: 'GET' });
  gymData = data.tenant || { membershipTypes: [], members: [], payments: [], visits: [], dailyPasses: [] };
  renderGym();
}

async function gymAction(action, payload = {}) {
  await gymRequest({
    method: 'POST',
    body: JSON.stringify({ action, tenantId: GYM_TENANT_ID, ...payload })
  });
  await loadGymData();
}

async function loadData() {
  loginMessage.textContent = '';
  const data = await apiRequest();
  bookings = data.bookings || [];
  await loadGymData();
  localStorage.setItem('faraDesktopAdminPin', adminPin);
  loginPanel.hidden = true;
  dashboard.hidden = false;
  lastUpdated.textContent = `Osvježeno: ${new Date().toLocaleTimeString('bs-BA', { hour: '2-digit', minute: '2-digit' })}`;
  render();
  setMode(activeMode);
}

function updateStats() {
  const today = new Date().toISOString().slice(0, 10);
  const active = bookings.filter(item => item.status !== 'cancelled' && item.status !== 'deleted');
  const unpaid = active.filter(item => !item.paid).length;
  document.getElementById('statToday').textContent = money(paidTotal(date => date === today));
  document.getElementById('statWeek').textContent = money(paidTotal(inCurrentWeek));
  document.getElementById('statMonth').textContent = money(paidTotal(inCurrentMonth));
  document.getElementById('statOpen').textContent = `${active.length} / ${unpaid}`;
}

function renderStandingTerms() {
  const monthly = bookings
    .filter(item => item.type === 'monthly' && item.status !== 'cancelled' && item.status !== 'deleted')
    .sort((a, b) => `${a.day} ${a.time}`.localeCompare(`${b.day} ${b.time}`));

  standingTerms.innerHTML = DAY_ORDER.map(day => {
    const terms = monthly
      .filter(item => item.day === day)
      .sort((a, b) => a.time.localeCompare(b.time));
    return `
      <article class="day-card">
        <h3>${day}</h3>
        ${terms.length ? terms.map(item => `
          <div class="term-pill">
            <strong>${item.time}</strong>
            <span>${item.name || 'Stalni termin'}</span>
            <small>${item.endDate ? `do ${formatDate(item.endDate)}` : 'mjesečno'}</small>
          </div>
        `).join('') : '<p>Nema stalnih termina.</p>'}
      </article>
    `;
  }).join('');
}

function filteredBookings() {
  const date = dateFilter.value;
  const status = statusFilter.value;
  const search = searchFilter.value.trim().toLowerCase();
  return bookings
    .filter(item => item.status !== 'deleted')
    .filter(item => !date || item.date === date)
    .filter(item => {
      if (status === 'all') return true;
      if (status === 'paid') return item.paid;
      if (status === 'pending') return !item.paid && item.status !== 'cancelled';
      return item.status === status;
    })
    .filter(item => {
      if (!search) return true;
      return [item.name, item.phone, item.email, item.note].some(value => String(value || '').toLowerCase().includes(search));
    })
    .sort((a, b) => `${a.date} ${a.time}`.localeCompare(`${b.date} ${b.time}`));
}

function renderRows() {
  const filtered = filteredBookings();
  rows.innerHTML = filtered.map(item => {
    const statusClass = item.status === 'cancelled' ? 'cancelled' : (item.paid ? 'paid' : 'pending');
    return `
      <tr>
        <td><strong>${formatDate(item.date)} · ${item.time}</strong><small>${item.endDate ? `do ${formatDate(item.endDate)}` : ''}</small></td>
        <td><strong>${item.name || '-'}</strong><small>${item.phone || ''}${item.email ? ` · ${item.email}` : ''}</small></td>
        <td>${typeLabel(item)}<small>${item.note || ''}</small></td>
        <td><strong>${money(item.price)}</strong></td>
        <td><span class="status ${statusClass}">${statusText(item)}</span></td>
        <td>
          <div class="row-actions">
            <button class="mini-btn" type="button" data-action="paid" data-id="${item.id}">${item.paid ? 'Skini plaćeno' : 'Plaćeno'}</button>
            <button class="mini-btn" type="button" data-action="cancel" data-id="${item.id}">${item.status === 'cancelled' ? 'Vrati' : 'Otkaži'}</button>
            <button class="mini-btn danger" type="button" data-action="delete" data-id="${item.id}">Obriši</button>
          </div>
        </td>
      </tr>
    `;
  }).join('');
  empty.hidden = filtered.length > 0;
}

function render() {
  updateStats();
  renderStandingTerms();
  renderRows();
}

function setMode(mode) {
  activeMode = mode === 'gym' ? 'gym' : 'terms';
  localStorage.setItem('faraDesktopMode', activeMode);
  modeTabs.forEach(tab => tab.classList.toggle('active', tab.dataset.mode === activeMode));
  moduleViews.forEach(view => {
    view.hidden = view.dataset.module !== activeMode;
    view.classList.toggle('active', view.dataset.module === activeMode);
  });
  moduleEyebrow.textContent = activeMode === 'gym' ? 'FARA Teretana' : 'Sport Centar';
  moduleTitle.textContent = activeMode === 'gym' ? 'Članarine i dnevne karte' : 'Rezervacije i stalni termini';
}

function gymType(typeId) {
  return gymData.membershipTypes.find(type => type.id === typeId) || gymData.membershipTypes[0] || { id: 'monthly-regular', name: 'Mjesečna redovna', price: 40, durationDays: 30 };
}

function memberPayments(memberId) {
  return gymData.payments.filter(payment => payment.memberId === memberId && !payment.deleted);
}

function memberVisits(memberId) {
  return gymData.visits.filter(visit => visit.memberId === memberId && !visit.deleted);
}

function memberPaidTotal(member) {
  return memberPayments(member.id)
    .filter(payment => String(payment.date || '') >= String(member.startDate || '') && String(payment.date || '') <= String(member.endDate || '9999-12-31'))
    .reduce((total, payment) => total + Number(payment.amount || 0), 0);
}

function memberDebt(member) {
  return Math.max(0, Number(gymType(member.membershipTypeId).price || 0) - memberPaidTotal(member));
}

function renderGymTypes() {
  if (!gymMembershipType || !gymTypeList) return;
  gymMembershipType.innerHTML = gymData.membershipTypes.map(type => `<option value="${type.id}">${type.name} · ${money(type.price)}</option>`).join('');
  gymTypeList.innerHTML = gymData.membershipTypes.map(type => `<span><strong>${money(type.price)}</strong>${type.name}</span>`).join('');
  updateGymEndDate();
}

function updateGymEndDate() {
  if (!gymStartDate || !gymEndDate || !gymMembershipType) return;
  const type = gymType(gymMembershipType.value);
  gymEndDate.value = addDays(gymStartDate.value || today, Number(type.durationDays || 30));
}

function filteredGymMembers() {
  const status = gymStatusFilter?.value || 'all';
  const search = (gymSearchFilter?.value || '').trim().toLowerCase();
  return gymData.members
    .filter(member => !member.deleted)
    .filter(member => status === 'all' || (status === 'debt' ? memberDebt(member) > 0 : gymStatus(member) === status))
    .filter(member => {
      if (!search) return true;
      return [member.firstName, member.lastName, member.phone, member.note].some(value => String(value || '').toLowerCase().includes(search));
    })
    .sort((a, b) => `${gymStatus(a)} ${a.endDate} ${memberName(a)}`.localeCompare(`${gymStatus(b)} ${b.endDate} ${memberName(b)}`));
}

function updateGymStats() {
  const members = gymData.members.filter(member => !member.deleted);
  document.getElementById('gymStatActive').textContent = members.filter(member => gymStatus(member) === 'active').length;
  document.getElementById('gymStatExpiring').textContent = members.filter(member => gymStatus(member) === 'expiring').length;
  document.getElementById('gymStatExpired').textContent = members.filter(member => gymStatus(member) === 'expired').length;
}

function renderGymRows() {
  const members = filteredGymMembers();
  gymRows.innerHTML = members.map(member => {
    const status = gymStatus(member);
    const type = gymType(member.membershipTypeId);
    const visits = memberVisits(member.id);
    const paid = memberPaidTotal(member);
    const debt = memberDebt(member);
    const lastVisit = visits[visits.length - 1];
    return `
      <tr class="gym-row ${status}">
        <td><strong>${memberName(member) || '-'}</strong><small>${member.phone || ''} · Kod ${member.accessCode || '-'}</small></td>
        <td><strong>${type.name}</strong><small>${formatDate(member.startDate)} - ${formatDate(member.endDate)}</small></td>
        <td><strong>${money(paid)}</strong><small>${debt > 0 ? `Dug: ${money(debt)}` : 'Bez duga'}</small></td>
        <td><strong>${visits.length}</strong><small>${lastVisit ? formatDate(lastVisit.date) : 'Nema dolazaka'}</small></td>
        <td><span class="status ${status === 'active' ? 'paid' : status === 'expiring' ? 'pending' : 'cancelled'}">${gymStatusLabel(status)}</span></td>
        <td>
          <div class="row-actions gym-actions">
            <button class="mini-btn success" type="button" data-gym-action="visit" data-id="${member.id}">Dolazak</button>
            <button class="mini-btn success" type="button" data-gym-action="renew" data-id="${member.id}">Produži</button>
            <button class="mini-btn" type="button" data-gym-action="payment" data-id="${member.id}">Uplata</button>
            <button class="mini-btn" type="button" data-gym-action="edit" data-id="${member.id}">Uredi</button>
            <button class="mini-btn" type="button" data-gym-action="code" data-id="${member.id}">Novi kod</button>
          </div>
        </td>
      </tr>
    `;
  }).join('');
  gymEmpty.hidden = members.length > 0;
}

function renderGym() {
  renderGymTypes();
  updateGymStats();
  renderGymRows();
}

async function updateBooking(id, action) {
  await apiRequest({
    method: 'PATCH',
    body: JSON.stringify({ id, action })
  });
  await loadData();
}

loginForm.addEventListener('submit', async event => {
  event.preventDefault();
  adminPin = pinInput.value.trim();
  try {
    await loadData();
  } catch (error) {
    loginMessage.textContent = error.message;
  }
});

modeTabs.forEach(tab => {
  tab.addEventListener('click', () => setMode(tab.dataset.mode));
});

refreshButton.addEventListener('click', async () => {
  if (!adminPin) return;
  refreshButton.textContent = 'Učitavam...';
  try {
    await loadData();
  } finally {
    refreshButton.textContent = 'Osvježi';
  }
});

[dateFilter, statusFilter, searchFilter].forEach(input => input.addEventListener('input', renderRows));
[gymStatusFilter, gymSearchFilter].filter(Boolean).forEach(input => input.addEventListener('input', renderGymRows));
[gymMembershipType, gymStartDate].filter(Boolean).forEach(input => input.addEventListener('change', updateGymEndDate));

rows.addEventListener('click', async event => {
  const button = event.target.closest('button[data-action]');
  if (!button) return;
  button.disabled = true;
  await updateBooking(button.dataset.id, button.dataset.action);
});

function resetGymForm() {
  gymMemberForm.reset();
  gymMemberId.value = '';
  gymStartDate.value = today;
  gymAccessCode.value = '';
  document.getElementById('gymFormTitle').textContent = 'Dodaj člana';
  updateGymEndDate();
}

function editGymMember(member) {
  setMode('gym');
  gymMemberId.value = member.id;
  gymFirstName.value = member.firstName || '';
  gymLastName.value = member.lastName || '';
  gymPhone.value = member.phone || '';
  gymAccessCode.value = member.accessCode || '';
  gymMembershipType.value = member.membershipTypeId || gymMembershipType.value;
  gymStartDate.value = member.startDate || today;
  gymEndDate.value = member.endDate || today;
  gymNote.value = member.note || '';
  gymPaidNow.checked = false;
  document.getElementById('gymFormTitle').textContent = 'Uredi člana';
  gymMemberForm.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

if (gymResetForm) gymResetForm.addEventListener('click', resetGymForm);

if (gymRows) {
  gymRows.addEventListener('click', async event => {
    const button = event.target.closest('button[data-gym-action]');
    if (!button) return;
    const member = gymData.members.find(item => item.id === button.dataset.id);
    if (!member) return;
    const action = button.dataset.gymAction;
    button.disabled = true;
    try {
      if (action === 'edit') return editGymMember(member);
      if (action === 'visit') await gymAction('addVisit', { memberId: member.id, date: today });
      if (action === 'code') await gymAction('accessCode', { id: member.id });
      if (action === 'payment') {
        const amount = Number(prompt('Iznos uplate (KM):', gymType(member.membershipTypeId).price) || 0);
        if (!amount) return;
        await gymAction('addPayment', { memberId: member.id, amount, date: today, note: 'Uplata iz desktop admin panela' });
      }
      if (action === 'renew') {
        const type = gymType(member.membershipTypeId);
        const amount = Number(prompt('Iznos produženja (KM):', type.price) || 0);
        if (!amount) return;
        await gymAction('renewMember', {
          memberId: member.id,
          membershipTypeId: member.membershipTypeId,
          amount,
          startDate: today,
          note: 'Produženje iz desktop admin panela'
        });
      }
    } catch (error) {
      gymMessage.textContent = error.message || 'Akcija nije uspjela.';
    } finally {
      button.disabled = false;
    }
  });
}

if (gymDailyAdd) {
  gymDailyAdd.addEventListener('click', async () => {
    if (!adminPin) return;
    const amount = Number(gymDailyAmount.value || gymType('daily').price || 0);
    if (!amount) {
      gymMessage.textContent = 'Unesite iznos dnevne karte.';
      return;
    }
    gymDailyAdd.disabled = true;
    gymDailyAdd.textContent = 'Čuvam...';
    try {
      await gymAction('dailyPass', {
        date: today,
        amount,
        name: gymDailyName.value.trim() || 'Dnevna karta'
      });
      gymDailyName.value = '';
      gymDailyAmount.value = '';
      gymMessage.textContent = 'Dnevna karta je evidentirana.';
    } catch (error) {
      gymMessage.textContent = error.message || 'Dnevna karta nije sačuvana.';
    } finally {
      gymDailyAdd.disabled = false;
      gymDailyAdd.textContent = 'Dodaj dnevnu kartu';
    }
  });
}

if (gymMemberForm) {
  gymMemberForm.addEventListener('submit', async event => {
    event.preventDefault();
    if (!adminPin) return;
    const submit = gymMemberForm.querySelector('button[type="submit"]');
    submit.disabled = true;
    submit.textContent = 'Čuvam...';
    try {
      await gymAction('saveMember', {
        id: gymMemberId.value,
        firstName: gymFirstName.value.trim(),
        lastName: gymLastName.value.trim(),
        phone: gymPhone.value.trim(),
        accessCode: gymAccessCode.value.trim(),
        note: gymNote.value.trim(),
        membershipTypeId: gymMembershipType.value,
        startDate: gymStartDate.value,
        endDate: gymEndDate.value,
        paidNow: gymPaidNow.checked
      });
      resetGymForm();
      gymMessage.textContent = 'Član je sačuvan.';
    } catch (error) {
      gymMessage.textContent = error.message || 'Član nije sačuvan.';
    } finally {
      submit.disabled = false;
      submit.textContent = 'Sačuvaj člana';
    }
  });
}

if (createType && createMonthsWrap) {
  createType.addEventListener('change', () => {
    createMonthsWrap.hidden = createType.value !== 'monthly';
  });
}

if (createForm) {
  createForm.addEventListener('submit', async event => {
    event.preventDefault();
    if (!adminPin) return;
    const submitButton = createForm.querySelector('button[type="submit"]');
    if (submitButton) {
      submitButton.disabled = true;
      submitButton.textContent = 'Dodajem...';
    }
    createMessage.textContent = '';
    try {
      await createBooking({
        date: createDate.value,
        time: createTime.value,
        type: createType.value,
        category: createCategory.value,
        name: createName.value.trim(),
        phone: createPhone.value.trim(),
        email: '',
        note: createNote.value.trim() || 'Ručni unos iz desktop admin panela',
        months: createType.value === 'monthly' ? Number(createMonths.value || 1) : 1,
        paid: createPaid.checked
      });
      createForm.reset();
      createDate.value = today;
      createTime.value = '18:00';
      createMonthsWrap.hidden = true;
      await loadData();
      createMessage.textContent = 'Termin je dodat i odmah je zauzet u rasporedu.';
    } catch (error) {
      createMessage.textContent = error.message || 'Termin nije dodat.';
    } finally {
      if (submitButton) {
        submitButton.disabled = false;
        submitButton.textContent = 'Dodaj termin';
      }
    }
  });
}
