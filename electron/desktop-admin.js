const API_URL = 'https://www.fara.ba/api/bookings';
const DAY_ORDER = ['ponedjeljak', 'utorak', 'srijeda', 'četvrtak', 'petak', 'subota', 'nedjelja'];

let adminPin = localStorage.getItem('faraDesktopAdminPin') || '';
let bookings = [];

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

if (adminPin) pinInput.value = adminPin;

const today = new Date().toISOString().slice(0, 10);

if (createDate) {
  createDate.min = today;
  createDate.value = today;
}

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

async function createBooking(booking) {
  const data = await apiRequest({
    method: 'POST',
    body: JSON.stringify(booking)
  });
  return data.booking;
}

async function loadData() {
  loginMessage.textContent = '';
  const data = await apiRequest();
  bookings = data.bookings || [];
  localStorage.setItem('faraDesktopAdminPin', adminPin);
  loginPanel.hidden = true;
  dashboard.hidden = false;
  lastUpdated.textContent = `Osvježeno: ${new Date().toLocaleTimeString('bs-BA', { hour: '2-digit', minute: '2-digit' })}`;
  render();
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

rows.addEventListener('click', async event => {
  const button = event.target.closest('button[data-action]');
  if (!button) return;
  button.disabled = true;
  await updateBooking(button.dataset.id, button.dataset.action);
});

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
