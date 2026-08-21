const STORAGE_KEY = 'faraSportBookings';
const MY_BOOKINGS_KEY = 'faraMyBookings';
const USER_APP_PHONE_KEY = 'faraUserAppPhone';
const API_URL = '/api/bookings';
const GYM_API_URL = '/api/gym';
const GYM_TENANT_ID = 'fara-sport-centar';
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

function normalizePhone(value) {
  const digits = String(value || '').replace(/\D/g, '');
  if (digits.startsWith('00387')) return `387${digits.slice(5)}`;
  if (digits.startsWith('0')) return `387${digits.slice(1)}`;
  return digits;
}

function useOnlineApi() {
  return location.protocol === 'http:' || location.protocol === 'https:';
}

function initPwa() {
  if (!('serviceWorker' in navigator) || !useOnlineApi()) return;
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => {});
  });
}

async function requestBookings(options = {}) {
  if (!useOnlineApi()) return { bookings: localBookings(), local: true };
  const { url = API_URL, ...fetchOptions } = options;
  const response = await fetch(url, {
    ...fetchOptions,
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

async function loadUserBookings(phone, pin) {
  if (!useOnlineApi()) {
    return localBookings().filter(item => normalizePhone(item.phone) === normalizePhone(phone) && String(item.userPin || '') === String(pin || ''));
  }
  const data = await requestBookings({
    method: 'GET',
    url: `${API_URL}?mine=1&phone=${encodeURIComponent(phone)}&pin=${encodeURIComponent(pin)}`
  });
  return data.bookings || [];
}

async function createBooking(booking, adminPin = '') {
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
    headers: adminPin ? { 'X-Admin-Pin': adminPin } : {},
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
      if (action === 'pin') return { ...item, userPin: String(Math.floor(1000 + Math.random() * 9000)) };
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

async function requestGym(adminPin, options = {}) {
  const response = await fetch(GYM_API_URL, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      'X-Admin-Pin': adminPin,
      ...(options.headers || {})
    }
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || 'Greška pri učitavanju teretane.');
  return data;
}

async function loadGym(adminPin) {
  const data = await requestGym(adminPin, {
    method: 'GET'
  });
  return data.tenant || { membershipTypes: [], members: [], payments: [], visits: [] };
}

async function gymAction(adminPin, action, payload = {}) {
  return requestGym(adminPin, {
    method: 'POST',
    body: JSON.stringify({ action, tenantId: GYM_TENANT_ID, ...payload })
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

function cleanUserPin(value) {
  return String(value || '').replace(/\D/g, '').slice(0, 6);
}

function categoryLabel(category) {
  return category === 'school' ? 'Školarci / akademije / klubovi' : 'Standardni termin';
}

function gymStatus(member) {
  const today = new Date().toISOString().slice(0, 10);
  if (!member?.endDate || member.endDate < today) return 'expired';
  if (member.endDate <= toDateInputValue(addDays(toLocalDate(today), 7))) return 'expiring';
  return 'active';
}

function gymStatusLabel(status) {
  if (status === 'active') return 'Aktivno';
  if (status === 'expiring') return 'Uskoro ističe';
  if (status === 'expired') return 'Isteklo';
  return 'Nepoznato';
}

function money(value) {
  return `${Number(value || 0)} KM`;
}

function memberFullName(member) {
  return `${member.firstName || ''} ${member.lastName || ''}`.trim();
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

    const selectedDayIndex = days.findIndex(day => toDateInputValue(day) === dateInput.value);
    const mobileDateOrder = selectedDayIndex >= 0 ? [...days.slice(selectedDayIndex), ...days.slice(0, selectedDayIndex)] : days;
    const mobileDateChips = mobileDateOrder.map(day => {
      const dateValue = toDateInputValue(day);
      const isPast = dateValue < today;
      const freeCount = timeSlots.filter(time => !isPast && !isSlotClosed(dateValue, time) && !isSlotTaken(dateValue, time)).length;
      return `
        <button type="button" class="mobile-date-chip${dateInput.value === dateValue ? ' selected' : ''}" data-date="${dateValue}" ${isPast ? 'disabled' : ''}>
          <span>${DAY_SHORT[day.getDay()]}</span>
          <strong>${String(day.getDate()).padStart(2, '0')}.${String(day.getMonth() + 1).padStart(2, '0')}.</strong>
          <small>${dateValue === today ? 'Danas' : isPast ? 'Prošlo' : `${freeCount} slob.`}</small>
        </button>
      `;
    }).join('');

    const selectedDate = toLocalDate(dateInput.value);
    const selectedDateLabel = `${DAY_SHORT[selectedDate.getDay()]} ${String(selectedDate.getDate()).padStart(2, '0')}.${String(selectedDate.getMonth() + 1).padStart(2, '0')}.`;
    const selectedSlots = timeSlots.map(time => {
      const past = dateInput.value < today;
      const closed = isSlotClosed(dateInput.value, time);
      const busy = isSlotTaken(dateInput.value, time);
      const selected = timeSelect.value === time;
      const state = past ? 'past' : closed ? 'closed' : busy ? 'busy' : 'free';
      const label = past ? 'Prošlo' : closed ? 'Zatvoreno' : busy ? 'Zauzeto' : 'Slobodno';
      return `
        <button type="button" class="slot-btn ${state}${selected ? ' selected' : ''}" data-date="${dateInput.value}" data-time="${time}" ${state === 'free' ? '' : 'disabled'}>
          <span>${time} - ${String(Number(time.slice(0, 2)) + 1).padStart(2, '0')}:00</span>
          <strong>${label}</strong>
        </button>
      `;
    }).join('');

    weekGrid.innerHTML = `
      <table class="week-table">
        <thead><tr><th>Sat</th>${head}</tr></thead>
        <tbody>${rows}</tbody>
      </table>
      <div class="mobile-week-list">
        <div class="mobile-step-row">
          <div class="mobile-step-label">1. Izaberite dan</div>
          <div class="mobile-scroll-hint">Listajte dane →</div>
        </div>
        <div class="mobile-date-strip">${mobileDateChips}</div>
        <section class="mobile-day-card">
          <div class="mobile-step-label">2. Izaberite sat</div>
          <h4>${selectedDateLabel}${dateInput.value === today ? '<small>Danas</small>' : ''}</h4>
          <div class="mobile-slots">${selectedSlots}</div>
        </section>
      </div>
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
      status: booking.status,
      userPin: booking.userPin
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
    const dateChip = event.target.closest('.mobile-date-chip');
    if (dateChip && !dateChip.disabled) {
      dateInput.value = dateChip.dataset.date;
      message.textContent = 'Odaberite slobodan sat za ovaj dan.';
      message.classList.remove('error');
      updateSummary();
      return;
    }
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
      message.textContent = saved.userPin
        ? `Rezervacija je zabilježena. Vaš PIN za app je ${saved.userPin}. Sačuvajte ga uz broj telefona.`
        : 'Rezervacija je zabilježena. Za izmjenu ili otkazivanje nazovite 062 290 622.';
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

function initUserApp() {
  const form = document.getElementById('userAppLogin');
  const phoneInput = document.getElementById('userAppPhone');
  const pinInput = document.getElementById('userAppPin');
  const message = document.getElementById('userAppMessage');
  const panel = document.getElementById('userBookingsPanel');
  const list = document.getElementById('userBookingsList');
  const logout = document.getElementById('userAppLogout');
  if (!form || !phoneInput || !pinInput || !message || !panel || !list) return;

  function activeOwnerBookings(bookings) {
    const today = new Date().toISOString().slice(0, 10);
    return bookings
      .filter(item => item.status !== 'cancelled' && item.status !== 'deleted')
      .filter(item => (item.endDate || item.date) >= today)
      .sort((a, b) => `${a.date} ${a.time}`.localeCompare(`${b.date} ${b.time}`));
  }

  function renderUserBookings(bookings) {
    const active = activeOwnerBookings(bookings);
    panel.hidden = false;
    if (!active.length) {
      list.innerHTML = `
        <article class="user-empty-card">
          <strong>Nema aktivnih termina za ovaj broj.</strong>
          <small>Provjerite da li je broj isti kao kod rezervacije ili otvorite raspored za novi termin.</small>
          <a href="index.html#rezervacija" class="btn btn-dark">Otvori raspored</a>
        </article>
      `;
      return;
    }

    list.innerHTML = active.map(item => {
      const type = bookingTypeLabel(item.type);
      const monthly = item.type === 'monthly';
      const price = monthly ? `${item.price || 200} KM / mjesec` : `${item.price || bookingPrice(item.type, item.category, item.time)} KM`;
      const period = monthly ? ` · do ${formatDate(item.endDate)}` : '';
      const paid = item.paid ? 'Plaćeno' : 'Provjeriti uplatu';
      return `
        <article class="user-booking-card">
          <div class="user-booking-time">
            <span>${item.time}</span>
            <small>${formatDate(item.date)}</small>
          </div>
          <div class="user-booking-info">
            <strong>${type}${period}</strong>
            <small>${price} · ${paid}</small>
          </div>
          <span class="user-booking-status ${item.paid ? 'paid' : 'pending'}">${item.paid ? 'OK' : 'Info'}</span>
        </article>
      `;
    }).join('');
  }

  async function lookup(phone, pin) {
    const cleanPhone = phone.trim();
    const cleanPin = cleanUserPin(pin);
    if (!normalizePhone(cleanPhone)) {
      message.textContent = 'Unesite broj telefona.';
      message.classList.add('error');
      return;
    }
    if (!cleanPin) {
      message.textContent = 'Unesite PIN za pristup.';
      message.classList.add('error');
      return;
    }
    message.textContent = 'Učitavam vaše termine...';
    message.classList.remove('error');
    try {
      const bookings = await loadUserBookings(cleanPhone, cleanPin);
      localStorage.setItem(USER_APP_PHONE_KEY, cleanPhone);
      renderUserBookings(bookings);
      message.textContent = bookings.length ? 'Termini su učitani.' : 'Nema pronađenih termina za ovaj broj i PIN.';
    } catch (error) {
      message.textContent = error.message || 'Nije moguće učitati termine.';
      message.classList.add('error');
    }
  }

  form.addEventListener('submit', event => {
    event.preventDefault();
    lookup(phoneInput.value, pinInput.value);
  });

  if (logout) {
    logout.addEventListener('click', () => {
      localStorage.removeItem(USER_APP_PHONE_KEY);
      phoneInput.value = '';
      pinInput.value = '';
      panel.hidden = true;
      list.innerHTML = '';
      message.textContent = 'Unesite drugi broj telefona i PIN.';
      phoneInput.focus();
    });
  }

  const savedPhone = localStorage.getItem(USER_APP_PHONE_KEY) || '';
  if (savedPhone) {
    phoneInput.value = savedPhone;
  }
}

function initAdminPanel() {
  const tableBody = document.getElementById('adminBookings');
  const empty = document.getElementById('adminEmpty');
  const dateFilter = document.getElementById('adminDateFilter');
  const statusFilter = document.getElementById('adminStatusFilter');
  const searchFilter = document.getElementById('adminSearchFilter');
  const exportButton = document.getElementById('exportBookings');
  const seedButton = document.getElementById('seedDemoBooking');
  const createForm = document.getElementById('adminCreateForm');
  const createDate = document.getElementById('adminCreateDate');
  const createTime = document.getElementById('adminCreateTime');
  const createType = document.getElementById('adminCreateType');
  const createMonthsWrap = document.getElementById('adminCreateMonthsWrap');
  const createMonths = document.getElementById('adminCreateMonths');
  const createCategory = document.getElementById('adminCreateCategory');
  const createName = document.getElementById('adminCreateName');
  const createPhone = document.getElementById('adminCreatePhone');
  const createUserPin = document.getElementById('adminCreateUserPin');
  const createNote = document.getElementById('adminCreateNote');
  const createPaid = document.getElementById('adminCreatePaid');
  const createMessage = document.getElementById('adminCreateMessage');
  const adminWeekGrid = document.getElementById('adminWeekGrid');
  const adminWeekLabel = document.getElementById('adminWeekLabel');
  const adminPrevWeek = document.getElementById('adminPrevWeek');
  const adminNextWeek = document.getElementById('adminNextWeek');
  const loginPanel = document.getElementById('adminLogin');
  const loginForm = document.getElementById('adminLoginForm');
  const loginError = document.getElementById('adminLoginError');
  const adminContent = document.getElementById('adminContent');
  const adminNavLinks = document.querySelectorAll('[data-admin-view]');
  const adminModules = document.querySelectorAll('[data-admin-module]');
  const gymMemberForm = document.getElementById('gymMemberForm');
  const gymMemberId = document.getElementById('gymMemberId');
  const gymFirstName = document.getElementById('gymFirstName');
  const gymLastName = document.getElementById('gymLastName');
  const gymPhone = document.getElementById('gymPhone');
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
  const gymMembersBody = document.getElementById('gymMembers');
  const gymEmpty = document.getElementById('gymEmpty');
  const gymExport = document.getElementById('gymExport');
  if (!tableBody || !empty || !dateFilter || !statusFilter || !searchFilter) return;

  let adminPin = sessionStorage.getItem('faraAdminPin') || '';
  let adminBookings = [];
  let gymData = { membershipTypes: [], members: [], payments: [], visits: [] };
  const today = new Date().toISOString().slice(0, 10);
  const adminTimeSlots = [];
  let adminWeekStart = startOfWeek(toLocalDate(today));

  if (createDate) {
    createDate.min = today;
    createDate.value = today;
  }

  if (createTime) {
    for (let hour = 8; hour <= 22; hour += 1) {
      const value = `${String(hour).padStart(2, '0')}:00`;
      adminTimeSlots.push(value);
      const option = document.createElement('option');
      option.value = value;
      option.textContent = `${value} - ${String(hour + 1).padStart(2, '0')}:00`;
      createTime.appendChild(option);
    }
    createTime.value = '18:00';
  }

  if (!adminTimeSlots.length) {
    for (let hour = 8; hour <= 22; hour += 1) {
      adminTimeSlots.push(`${String(hour).padStart(2, '0')}:00`);
    }
  }

  if (gymStartDate) gymStartDate.value = today;

  function setAdminView(view, activeHref = '') {
    adminModules.forEach(module => {
      module.classList.toggle('active', module.dataset.adminModule === view);
    });
    adminNavLinks.forEach(link => {
      const href = link.getAttribute('href') || '';
      const isActive = activeHref ? href === activeHref : link.dataset.adminView === view && href !== '#raspored';
      link.classList.toggle('active', isActive);
    });
  }

  adminNavLinks.forEach(link => {
    link.addEventListener('click', event => {
      event.preventDefault();
      const view = link.dataset.adminView || 'terms';
      const href = link.getAttribute('href') || '#termini';
      setAdminView(view, href);
      window.history.replaceState(null, '', view === 'gym' ? '#teretana' : href);
      if (view === 'terms' && href !== '#termini') {
        document.querySelector(href)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }
    });
  });

  if (window.location.hash === '#teretana') setAdminView('gym', '#teretana');
  if (window.location.hash === '#raspored') setAdminView('terms', '#raspored');

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

  function bookingForSlot(date, time) {
    return adminBookings.find(item => bookingsConflict(item, { date, time, type: 'single' }));
  }

  function renderAdminWeekSchedule() {
    if (!adminWeekGrid || !adminWeekLabel) return;
    const days = Array.from({ length: 7 }, (_, index) => addDays(adminWeekStart, index));
    adminWeekLabel.textContent = `${shortDate(days[0])} - ${shortDate(days[6])}`;

    const head = days.map(day => {
      const value = toDateInputValue(day);
      const label = `${DAY_SHORT[day.getDay()]} ${String(day.getDate()).padStart(2, '0')}.${String(day.getMonth() + 1).padStart(2, '0')}.`;
      return `<th>${label}${value === today ? '<small>Danas</small>' : ''}</th>`;
    }).join('');

    const rows = adminTimeSlots.map(time => {
      const cells = days.map(day => {
        const dateValue = toDateInputValue(day);
        const past = dateValue < today;
        const closed = isSlotClosed(dateValue, time);
        const booking = bookingForSlot(dateValue, time);
        const state = booking ? 'busy' : past ? 'past' : closed ? 'closed' : 'free';
        const label = booking ? (booking.name || 'Zauzeto') : past ? 'Prošlo' : closed ? 'Zatvoreno' : 'Slobodno';
        const detail = booking ? `${booking.type === 'monthly' ? 'Stalni' : 'Jedan'}${booking.paid ? ' · Plaćeno' : ' · Nije plaćeno'}` : '';
        return `
          <td>
            <button type="button" class="admin-slot ${state}" data-date="${dateValue}" data-time="${time}" ${booking ? `data-booking-id="${booking.id}"` : ''}>
              <strong>${label}</strong>
              ${detail ? `<small>${detail}</small>` : ''}
            </button>
          </td>
        `;
      }).join('');
      return `<tr><td>${time}</td>${cells}</tr>`;
    }).join('');

    adminWeekGrid.innerHTML = `
      <table class="admin-week-table">
        <thead><tr><th>Sat</th>${head}</tr></thead>
        <tbody>${rows}</tbody>
      </table>
    `;
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
        <td><strong>${item.name}</strong><small>${item.phone}${item.userPin ? ` · PIN ${item.userPin}` : ''}${item.email ? ` · ${item.email}` : ''}</small></td>
        <td><strong>${bookingTypeLabel(item.type)}</strong><small>${categoryLabel(item.category)}${item.type === 'monthly' ? ` · zauzeto ${monthsLabel(item.months)} · do ${formatDate(item.endDate || addMonths(item.date, item.months || 1))}` : ''}</small></td>
        <td><strong>${item.price} KM${item.type === 'monthly' ? '/mj.' : ''}</strong><small>${item.note || 'Bez napomene'}</small></td>
        <td><span class="status-pill ${statusClass}">${statusText}</span></td>
        <td>
          <div class="admin-actions">
            <button class="mini-btn paid" data-action="paid" data-id="${item.id}">${item.paid ? 'Neplaćeno' : 'Plaćeno'}</button>
            <button class="mini-btn" data-action="cancel" data-id="${item.id}">${item.status === 'cancelled' ? 'Vrati' : 'Otkaži'}</button>
            <button class="mini-btn" data-action="pin" data-id="${item.id}">Novi PIN</button>
            <button class="mini-btn danger" data-action="delete" data-id="${item.id}">Briši</button>
          </div>
        </td>
      `;
      tableBody.appendChild(tr);
    });
    updateStats();
    renderAdminWeekSchedule();
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

  function memberPaidTotal(memberId) {
    return memberPayments(memberId).reduce((total, payment) => total + Number(payment.amount || 0), 0);
  }

  function memberDebt(member) {
    return Math.max(0, Number(gymType(member.membershipTypeId).price || 0) - memberPaidTotal(member.id));
  }

  function updateGymEndDate() {
    if (!gymStartDate || !gymEndDate || !gymMembershipType) return;
    const type = gymType(gymMembershipType.value);
    gymEndDate.value = addDays(toLocalDate(gymStartDate.value || today), Number(type.durationDays || 30)).toISOString().slice(0, 10);
  }

  function renderGymTypes() {
    if (!gymMembershipType || !gymTypeList) return;
    gymMembershipType.innerHTML = gymData.membershipTypes.map(type => `
      <option value="${type.id}">${type.name} · ${type.price} KM</option>
    `).join('');
    gymTypeList.innerHTML = gymData.membershipTypes.map(type => `
      <span><strong>${money(type.price)}</strong> ${type.name}</span>
    `).join('');
    updateGymEndDate();
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
      .sort((a, b) => `${a.endDate} ${memberFullName(a)}`.localeCompare(`${b.endDate} ${memberFullName(b)}`));
  }

  function updateGymStats() {
    const members = gymData.members.filter(member => !member.deleted);
    const month = today.slice(0, 7);
    const revenue = gymData.payments
      .filter(payment => !payment.deleted && String(payment.date || '').startsWith(month))
      .reduce((total, payment) => total + Number(payment.amount || 0), 0);
    const active = members.filter(member => gymStatus(member) === 'active').length;
    const expiring = members.filter(member => gymStatus(member) === 'expiring').length;
    const expired = members.filter(member => gymStatus(member) === 'expired').length;
    document.getElementById('gymStatActive').textContent = active;
    document.getElementById('gymStatExpiring').textContent = expiring;
    document.getElementById('gymStatExpired').textContent = expired;
    document.getElementById('gymStatRevenue').textContent = money(revenue);
  }

  function renderGymMembers() {
    if (!gymMembersBody || !gymEmpty) return;
    const members = filteredGymMembers();
    gymMembersBody.innerHTML = '';
    gymEmpty.hidden = members.length > 0;
    members.forEach(member => {
      const status = gymStatus(member);
      const type = gymType(member.membershipTypeId);
      const payments = memberPayments(member.id);
      const visits = memberVisits(member.id);
      const paidTotal = memberPaidTotal(member.id);
      const debt = memberDebt(member);
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td>
          <div class="gym-member-cell">
            <span><strong>${memberFullName(member)}</strong><small>${member.phone}${member.note ? ` · ${member.note}` : ''}</small></span>
          </div>
        </td>
        <td><strong>${type.name}</strong><small>${formatDate(member.startDate)} - ${formatDate(member.endDate)}</small></td>
        <td><strong>${money(paidTotal)}</strong><small>${debt > 0 ? `Dug: ${money(debt)}` : 'Bez duga'}</small></td>
        <td><strong>${visits.length}</strong><small>${visits[0] ? `Zadnji: ${formatDate(visits[visits.length - 1].date)}` : 'Nema dolazaka'}</small></td>
        <td><span class="status-pill ${status === 'active' ? 'paid' : status === 'expiring' ? 'pending' : 'cancelled'}">${gymStatusLabel(status)}</span></td>
        <td>
          <div class="admin-actions">
            <button class="mini-btn paid" data-gym-action="visit" data-id="${member.id}">Dolazak</button>
            <button class="mini-btn paid" data-gym-action="payment" data-id="${member.id}">Uplata</button>
            <button class="mini-btn" data-gym-action="edit" data-id="${member.id}">Uredi</button>
            <button class="mini-btn danger" data-gym-action="delete" data-id="${member.id}">Briši</button>
          </div>
        </td>
      `;
      gymMembersBody.appendChild(tr);
    });
    updateGymStats();
  }

  async function refreshGym() {
    if (!adminPin) return;
    try {
      gymData = await loadGym(adminPin);
      renderGymTypes();
      renderGymMembers();
      if (gymMessage) {
        gymMessage.textContent = '';
        gymMessage.classList.remove('error');
      }
    } catch (error) {
      if (gymMessage) {
        gymMessage.textContent = error.message || 'Teretana trenutno nije učitana.';
        gymMessage.classList.add('error');
      }
    }
  }

  function resetGymForm() {
    if (!gymMemberForm) return;
    gymMemberForm.reset();
    if (gymMemberId) gymMemberId.value = '';
    if (gymStartDate) gymStartDate.value = today;
    if (document.getElementById('gymFormTitle')) document.getElementById('gymFormTitle').textContent = 'Dodaj člana';
    renderGymTypes();
  }

  function loadMemberIntoForm(member) {
    if (!member) return;
    setAdminView('gym');
    gymMemberId.value = member.id;
    gymFirstName.value = member.firstName || '';
    gymLastName.value = member.lastName || '';
    gymPhone.value = member.phone || '';
    gymMembershipType.value = member.membershipTypeId || gymMembershipType.value;
    gymStartDate.value = member.startDate || today;
    gymEndDate.value = member.endDate || today;
    gymNote.value = member.note || '';
    if (gymPaidNow) gymPaidNow.checked = false;
    if (document.getElementById('gymFormTitle')) document.getElementById('gymFormTitle').textContent = 'Uredi člana';
    document.getElementById('teretana')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
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
    await refreshGym();
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
  [gymStatusFilter, gymSearchFilter].filter(Boolean).forEach(input => input.addEventListener('input', renderGymMembers));
  [gymMembershipType, gymStartDate].filter(Boolean).forEach(input => input.addEventListener('change', updateGymEndDate));

  if (gymResetForm) gymResetForm.addEventListener('click', resetGymForm);

  if (gymExport) {
    gymExport.addEventListener('click', () => {
      const blob = new Blob([JSON.stringify(gymData, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `fara-teretana-${new Date().toISOString().slice(0, 10)}.json`;
      a.click();
      URL.revokeObjectURL(url);
    });
  }

  if (gymMembersBody) {
    gymMembersBody.addEventListener('click', async event => {
      const button = event.target.closest('button[data-gym-action]');
      if (!button) return;
      const member = gymData.members.find(item => item.id === button.dataset.id);
      if (!member) return;
      const action = button.dataset.gymAction;
      try {
        if (action === 'edit') return loadMemberIntoForm(member);
        if (action === 'delete') {
          if (!confirm(`Obrisati člana ${memberFullName(member)}?`)) return;
          await gymAction(adminPin, 'deleteMember', { id: member.id });
        }
        if (action === 'visit') {
          await gymAction(adminPin, 'addVisit', { memberId: member.id, date: today });
        }
        if (action === 'payment') {
          const type = gymType(member.membershipTypeId);
          const amount = Number(prompt('Iznos uplate (KM):', type.price) || 0);
          if (!amount) return;
          await gymAction(adminPin, 'addPayment', { memberId: member.id, amount, date: today, note: 'Uplata iz admin panela' });
        }
        await refreshGym();
      } catch (error) {
        alert(error.message || 'Akcija nije uspjela.');
      }
    });
  }

  if (gymMemberForm) {
    gymMemberForm.addEventListener('submit', async event => {
      event.preventDefault();
      if (!adminPin) return;
      const button = gymMemberForm.querySelector('button[type="submit"]');
      if (button) {
        button.disabled = true;
        button.textContent = 'Čuvam...';
      }
      try {
        await gymAction(adminPin, 'saveMember', {
          id: gymMemberId.value,
          firstName: gymFirstName.value.trim(),
          lastName: gymLastName.value.trim(),
          phone: gymPhone.value.trim(),
          note: gymNote.value.trim(),
          membershipTypeId: gymMembershipType.value,
          startDate: gymStartDate.value,
          endDate: gymEndDate.value,
          paidNow: gymPaidNow.checked
        });
        resetGymForm();
        await refreshGym();
        if (gymMessage) {
          gymMessage.textContent = 'Član je sačuvan.';
          gymMessage.classList.remove('error');
        }
      } catch (error) {
        if (gymMessage) {
          gymMessage.textContent = error.message || 'Član nije sačuvan.';
          gymMessage.classList.add('error');
        }
      } finally {
        if (button) {
          button.disabled = false;
          button.textContent = 'Sačuvaj člana';
        }
      }
    });
  }

  if (adminPrevWeek) {
    adminPrevWeek.addEventListener('click', () => {
      adminWeekStart = addDays(adminWeekStart, -7);
      renderAdminWeekSchedule();
    });
  }

  if (adminNextWeek) {
    adminNextWeek.addEventListener('click', () => {
      adminWeekStart = addDays(adminWeekStart, 7);
      renderAdminWeekSchedule();
    });
  }

  if (adminWeekGrid) {
    adminWeekGrid.addEventListener('click', event => {
      const slot = event.target.closest('.admin-slot');
      if (!slot || !slot.dataset.date) return;
      dateFilter.value = slot.dataset.date;
      searchFilter.value = '';
      statusFilter.value = 'all';
      render();
      document.getElementById('rezervacije')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
  }

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
          userPin: '2026',
          email: '',
          note: 'Test unos',
          paid: false
        }, adminPin);
        await refreshAdmin();
      } catch (error) {
        alert(error.message || 'Test unos nije uspio.');
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
      if (createMessage) {
        createMessage.textContent = '';
        createMessage.classList.remove('error');
      }
      try {
        const booking = {
          date: createDate.value,
          time: createTime.value,
          type: createType.value,
          category: createCategory.value,
          name: createName.value.trim(),
          phone: createPhone.value.trim(),
          userPin: createUserPin ? cleanUserPin(createUserPin.value) : '',
          email: '',
          note: createNote.value.trim() || 'Ručni unos iz admin panela',
          months: createType.value === 'monthly' ? bookingMonths(createMonths.value) : 1,
          paid: createPaid.checked
        };
        const saved = await createBooking(booking, adminPin);
        createForm.reset();
        createDate.value = today;
        createTime.value = '18:00';
        if (createUserPin) createUserPin.value = '';
        createMonthsWrap.hidden = true;
        await refreshAdmin();
        if (createMessage) createMessage.textContent = saved.userPin
          ? `Termin je dodat. PIN za korisnika je ${saved.userPin}.`
          : 'Termin je dodat i odmah je zauzet u rasporedu.';
      } catch (error) {
        if (createMessage) {
          createMessage.textContent = error.message || 'Termin nije dodat.';
          createMessage.classList.add('error');
        } else {
          alert(error.message || 'Termin nije dodat.');
        }
      } finally {
        if (submitButton) {
          submitButton.disabled = false;
          submitButton.textContent = 'Dodaj termin';
        }
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
initUserApp();
initAdminPanel();
initPwa();
