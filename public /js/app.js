(() => {
  'use strict';

  // Mobile menu
  const tg = document.querySelector('.nav-toggle');
  if (tg) tg.addEventListener('click', () => {
    tg.setAttribute('aria-expanded', String(document.body.classList.toggle('nav-open')));
  });

  // data-confirm on forms (no inline JS because of CSP)
  document.addEventListener('submit', (e) => {
    const m = e.target.getAttribute && e.target.getAttribute('data-confirm');
    if (m && !window.confirm(m)) e.preventDefault();
  });

  // ---------- Polls ----------
  const polls = document.querySelectorAll('.poll[data-poll-id]');
  if (!polls.length) return;

  const nf = new Intl.NumberFormat(document.documentElement.lang === 'ar' ? 'ar-u-nu-latn' : 'fr-FR');
  const cardsOf = (id) => document.querySelectorAll(`.poll[data-poll-id="${id}"]`);
  const setStatus = (el, msg, err) => {
    const s = el.querySelector('.status');
    s.textContent = msg;
    s.classList.toggle('err', !!err);
  };
  const lock = (el) => { el.classList.add('is-locked'); el.querySelectorAll('.opt').forEach((b) => (b.disabled = true)); };
  const unlock = (el) => { el.classList.remove('is-locked'); el.querySelectorAll('.opt').forEach((b) => (b.disabled = false)); };

  function render(el, d) {
    el.querySelectorAll('.opt').forEach((b) => {
      const o = d.options.find((x) => String(x.id) === b.dataset.optionId);
      if (!o) return;
      b.querySelector('.bar i').style.width = o.percent + '%';
      b.querySelector('.pct').textContent = o.percent + '%';
    });
    el.querySelector('.total').textContent = nf.format(d.total);
    if (d.closed) { lock(el); el.classList.add('is-closed'); setStatus(el, el.dataset.msgClosed); }
  }

  // Real-time updates (Server-Sent Events) with polling fallback
  if ('EventSource' in window) {
    const es = new EventSource('/api/stream');
    es.onmessage = (ev) => { const d = JSON.parse(ev.data); cardsOf(d.id).forEach((el) => render(el, d)); };
  } else {
    setInterval(() => polls.forEach(async (el) => {
      try { render(el, await (await fetch(`/api/polls/${el.dataset.pollId}/results`)).json()); } catch {}
    }), 8000);
  }

  polls.forEach((el) => el.addEventListener('click', async (e) => {
    const btn = e.target.closest('.opt');
    if (!btn || el.classList.contains('is-locked')) return;
    lock(el);
    try {
      const res = await fetch(`/api/polls/${el.dataset.pollId}/vote`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ optionId: Number(btn.dataset.optionId) }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        btn.classList.add('mine'); render(el, data.results); setStatus(el, el.dataset.msgVoted);
      } else if (data.code === 'already_voted') {
        const mine = el.querySelector(`.opt[data-option-id="${data.votedOption}"]`);
        if (mine) mine.classList.add('mine');
        render(el, data.results); setStatus(el, el.dataset.errVoted, true);
      } else if (data.code === 'closed') {
        render(el, data.results || { options: [], total: 0, closed: true }); setStatus(el, el.dataset.errClosed, true);
      } else {
        unlock(el); setStatus(el, el.dataset.errGeneric, true);
      }
    } catch {
      unlock(el); setStatus(el, el.dataset.errGeneric, true);
    }
  }));
})();
