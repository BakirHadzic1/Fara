const STORAGE_KEY = 'faraSportBookings';
const API_URL = '/api/bookings';

function formatDate(dateString) {
  if (!dateString) return '';
  const date = new Date(`${dateString}T12:00:00`);
  return date.toLocaleDateString('bs-BA', { weekday: 'long', day: '2-digit', month: '2-digit', year: 'numeric' });
}

function localBookings() {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]');
  } catch {
    return [];
  }
}

function saveLocalBookings(bookings) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(bookings));
}

function useOnlineApi() {
  return location.protocol === 'http:' || location.protocol === 'https:';
}

async function requestBookings(options = {}) {
  if (!useOnlineApi()) return { bookings: localBookings(), local: true };
  const response = await fetch(API_URL, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(options.headers || {})
    }
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || 'Greška pri učitavanju rezervacija.');
  return data;
}

async function loadBookings(adminPin = '') {
  try {
    const data = await requestBookings(adminPin ? { headers: { 'X-Admin-Pin': adminPin } } : {});
    return data.bookings || [];
  } catch {
    return localBookings();
  }
}

async function createBooking(booking) {
  if (!useOnlineApi()) {
    const bookings = localBookings();
    const taken = bookings.some(item => item.date === booking.date && item.time === booking.time && item.status !== 'cancelled' && item.status !== 'deleted');
    if (taken) throw new Error('Ovaj termin je već rezervisan.');
    bookings.push(booking);
    saveLocalBookings(bookings);
    return booking;
  }
  const data = await requestBookings({
    method: 'POST',
    body: JSON.stringify(booking)
  });
  return data.booking;
}

async function updateBookingOnline(id, action, adminPin) {
  if (!useOnlineApi()) {
    const bookings = localBookings().map(item => {
      if (item.id !== id) return item;
      if (action === 'paid') return { ...item, paid: !item.paid, status: item.status === 'cancelled' ? 'pending' : item.status };
      if (action === 'cancel') return { ...item, status: item.status === 'cancelled' ? 'pending' : 'cancelled' };
      if (action === 'delete') return { ...item, status: 'deleted' };
      return item;
    });
    saveLocalBookings(bookings);
    return;
  }
  await requestBookings({
    method: 'PATCH',
    headers: { 'X-Admin-Pin': adminPin },
    body: JSON.stringify({ id, action })
  });
}

function bookingPrice(type, category, time) {
  const hour = Number((time || '0').split(':')[0]);
  if (type === 'monthly') return 200;
  if (category === 'school' && hour >= 8 && hour < 16) return 30;
  return 50;
}

function bookingTypeLabel(type) {
  return type === 'monthly' ? 'Stalni mjesečni termin' : 'Jedan termin';
}

function categoryLabel(category) {
  return category === 'school' ? 'Školarci / akademije / klubovi' : 'Standardni termin';
}

function nextRenewalDate(dateString) {
  const date = new Date(`${dateString}T12:00:00`);
  date.setMonth(date.getMonth() + 1);
  return date.toISOString().slice(0, 10);
}

const yearEl = document.getElementById('year');
if (yearEl) yearEl.textContent = new Date().getFullYear();

const header = document.getElementById('siteHeader');
if (header) {
  window.addEventListener('scroll', () => {
    header.classList.toggle('scrolled', window.scrollY > 30);
  });
}

const toggle = document.getElementById('navToggle');
const nav = document.getElementById('mainNav');
if (toggle && nav) {
  toggle.setAttribute('aria-expanded', 'false');

  function setMenu(open) {
    nav.classList.toggle('open', open);
    toggle.classList.toggle('open', open);
    toggle.setAttribute('aria-expanded', String(open));
  }

  toggle.addEventListener('click', () => setMenu(!nav.classList.contains('open')));
  nav.querySelectorAll('[data-close]').forEach(a => a.addEventListener('click', () => setMenu(false)));
}

const revealEls = document.querySelectorAll('.reveal');
if (revealEls.length) {
  const io = new IntersectionObserver((entries) => {
    entries.forEach(e => {
      if (e.isIntersecting) {
        e.target.classList.add('in');
        io.unobserve(e.target);
      }
    });
  }, { threshold: 0.12 });
  revealEls.forEach(el => io.observe(el));
}

