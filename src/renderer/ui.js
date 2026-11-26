/* Shared UI helpers: DOM builder, one-at-a-time toast, popup menu, sheets. */
(function () {
  function h(tag, attrs, ...kids) {
    const el = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs || {})) {
      if (v === false || v == null) continue;
      if (k === 'class') el.className = v;
      else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
      else if (k === 'text') el.textContent = v;
      else if (v === true) el.setAttribute(k, '');
      else el.setAttribute(k, v);
    }
    for (const kid of kids.flat()) if (kid != null && kid !== false) el.append(kid.nodeType ? kid : document.createTextNode(kid));
    return el;
  }
  const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;

  // ---------- toast: one at a time, newest replaces older, hover pauses the timer ----------
  const Toast = (() => {
    let current = null;
    let timer = null;
    let remaining = 10000;
    let startedAt = 0;
    const host = () => document.getElementById('toast-host');
    function stop() { clearTimeout(timer); timer = null; }
    function arm(ms) { stop(); remaining = ms; startedAt = Date.now(); timer = setTimeout(clear, ms); }
    function clear() { stop(); current = null; const x = host(); if (x) x.replaceChildren(); }
    /** @param {{message:string, actions?:{label:string, run:()=>void}[], undo?:()=>void}} t */
    function show(t) {
      current = t;
      const el = h('div', { class: 'toast', role: 'status' },
        h('span', { class: 'msg', text: t.message }),
        (t.actions || []).map((a) => h('button', { class: 'btn', type: 'button', onclick: () => { clear(); a.run(); } }, a.label)));
      el.addEventListener('mouseenter', () => { if (timer) { remaining -= Date.now() - startedAt; stop(); } });
      el.addEventListener('mouseleave', () => { if (current === t && !timer) arm(Math.max(remaining, 1500)); });
      host().replaceChildren(el);
      arm(10000);
    }
    /** Run the visible toast's undo, if it has one. Returns true when something was undone. */
    function undo() { if (current && current.undo) { const f = current.undo; clear(); f(); return true; } return false; }
    return { show, clear, undo, get visible() { return !!current; } };
  })();

  // ---------- popup menu ----------
  let menuEl = null;
  let menuCleanup = null;
  function closeMenu() {
    if (menuCleanup) menuCleanup();
    menuCleanup = null;
    if (menuEl) menuEl.remove();
    menuEl = null;
  }
  /** items: {label, run, disabled, title, danger} | {separator:true}. `at` is an element or {x,y}. */
  function showMenu(items, at, opts = {}) {
    closeMenu();
    const prevFocus = document.activeElement;
    const menu = h('div', { class: 'menu', role: 'menu' }, items.map((it) => (it.separator
      ? h('div', { class: 'menu-sep', role: 'separator' })
      : h('button', {
        class: 'menu-item' + (it.danger ? ' danger' : ''), type: 'button', role: 'menuitem',
        'aria-disabled': it.disabled ? 'true' : null, title: it.title || null,
        onclick: () => { if (it.disabled) return; closeMenu(); if (prevFocus && prevFocus.focus) prevFocus.focus(); it.run(); },
      }, it.label))));
    document.body.append(menu);
    menuEl = menu;
    const r = menu.getBoundingClientRect();
    let x; let y;
    if (at && at.getBoundingClientRect) {
      const a = at.getBoundingClientRect();
      x = opts.alignRight ? a.right - r.width : a.left;
      y = a.bottom + 4;
    } else { x = at.x; y = at.y; }
    x = Math.max(8, Math.min(x, window.innerWidth - r.width - 8));
    y = Math.max(8, Math.min(y, window.innerHeight - r.height - 8));
    menu.style.left = `${x}px`;
    menu.style.top = `${y}px`;
    const buttons = () => [...menu.querySelectorAll('.menu-item')];
    const onDown = (e) => { if (!menu.contains(e.target)) closeMenu(); };
    const onKey = (e) => {
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); closeMenu(); if (prevFocus && prevFocus.focus) prevFocus.focus(); return; }
      const b = buttons(); const i = b.indexOf(document.activeElement);
      if (e.key === 'ArrowDown') { e.preventDefault(); (b[(i + 1) % b.length] || b[0]).focus(); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); (b[(i - 1 + b.length) % b.length] || b[0]).focus(); }
    };
    setTimeout(() => document.addEventListener('mousedown', onDown, true), 0);
    document.addEventListener('keydown', onKey, true);
    window.addEventListener('blur', closeMenu);
    menuCleanup = () => { document.removeEventListener('mousedown', onDown, true); document.removeEventListener('keydown', onKey, true); window.removeEventListener('blur', closeMenu); };
    const first = buttons().find((b) => b.getAttribute('aria-disabled') !== 'true');
    if (first) first.focus();
  }

  // ---------- sheets ----------
  const overlay = () => document.getElementById('overlay');
  function openSheet(modal) { overlay().replaceChildren(h('div', { class: 'scrim' }, modal)); }
  function closeSheet() { overlay().replaceChildren(); }
  const sheetOpen = () => overlay().children.length > 0;
  // A sheet that redraws itself can drop keyboard focus, so Esc is handled for the whole document.
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && sheetOpen() && !menuEl) { e.preventDefault(); closeSheet(); }
  });

  window.UI = { h, plural, Toast, showMenu, closeMenu, openSheet, closeSheet, sheetOpen };
})();
