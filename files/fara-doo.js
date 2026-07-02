
document.getElementById('year').textContent = new Date().getFullYear();

const header = document.getElementById('siteHeader');
window.addEventListener('scroll', () => {
  header.classList.toggle('scrolled', window.scrollY > 30);
});

const toggle = document.getElementById('navToggle');
const nav = document.getElementById('mainNav');
toggle.setAttribute('aria-expanded', 'false');

function setMenu(open) {
  nav.classList.toggle('open', open);
  toggle.classList.toggle('open', open);
  toggle.setAttribute('aria-expanded', String(open));
}

toggle.addEventListener('click', () => setMenu(!nav.classList.contains('open')));
nav.querySelectorAll('[data-close]').forEach(a => a.addEventListener('click', () => setMenu(false)));

const revealEls = document.querySelectorAll('.reveal');
const io = new IntersectionObserver((entries) => {
  entries.forEach(e => { if (e.isIntersecting) { e.target.classList.add('in'); io.unobserve(e.target); } });
}, { threshold: 0.12 });
revealEls.forEach(el => io.observe(el));