function initBookingModal() {
  const modal = document.getElementById('bookingModal');
  const form = document.getElementById('bookingForm');
  const dateInput = document.getElementById('bookingDate');
  const timeSelect = document.getElementById('bookingTime');
  const typeSelect = document.getElementById('bookingType');
  const categorySelect = document.getElementById('bookingCategory');
  const summary = document.getElementById('bookingSummary');
  const message = document.getElementById('bookingMessage');
  if (!modal || !form || !dateInput || !timeSelect || !typeSelect || !categorySelect || !summary || !message) return;

  let cachedBookings = [];
  const today = new Date().toISOString().slice(0, 10);
  dateInput.min = today;
  dateInput.value = today;

  for (let hour = 8; hour <= 21; hour += 1) {
    const value = `${String(hour).padStart(2, '0')}:00`;
    const option = document.createElement('option');
    option.value = value;
    option.textContent = `${value} - ${String(hour + 1).padStart(2, '0')}:00`;
    timeSelect.appendChild(option);
  }

  function isSlotTaken(date, time) {
    return cachedBookings.some(item => item.date === date && item.time === time && item.status !== 'cancelled' && item.status !== 'deleted');
  }

  function updateSummary() {
    const price = bookingPrice(typeSelect.value, categorySelect.value, timeSelect.value);
    const taken = isSlotTaken(dateInput.value, timeSelect.value);
    summary.innerHTML = `
      <span>${formatDate(dateInput.value)} · ${timeSelect.value}</span>
      <strong>${price} KM</strong>
      <small>${bookingTypeLabel(typeSelect.value)} · ${categoryLabel(categorySelect.value)}${taken ? ' · termin je već zauzet' : ''}</small>
    `;
    message.textContent = taken ? 'Ovaj termin je već rezervisan. Odaberite drugi datum ili sat.' : '';
    message.classList.toggle('error', taken);
  }

  async function refreshBookings() {
    cachedBookings = await loadBookings();
    updateSummary();
  }

  async function openModal() {
    modal.classList.add('open');
    modal.setAttribute('aria-hidden', 'false');
    document.body.classList.add('modal-open');
    message.textContent = 'Učitavam raspored...';
    message.classList.remove('error');
    await refreshBookings();
    dateInput.focus();
  }

  function closeModal() {
    modal.classList.remove('open');
    modal.setAttribute('aria-hidden', 'true');
    document.body.classList.remove('modal-open');
  }

  document.querySelectorAll('.booking-trigger').forEach(button => {
    button.addEventListener('click', openModal);
  });
  modal.querySelectorAll('[data-booking-close]').forEach(button => button.addEventListener('click', closeModal));
  document.addEventListener('keydown', event => {
    if (event.key === 'Escape' && modal.classList.contains('open')) closeModal();
  });
  [dateInput, timeSelect, typeSelect, categorySelect].forEach(input => input.addEventListener('change', updateSummary));

  form.addEventListener('submit', async event => {
    event.preventDefault();
    updateSummary();
    if (isSlotTaken(dateInput.value, timeSelect.value)) return;

    const data = new FormData(form);
    const booking = {
      id: `fara-${Date.now()}`,
      createdAt: new Date().toISOString(),
      date: dateInput.value,
      day: formatDate(dateInput.value).split(',')[0],
      time: timeSelect.value,
      type: typeSelect.value,
      category: categorySelect.value,
      name: String(data.get('name') || '').trim(),
      phone: String(data.get('phone') || '').trim(),
      email: String(data.get('email') || '').trim(),
      note: String(data.get('note') || '').trim(),
      price: bookingPrice(typeSelect.value, categorySelect.value, timeSelect.value),
      paid: false,
      status: 'pending',
      renewalDate: typeSelect.value === 'monthly' ? nextRenewalDate(dateInput.value) : ''
    };

    try {
      message.textContent = 'Šaljem rezervaciju...';
      message.classList.remove('error');
      const saved = await createBooking(booking);
      cachedBookings.push(saved);
      form.reset();
      dateInput.value = today;
      updateSummary();
      message.textContent = 'Rezervacija je zabilježena. Hvala!';
      message.classList.remove('error');
    } catch (error) {
      await refreshBookings();
      message.textContent = error.message || 'Rezervacija nije poslana.';
      message.classList.add('error');
    }
  });

  refreshBookings();
}

