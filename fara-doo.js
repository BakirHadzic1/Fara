const STORAGE_KEY = 'faraSportBookings';
const MY_BOOKINGS_KEY = 'faraMyBookings';
const API_URL = '/api/bookings';
const DAY_NAMES = ['nedjelja', 'ponedjeljak', 'utorak', 'srijeda', 'četvrtak', 'petak', 'subota'];
const DAY_SHORT = ['Ned', 'Pon', 'Uto', 'Sri', 'Čet', 'Pet', 'Sub'];

function formatDate(dateString) {
  if (!dateString) return '';
  const date = new Date(`${dateString}T12:00:00`);
  return `${DAY_NAMES[date.getDay()]}, ${String(date.getDate()).padStart(2, '0')}.${String(date.getMonth() + 1).padStart(2, '0')}.${date.getFullYear()}.`;
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

function ownBookings() {
  try {
    return JSON.parse(localStorage.getItem(MY_BOOKINGS_KEY) || '[]');
  } catch {
    return [];
  }
}

function saveOwnBookings(bookings) {
  localStorage.setItem(MY_BOOKINGS_KEY, JSON.stringify(bookings));
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
    const taken = bookings.some(item => bookingsConflict(item, booking));
    if (taken) throw new Error('Ovaj termin je već rezervisan.');
    booking.cancelToken = `local-${Date.now()}`;
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

async function cancelOwnBooking(id, cancelToken) {
  if (!useOnlineApi()) {
    const bookings = localBookings().map(item => item.id === id && item.cancelToken === cancelToken ? { ...item, status: 'cancelled' } : item);
    saveLocalBookings(bookings);
    return;
  }
  await requestBookings({
    method: 'PATCH',
    body: JSON.stringify({ id, action: 'cancel', cancelToken })
  });
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

function toLocalDate(dateString) {
  return new Date(`${dateString}T12:00:00`);
}

function toDateInputValue(date) {
  return date.toISOString().slice(0, 10);
}

function startOfWeek(date) {
  const copy = new Date(date);
  const day = copy.getDay() || 7;
  copy.setDate(copy.getDate() - day + 1);
  return copy;
}

function addDays(date, days) {
  const copy = new Date(date);
  copy.setDate(copy.getDate() + days);
  return copy;
}

function addMonths(dateString, months) {
  const date = toLocalDate(dateString);
  date.setMonth(date.getMonth() + bookingMonths(months));
  return toDateInputValue(date);
}

function sameOrAfter(dateString, compareString) {
  return toLocalDate(dateString).getTime() >= toLocalDate(compareString).getTime();
}

function bookingEndDate(booking) {
  return booking.type === 'monthly' ? (booking.endDate || addMonths(booking.date, booking.months || 1)) : booking.date;
}

function bookingOccurrenceDates(booking) {
  if (booking.type !== 'monthly') return [booking.date];
  const endDate = bookingEndDate(booking);
  const dates = [];
  for (let date = toLocalDate(booking.date); toDateInputValue(date) < endDate; date = addDays(date, 7)) {
    dates.push(toDateInputValue(date));
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

function shortDate(date) {
  return `${String(date.getDate()).padStart(2, '0')}.${String(date.getMonth() + 1).padStart(2, '0')}.${date.getFullYear()}.`;
}

function isSlotClosed(dateString, time) {
  const date = toLocalDate(dateString);
  const hour = Number((time || '0').split(':')[0]);
  return date.getDay() === 0 && (hour < 12 || hour >= 22);
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
  const monthsWrap = document.getElementById('bookingMonthsWrap');
  const monthsSelect = document.getElementById('bookingMonths');
  const categorySelect = document.getElementById('bookingCategory');
  const summary = document.getElementById('bookingSummary');
  const message = document.getElementById('bookingMessage');
  const weekGrid = document.getElementById('bookingWeekGrid');
  const weekLabel = document.getElementById('bookingWeekLabel');
  const prevWeek = document.getElementById('prevWeek');
  const nextWeek = document.getElementById('nextWeek');
  const ownBookingsWrap = document.getElementById('ownBookings');
  const ownBookingsList = document.getElementById('ownBookingsList');
  if (!modal || !form || !dateInput || !timeSelect || !typeSelect || !monthsWrap || !monthsSelect || !categorySelect || !summary || !message || !weekGrid || !weekLabel || !prevWeek || !nextWeek || !ownBookingsWrap || !ownBookingsList) return;

  let cachedBookings = [];
  const today = new Date().toISOString().slice(0, 10);
  const timeSlots = [];
  let currentWeekStart = startOfWeek(toLocalDate(today));
  dateInput.min = today;
  dateInput.value = today;

  for (let hour = 8; hour <= 22; hour += 1) {
    const value = `${String(hour).padStart(2, '0')}:00`;
    timeSlots.push(value);
    const option = document.createElement('option');
    option.value = value;
    option.textContent = `${value} - ${String(hour + 1).padStart(2, '0')}:00`;
    timeSelect.appendChild(option);
  }

  function isSlotTaken(date, time) {
    return cachedBookings.some(item => bookingsConflict(item, { date, time, type: 'single' }));
  }

  function selectedInVisibleWeek() {
    const selected = toLocalDate(dateInput.value);
    const start = currentWeekStart.getTime();
    const end = addDays(currentWeekStart, 6).getTime();
    return selected.getTime() >= start && selected.getTime() <= end;
  }

  function setWeekAround(dateString) {
    currentWeekStart = startOfWeek(toLocalDate(dateString));
  }

  function renderWeekSchedule() {
    const days = Array.from({ length: 7 }, (_, index) => addDays(currentWeekStart, index));
    weekLabel.textContent = `${shortDate(days[0])} - ${shortDate(days[6])}`;

    const head = days.map(day => {
      const value = toDateInputValue(day);
      const label = `${DAY_SHORT[day.getDay()]} ${String(day.getDate()).padStart(2, '0')}.${String(day.getMonth() + 1).padStart(2, '0')}.`;
      return `<th>${label}${value === today ? '<small>Danas</small>' : ''}</th>`;
    }).join('');

    const rows = timeSlots.map(time => {
      const cells = days.map(day => {
        const dateValue = toDateInputValue(day);
        const past = dateValue < today;
        const closed = isSlotClosed(dateValue, time);
        const busy = isSlotTaken(dateValue, time);
        const selected = dateInput.value === dateValue && timeSelect.value === time;
        const state = past ? 'past' : closed ? 'closed' : busy ? 'busy' : 'free';
        const label = past ? 'Prošlo' : closed ? 'Zatvoreno' : busy ? 'Zauzeto' : 'Slobodno';
        return `
          <td>
            <button type="button" class="slot-btn ${state}${selected ? ' selected' : ''}" data-date="${dateValue}" data-time="${time}" ${state === 'free' ? '' : 'disabled'}>
              ${label}
            </button>
          </td>
        `;
      }).join('');
      return `<tr><td>${time}</td>${cells}</tr>`;
    }).join('');

    weekGrid.innerHTML = `
      <table class="week-table">
        <thead><tr><th>Sat</th>${head}</tr></thead>
        <tbody>${rows}</tbody>
      </table>
    `;
  }

  function updateSummary() {
    if (!selectedInVisibleWeek()) setWeekAround(dateInput.value);
    const months = bookingMonths(monthsSelect.value);
    const price = bookingPrice(typeSelect.value, categorySelect.value, timeSelect.value);
    const requested = { date: dateInput.value, time: timeSelect.value, type: typeSelect.value, months, endDate: addMonths(dateInput.value, months) };
    const closed = isSlotClosed(dateInput.value, timeSelect.value);
    const taken = cachedBookings.some(item => bookingsConflict(item, requested));
    const period = typeSelect.value === 'monthly' ? ` · zauzeto ${monthsLabel(months)} · plaćanje mjesečno · do ${formatDate(addMonths(dateInput.value, months))}` : '';
    const priceLabel = typeSelect.value === 'monthly' ? `${price} KM / mjesec` : `${price} KM`;
    monthsWrap.hidden = typeSelect.value !== 'monthly';
    summary.innerHTML = `
      <span>${formatDate(dateInput.value)} · ${timeSelect.value}</span>
      <strong>${priceLabel}</strong>
      <small>${bookingTypeLabel(typeSelect.value)}${period} · ${categoryLabel(categorySelect.value)}${taken ? ' · termin je već zauzet' : ''}</small>
    `;
    message.textContent = closed ? 'Nedjeljom su dostupni termini od 12:00 do 22:00.' : taken ? 'Ovaj termin je već rezervisan. Odaberite drugi datum ili sat.' : '';
    message.classList.toggle('error', closed || taken);
    renderWeekSchedule();
    renderOwnBookings();
  }

  function rememberOwnBooking(booking) {
    if (!booking?.id || !booking?.cancelToken) return;
    const mine = ownBookings().filter(item => item.id !== booking.id);
    mine.push({
      id: booking.id,
      cancelToken: booking.cancelToken,
      date: booking.date,
      time: booking.time,
      type: booking.type,
      months: booking.months,
      endDate: booking.endDate,
      price: booking.price,
      status: booking.status
    });
    saveOwnBookings(mine.slice(-8));
  }

  function renderOwnBookings() {
    const active = ownBookings()
      .filter(item => item.status !== 'cancelled' && item.status !== 'deleted')
      .sort((a, b) => `${a.date} ${a.time}`.localeCompare(`${b.date} ${b.time}`));
    ownBookingsWrap.hidden = active.length === 0;
    ownBookingsList.innerHTML = active.map(item => `
      <div class="own-booking">
        <div>
          <strong>${formatDate(item.date)} · ${item.time}</strong>
          <small>${bookingTypeLabel(item.type)}${item.type === 'monthly' ? ` · zauzeto ${monthsLabel(item.months)} · ${(item.price || 200)} KM/mj.` : ` · ${item.price || bookingPrice(item.type, 'standard', item.time)} KM`} · za izmjenu nazovite 062 290 622</small>
        </div>
      </div>
    `).join('');
  }

  async function refreshBookings() {
    cachedBookings = await loadBookings();
    updateSummary();
  }

  let modalOpening = false;

  async function openModal() {
    if (modal.classList.contains('open') || modalOpening) return;
    modalOpening = true;
    modal.classList.add('open');
    modal.setAttribute('aria-hidden', 'false');
    document.body.classList.add('modal-open');
    modal.querySelector('.booking-dialog').scrollTop = 0;
    message.textContent = 'Učitavam raspored...';
    message.classList.remove('error');
    try {
      await refreshBookings();
    } finally {
      modalOpening = false;
    }
  }

  function closeModal() {
    modal.classList.remove('open');
    modal.setAttribute('aria-hidden', 'true');
    document.body.classList.remove('modal-open');
  }

  document.querySelectorAll('.booking-trigger').forEach(button => {
    button.addEventListener('click', openModal);
  });
  document.querySelectorAll('a[href="#rezervacija"]').forEach(link => {
    link.addEventListener('click', () => window.setTimeout(openModal, 120));
  });
  window.addEventListener('hashchange', () => {
    if (window.location.hash === '#rezervacija') window.setTimeout(openModal, 120);
  });
  modal.querySelectorAll('[data-booking-close]').forEach(button => button.addEventListener('click', closeModal));
  document.addEventListener('keydown', event => {
    if (event.key === 'Escape' && modal.classList.contains('open')) closeModal();
  });
  [dateInput, timeSelect, typeSelect, monthsSelect, categorySelect].forEach(input => input.addEventListener('change', updateSummary));
  prevWeek.addEventListener('click', () => {
    currentWeekStart = addDays(currentWeekStart, -7);
    renderWeekSchedule();
  });
  nextWeek.addEventListener('click', () => {
    currentWeekStart = addDays(currentWeekStart, 7);
    renderWeekSchedule();
  });
  weekGrid.addEventListener('click', event => {
    const button = event.target.closest('.slot-btn.free');
    if (!button) return;
    dateInput.value = button.dataset.date;
    timeSelect.value = button.dataset.time;
    message.textContent = 'Termin je slobodan. Popunite podatke i pošaljite rezervaciju.';
    message.classList.remove('error');
    updateSummary();
  });
  form.addEventListener('submit', async event => {
    event.preventDefault();
    updateSummary();
    if (isSlotClosed(dateInput.value, timeSelect.value)) return;
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
      months: typeSelect.value === 'monthly' ? bookingMonths(monthsSelect.value) : 1,
      price: bookingPrice(typeSelect.value, categorySelect.value, timeSelect.value),
      paid: false,
      status: 'pending',
      renewalDate: typeSelect.value === 'monthly' ? nextRenewalDate(dateInput.value) : '',
      endDate: typeSelect.value === 'monthly' ? addMonths(dateInput.value, monthsSelect.value) : ''
    };

    try {
      message.textContent = 'Šaljem rezervaciju...';
      message.classList.remove('error');
      const saved = await createBooking(booking);
      cachedBookings.push(saved);
      rememberOwnBooking(saved);
      form.reset();
      dateInput.value = today;
      setWeekAround(today);
      updateSummary();
      message.textContent = 'Rezervacija je zabilježena. Za izmjenu ili otkazivanje nazovite 062 290 622.';
      message.classList.remove('error');
    } catch (error) {
      await refreshBookings();
      message.textContent = error.message || 'Rezervacija nije poslana.';
      message.classList.add('error');
    }
  });

  refreshBookings();
  if (window.location.hash === '#rezervacija') window.setTimeout(openModal, 350);
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
        <td><strong>${bookingTypeLabel(item.type)}</strong><small>${categoryLabel(item.category)}${item.type === 'monthly' ? ` · zauzeto ${monthsLabel(item.months)} · do ${formatDate(item.endDate || addMonths(item.date, item.months || 1))}` : ''}</small></td>
        <td><strong>${item.price} KM${item.type === 'monthly' ? '/mj.' : ''}</strong><small>${item.note || 'Bez napomene'}</small></td>
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
