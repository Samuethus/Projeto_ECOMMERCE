/* MARGELLE — interações da landing page */
(function () {
  'use strict';

  /* ---------- Menu lateral ---------- */
  const toggle = document.querySelector('[data-menu-toggle]');
  const nav = document.getElementById('site-nav');

  function openMenu() {
    nav.hidden = false;
    toggle.setAttribute('aria-expanded', 'true');
    document.body.style.overflow = 'hidden';
    nav.querySelector('.site-nav__close').focus();
  }

  function closeMenu() {
    nav.hidden = true;
    toggle.setAttribute('aria-expanded', 'false');
    document.body.style.overflow = '';
    toggle.focus();
  }

  if (toggle && nav) {
    toggle.addEventListener('click', openMenu);
    nav.querySelectorAll('[data-menu-close]').forEach((el) => el.addEventListener('click', closeMenu));
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && !nav.hidden) closeMenu();
    });
  }

  /* ---------- Cabeçalho fixo: versão compacta ao rolar ---------- */
  const header = document.querySelector('.site-header');
  if (header) {
    const onScroll = () => header.classList.toggle('is-scrolled', window.scrollY > 10);
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
  }

  /* ---------- Newsletter (sem backend por enquanto) ---------- */
  const form = document.querySelector('[data-newsletter]');
  if (form) {
    const feedback = form.querySelector('.newsletter__feedback');
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      const email = form.elements.email;
      if (!email.checkValidity()) {
        feedback.textContent = 'Please enter a valid e-mail address.';
        email.focus();
        return;
      }
      feedback.textContent = 'Thank you for subscribing.';
      form.reset();
    });
  }
})();