function initAdminPanel() {
  const tableBody = document.getElementById('adminBookings');
  const empty = document.getElementById('adminEmpty');
  const dateFilter = document.getElementById('adminDateFilter');
  const statusFilter = document.getElementById('adminStatusFilter');
  const searchFilter = document.getElementById('adminSearchFilter');
  const exportButton = document.getElementById('exportBookings');
  const seedButton = document.getElementById('seedDemoBooking');
  const loginPanel = document.getElementById('adminLogin');
  const loginForm = document.getElementById('adminLoginForm');
  const loginError = document.getElementById('adminLoginError');
  const adminContent = document.getElementById('adminContent');
  if (!tableBody || !empty || !dateFilter || !statusFilter || !searchFilter) return;

  let adminPin = sessionStorage.getItem('faraAdminPin') || '';
  let adminBookings = [];

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
    return adminBookings
      .filter(item => item.paid && item.status !== 'cancelled' && item.status !== 'deleted' && predicate(item.date))
      .reduce((total, item) => total + Number(item.price || 0), 0);
  }

  function updateStats() {
    const today = new Date().toISOString().slice(0, 10);
    const todayBookings = adminBookings.filter(item => item.date === today && item.status !== 'cancelled' && item.status !== 'deleted').length;
    const unpaid = adminBookings.filter(item => !item.paid && item.status !== 'cancelled' && item.status !== 'deleted').length;
    document.getElementById('statToday').textContent = `${paidTotal(date => date === today)} KM`;
    document.getElementById('statWeek').textContent = `${paidTotal(inCurrentWeek)} KM`;
    document.getElementById('statMonth').textContent = `${paidTotal(inCurrentMonth)} KM`;
    document.getElementById('statOpen').textContent = `${todayBookings} / ${unpaid}`;
  }

  function filteredBookings() {
    const date = dateFilter.value;
    const status = statusFilter.value;
    const search = searchFilter.value.trim().toLowerCase();
    return adminBookings
      .filter(item => item.status !== 'deleted')
      .filter(item => !date || item.date === date)
      .filter(item => status === 'all' || (status === 'paid' ? item.paid : item.status === status))
      .filter(item => {
        if (!search) return true;
        return [item.name, item.phone, item.email, item.note].some(value => String(value || '').toLowerCase().includes(search));
      })
      .sort((a, b) => `${a.date} ${a.time}`.localeCompare(`${b.date} ${b.time}`));
  }

  function render() {
    const bookings = filteredBookings();
    tableBody.innerHTML = '';
    empty.hidden = bookings.length > 0;
    bookings.forEach(item => {
      const tr = document.createElement('tr');
      const statusClass = item.status === 'cancelled' ? 'cancelled' : (item.paid ? 'paid' : 'pending');
      const statusText = item.status === 'cancelled' ? 'Otkazano' : (item.paid ? 'Plaćeno' : 'Nije plaćeno');
      tr.innerHTML = `
        <td><strong>${formatDate(item.date)}</strong><small>${item.time} · ${item.day || ''}</small></td>
        <td><strong>${item.name}</strong><small>${item.phone}${item.email ? ` · ${item.email}` : ''}</small></td>
        <td><strong>${bookingTypeLabel(item.type)}</strong><small>${categoryLabel(item.category)}${item.renewalDate ? ` · produženje ${formatDate(item.renewalDate)}` : ''}</small></td>
        <td><strong>${item.price} KM</strong><small>${item.note || 'Bez napomene'}</small></td>
        <td><span class="status-pill ${statusClass}">${statusText}</span></td>
        <td>
          <div class="admin-actions">
            <button class="mini-btn paid" data-action="paid" data-id="${item.id}">${item.paid ? 'Neplaćeno' : 'Plaćeno'}</button>
            <button class="mini-btn" data-action="cancel" data-id="${item.id}">${item.status === 'cancelled' ? 'Vrati' : 'Otkaži'}</button>
            <button class="mini-btn danger" data-action="delete" data-id="${item.id}">Briši</button>
          </div>
        </td>
      `;
      tableBody.appendChild(tr);
    });
    updateStats();
  }

  async function refreshAdmin() {
    adminBookings = await loadBookings(adminPin);
    render();
  }

  async function unlockPanel(pin) {
    adminPin = pin;
    const data = await requestBookings({ headers: { 'X-Admin-Pin': adminPin } });
    if (!data.admin) throw new Error('Pogrešan PIN.');
    adminBookings = data.bookings || [];
    sessionStorage.setItem('faraAdminPin', adminPin);
    if (loginPanel) loginPanel.hidden = true;
    if (adminContent) adminContent.hidden = false;
    render();
  }

  if (loginForm) {
    loginForm.addEventListener('submit', async event => {
      event.preventDefault();
      const value = document.getElementById('adminPin')?.value || '';
      try {
        if (loginError) loginError.textContent = 'Provjeravam...';
        await unlockPanel(value);
        if (loginError) loginError.textContent = '';
      } catch (error) {
        if (loginError) loginError.textContent = error.message || 'Pogrešan PIN.';
      }
    });
  }

  tableBody.addEventListener('click', async event => {
    const button = event.target.closest('button[data-action]');
    if (!button) return;
    const id = button.dataset.id;
    const action = button.dataset.action;
    button.disabled = true;
    try {
      await updateBookingOnline(id, action, adminPin);
      await refreshAdmin();
    } catch (error) {
      alert(error.message || 'Akcija nije uspjela.');
    } finally {
      button.disabled = false;
    }
  });

  [dateFilter, statusFilter, searchFilter].forEach(input => input.addEventListener('input', render));

  if (exportButton) {
    exportButton.addEventListener('click', () => {
      const blob = new Blob([JSON.stringify(adminBookings, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `fara-rezervacije-${new Date().toISOString().slice(0, 10)}.json`;
      a.click();
      URL.revokeObjectURL(url);
    });
  }

  if (seedButton) {
    seedButton.addEventListener('click', async () => {
      const today = new Date().toISOString().slice(0, 10);
      try {
        await createBooking({
          date: today,
          time: '20:00',
          type: 'single',
          category: 'standard',
          name: 'Primjer rezervacije',
          phone: '061 182 484',
          email: '',
          note: 'Test unos'
        });
        await refreshAdmin();
      } catch (error) {
        alert(error.message || 'Test unos nije uspio.');
      }
    });
  }

  if (adminPin) {
    unlockPanel(adminPin).catch(() => {
      sessionStorage.removeItem('faraAdminPin');
      if (loginPanel) loginPanel.hidden = false;
      if (adminContent) adminContent.hidden = true;
    });
  } else {
    if (loginPanel) loginPanel.hidden = false;
    if (adminContent) adminContent.hidden = true;
  }
}

initBookingModal();
initAdminPanel();
