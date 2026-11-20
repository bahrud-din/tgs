/* =========================================================
   THE GRAMMAR SURGERY — Logika Aplikasi (v2)
   Bisa berjalan: (1) di Google Apps Script, (2) di GitHub Pages
   dengan backend Apps Script, (3) mode pratinjau.
   ========================================================= */
(function () {
  'use strict';
  var M = window.MANIFEST, CFG = window.TGS_CONFIG || {}, ASSETS = window.TGS_ASSETS || {};
  var $ = function (s, r) { return (r || document).querySelector(s); };
  var $$ = function (s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); };
  var html = document.documentElement, body = document.body;

  /* ---------- Penyimpanan lokal ---------- */
  var store = {
    get: function (k, d) { try { var v = localStorage.getItem('tgs_' + k); return v ? JSON.parse(v) : d; } catch (e) { return d; } },
    set: function (k, v) { try { localStorage.setItem('tgs_' + k, JSON.stringify(v)); } catch (e) {} },
    del: function (k) { try { localStorage.removeItem('tgs_' + k); } catch (e) {} },
    clear: function () { try { Object.keys(localStorage).forEach(function (k) { if (k.indexOf('tgs_') === 0) localStorage.removeItem(k); }); } catch (e) {} }
  };
  var sess = {
    get: function (k) { try { return sessionStorage.getItem('tgs_' + k); } catch (e) { return null; } },
    set: function (k, v) { try { sessionStorage.setItem('tgs_' + k, v); } catch (e) {} },
    del: function (k) { try { sessionStorage.removeItem('tgs_' + k); } catch (e) {} }
  };
  var prefersDark = window.matchMedia && matchMedia('(prefers-color-scheme: dark)').matches;
  var prefs = store.get('prefs', { theme: prefersDark ? 'dark' : 'light', scale: 1, sepia: false, wide: false });
  var prog = store.get('prog', { read: [], marks: [], last: null });
  var access = store.get('access', null);            // { code, scope: 'ALL' | ['bab1',...] }
  var device = store.get('device', null);
  if (!device) { device = (Date.now().toString(36) + Math.random().toString(36).slice(2, 10)).toUpperCase(); store.set('device', device); }
  var sessionStart = Date.now();
  function saveProg() { store.set('prog', prog); }
  function savePrefs() { store.set('prefs', prefs); }

  /* ---------- Pengaturan (bawaan, diperbarui dari server) ---------- */
  var S = {
    title: M.title, subtitle: M.subtitle, author: M.author, publisher: '', city: 'Kediri', year: '2027', isbn: '', edition: 'Cetakan Pertama',
    size: '15,5 × 23 cm', pages: '', email: '', waAdmin: '6285190037599', merchant: 'BeeCOMP Servis', qrisUrl: '',
    priceChapter: 10000, priceAll: 50000, freeEntries: 10, maxDevices: 2, announcementOn: false, announcement: '',
    protectCopy: true, protectRightClick: true, protectSwap: true, protectPrint: true, autoPublish: true
  };

  /* ---------- Jembatan ke backend ---------- */
  var IS_GAS = !!(window.google && google.script && google.script.run);
  var API_URL = (CFG.API_URL || '').trim();
  var HAS_API = IS_GAS || /^https:\/\//.test(API_URL) || !!window.PREVIEW_API;
  function call(action, params) {
    var req = params || {};
    req.action = action; req.device = device;
    if (req.code === undefined && access) req.code = access.code;
    var unwrap = function (r) {
      if (r && r.ok) return r.data;
      var e = new Error((r && r.error) || 'Terjadi kesalahan.'); e.code = r && r.code; throw e;
    };
    if (IS_GAS) {
      return new Promise(function (res, rej) {
        google.script.run.withSuccessHandler(function (r) { try { res(unwrap(r)); } catch (e) { rej(e); } })
          .withFailureHandler(function (e) { rej(new Error(e && e.message || 'Koneksi ke server gagal.')); }).api(req);
      });
    }
    if (/^https:\/\//.test(API_URL)) {
      return fetch(API_URL, { method: 'POST', body: JSON.stringify(req), redirect: 'follow' })
        .then(function (r) { if (!r.ok) throw new Error('Server tidak merespons (' + r.status + ').'); return r.json(); })
        .then(unwrap, function (e) { throw e.code ? e : new Error('Koneksi ke server gagal. Periksa internet Anda.'); });
    }
    if (window.PREVIEW_API) return window.PREVIEW_API(req).then(unwrap);
    return Promise.reject(new Error('Alamat API belum diatur (lihat assets/js/config.js).'));
  }

  /* ---------- Data & hak akses ---------- */
  var PARTS = M.parts, PART = {};
  PARTS.forEach(function (p, i) { p.index = i; PART[p.id] = p; });
  var CH = {}; M.chapters.forEach(function (c) { CH[c.id] = c; });
  var CHIDS = ['bab1', 'bab2', 'bab3', 'bab4', 'bab5', 'bab6', 'bab7'];
  var FREE_FILES = ['front', 'back'];
  var fileCache = {}, searchIndex = null, counts = {};
  function chTitle(id) { return id === 'bab7' ? 'Uji Kompetensi Terpadu' : (CH[id] ? CH[id].title : id); }
  function chNum(id) { return +id.replace('bab', ''); }
  function owns(id) {
    if (!access) return false;
    if (access.scope === 'ALL') return true;
    if (id === 'lampiran') return ['bab1', 'bab2', 'bab3', 'bab4', 'bab5', 'bab6'].every(function (b) { return access.scope.indexOf(b) > -1; });
    return access.scope.indexOf(id) > -1;
  }
  function partState(p) {           // 'free' | 'open' | 'preview' | 'locked'
    if (!p.file || FREE_FILES.indexOf(p.file) > -1) return 'free';
    if (owns(p.file)) return 'open';
    var c = CH[p.file];
    if (c && S.freeEntries >= c.first) return 'preview';
    return 'locked';
  }
  function entryOpen(n) { return n <= S.freeEntries || owns(chapterOf(n).id); }
  function loadFile(f) {
    if (fileCache[f]) return Promise.resolve(fileCache[f]);
    return call('getFile', { name: f }).then(function (r) { fileCache[f] = r; return r; });
  }
  function loadSearch() {
    if (searchIndex) return Promise.resolve(searchIndex);
    return loadFile('search').then(function (r) { searchIndex = JSON.parse(r.html); return searchIndex; });
  }
  function chapterOf(n) {
    for (var i = 0; i < M.chapters.length; i++) { var c = M.chapters[i]; if (n >= c.first && n <= c.last) return c; }
    return M.chapters[0];
  }

  /* ---------- Utilitas ---------- */
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function icon(id, cls) { return '<svg' + (cls ? ' class="' + cls + '"' : '') + '><use href="#i-' + id + '"/></svg>'; }
  function norm(s) { return String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[“”"'’‘]/g, '').replace(/\s+/g, ' ').trim(); }
  function rp(n) { return 'Rp' + Number(n || 0).toLocaleString('id-ID'); }
  function waLink(num, text) { return 'https://wa.me/' + String(num || '').replace(/\D/g, '').replace(/^0/, '62') + '?text=' + encodeURIComponent(text); }
  function toast(msg, ic) {
    var t = document.createElement('div'); t.className = 'toast';
    t.innerHTML = icon(ic || 'info') + '<span></span>'; t.lastChild.textContent = msg;
    $('#toasts').appendChild(t);
    setTimeout(function () { t.classList.add('out'); setTimeout(function () { t.remove(); }, 320); }, 2800);
  }
  var lastToastAt = 0;
  function softToast(msg, ic) { if (Date.now() - lastToastAt > 2500) { lastToastAt = Date.now(); toast(msg, ic); } }
  function isField(el) { return el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable); }
  function adminOpen() { return body.classList.contains('admin-open'); }
  function copyText(t) {
    if (navigator.clipboard && navigator.clipboard.writeText) return navigator.clipboard.writeText(t).then(function () { toast('Tersalin: ' + t, 'copy'); }, function () { toast('Salin manual: ' + t, 'copy'); });
    toast('Salin manual: ' + t, 'copy'); return Promise.resolve();
  }
  function confetti() {
    var box = document.createElement('div'); box.className = 'confetti';
    var cols = ['#0d9488', '#f59e0b', '#e11d48', '#4f46e5', '#22c55e', '#06b6d4'];
    for (var i = 0; i < 80; i++) {
      var c = document.createElement('i');
      c.style.left = Math.random() * 100 + '%'; c.style.background = cols[i % cols.length];
      c.style.animationDelay = (Math.random() * .6) + 's'; c.style.transform = 'rotate(' + (Math.random() * 360) + 'deg)';
      box.appendChild(c);
    }
    body.appendChild(box); setTimeout(function () { box.remove(); }, 3600);
  }

  /* =====================================================
     TEMA, MODE BACA, LAYAR PENUH, ATUR ULANG
     ===================================================== */
  function applyPrefs() {
    html.setAttribute('data-theme', prefs.theme);
    html.classList.toggle('sepia', !!prefs.sepia);
    body.classList.toggle('wide', !!prefs.wide);
    html.style.setProperty('--read-scale', prefs.scale);
    $('#themeToggle').checked = prefs.theme === 'dark';
    $('#rbSize').textContent = Math.round(prefs.scale * 100) + '%';
    var meta = document.querySelector('meta[name=theme-color]'); if (meta) meta.content = prefs.theme === 'dark' ? '#0a1213' : '#0f4c4a';
    $$('[data-rb=sepia]').forEach(function (b) { b.classList.toggle('on', !!prefs.sepia); });
    $$('[data-rb=wide]').forEach(function (b) { b.classList.toggle('on', !!prefs.wide); });
  }
  function setTheme(dark, origin) {
    var go_ = function () { prefs.theme = dark ? 'dark' : 'light'; savePrefs(); applyPrefs(); };
    var reduce = window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (document.startViewTransition && !reduce) {
      var r = origin ? origin.getBoundingClientRect() : { left: innerWidth / 2, top: 0, width: 0, height: 0 };
      var x = r.left + r.width / 2, y = r.top + r.height / 2;
      var rad = Math.hypot(Math.max(x, innerWidth - x), Math.max(y, innerHeight - y));
      var vt = document.startViewTransition(go_);
      vt.ready.then(function () {
        html.animate({ clipPath: ['circle(0 at ' + x + 'px ' + y + 'px)', 'circle(' + rad + 'px at ' + x + 'px ' + y + 'px)'] },
          { duration: 650, easing: 'cubic-bezier(.2,.8,.2,1)', pseudoElement: '::view-transition-new(root)' });
      }).catch(function () {});
    } else { body.classList.add('theming'); go_(); setTimeout(function () { body.classList.remove('theming'); }, 500); }
  }
  $('#themeToggle').addEventListener('change', function (e) { setTheme(e.target.checked, e.target.parentNode); });

  function topVisible() {
    var els = $$('#view .entry'), y = (body.classList.contains('reading') ? 0 : 70);
    if (!els.length) els = $$('#view .sub, #view .sec, #view .prose > *');
    for (var i = 0; i < els.length; i++) { var r = els[i].getBoundingClientRect(); if (r.bottom > y + 10) return els[i]; }
    return null;
  }
  function setReading(on) {
    var keep = topVisible();
    body.classList.toggle('reading', on);
    if (keep) setTimeout(function () { keep.scrollIntoView({ block: 'start' }); }, 450);
    $('#btnRead').classList.toggle('on', on);
    body.classList.remove('nav-open');
    if (on) toast('Mode baca aktif. Tekan Esc untuk keluar.', 'read');
  }
  $('#btnRead').addEventListener('click', function () { setReading(!body.classList.contains('reading')); });
  $('#readingBar').addEventListener('click', function (e) {
    var b = e.target.closest('[data-rb]'); if (!b) return;
    var a = b.getAttribute('data-rb');
    if (a === 'smaller') prefs.scale = Math.max(.85, +(prefs.scale - .05).toFixed(2));
    if (a === 'bigger') prefs.scale = Math.min(1.5, +(prefs.scale + .05).toFixed(2));
    if (a === 'sepia') prefs.sepia = !prefs.sepia;
    if (a === 'wide') prefs.wide = !prefs.wide;
    if (a === 'exit') return setReading(false);
    savePrefs(); applyPrefs();
  });

  function fsElement() { return document.fullscreenElement || document.webkitFullscreenElement; }
  function toggleFull() {
    var el = document.documentElement;
    try {
      if (fsElement()) { (document.exitFullscreen || document.webkitExitFullscreen).call(document); return; }
      var req = el.requestFullscreen || el.webkitRequestFullscreen;
      if (!req || document.fullscreenEnabled === false) throw new Error('nofs');
      var p = req.call(el); if (p && p.catch) p.catch(fallbackFull);
    } catch (e) { fallbackFull(); }
  }
  function fallbackFull() { setReading(true); softToast('Layar penuh dibatasi oleh peramban; mode baca diaktifkan sebagai gantinya.', 'max'); }
  ['fullscreenchange', 'webkitfullscreenchange'].forEach(function (ev) {
    document.addEventListener(ev, function () {
      var on = !!fsElement();
      $$('#btnFull use, #btnFull2 use').forEach(function (u) { u.setAttribute('href', on ? '#i-min' : '#i-max'); });
    });
  });
  $('#btnFull').addEventListener('click', toggleFull);
  $('#btnFull2').addEventListener('click', toggleFull);

  function confirmReset() {
    modal('<h3>Atur ulang?</h3><p>Preferensi tampilan, tanda “sudah paham”, entri tersimpan, dan jawaban latihan di perangkat ini akan dihapus. <b>Kode akses Anda tetap tersimpan.</b></p>' +
      '<div class="modal-actions"><button class="btn btn-line" data-close>Batal</button><button class="btn btn-danger" id="doReset">' + icon('reset') + ' Atur ulang</button></div>');
    $('#doReset').addEventListener('click', function () {
      var keepDev = device, keepAcc = access; store.clear(); store.set('device', keepDev); if (keepAcc) store.set('access', keepAcc);
      prefs = { theme: prefersDark ? 'dark' : 'light', scale: 1, sepia: false, wide: false };
      prog = { read: [], marks: [], last: null };
      closeModal(); setReading(false); applyPrefs(); buildNav(); renderMarks(); go('home');
      toast('Pengaturan telah diatur ulang.', 'reset');
    });
  }
  $('#btnReset').addEventListener('click', confirmReset);
  $('#btnReset2').addEventListener('click', confirmReset);

  /* ---------- Modal ---------- */
  function modal(inner, wide) {
    var c = $('#modalCard'); c.className = 'modal-card' + (wide ? ' wide' : ''); c.innerHTML = '<div class="mc">' + inner + '</div>'; $('#modal').hidden = false;
    var f = $('input, button', c); if (f && f.tagName === 'INPUT' && !window.matchMedia('(pointer: coarse)').matches) setTimeout(function () { f.focus(); }, 60);
    return c.firstChild;
  }
  function closeModal() { $('#modal').hidden = true; }
  $('#modal').addEventListener('click', function (e) { if (e.target.id === 'modal' || e.target.closest('[data-close]')) closeModal(); });
  $('#btnKeys').addEventListener('click', showKeys);
  function showKeys() {
    modal('<h3>Pintasan papan ketik</h3><div class="keys">' +
      [['/', 'Cari entri'], ['R', 'Mode baca'], ['T', 'Terang / gelap'], ['F', 'Layar penuh'], ['N / P', 'Bagian berikutnya / sebelumnya'], ['A', 'Entri acak'], ['D', 'Buka ruang diskusi'], ['Esc', 'Tutup panel / keluar mode baca'], ['?', 'Tampilkan bantuan ini']]
        .map(function (k) { return '<kbd>' + k[0] + '</kbd><span>' + k[1] + '</span>'; }).join('') +
      '</div><div class="modal-actions"><button class="btn btn-primary" data-close>Mengerti</button></div>');
  }

  /* =====================================================
     JAM DIGITAL + INFO
     ===================================================== */
  var DAYS = new Intl.DateTimeFormat('id-ID', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
  var SHORT = new Intl.DateTimeFormat('id-ID', { weekday: 'short', day: 'numeric', month: 'short' });
  function tzLabel(d) { var off = -d.getTimezoneOffset() / 60; return off === 7 ? 'WIB' : off === 8 ? 'WITA' : off === 9 ? 'WIT' : 'GMT' + (off >= 0 ? '+' : '') + off; }
  function greet(h) { return h < 4 ? 'Selamat malam' : h < 11 ? 'Selamat pagi' : h < 15 ? 'Selamat siang' : h < 18 ? 'Selamat sore' : 'Selamat malam'; }
  function pad(n) { return (n < 10 ? '0' : '') + n; }
  function tick() {
    var d = new Date();
    $('#clkHM').textContent = pad(d.getHours()) + ':' + pad(d.getMinutes());
    $('#clkS').textContent = pad(d.getSeconds());
    $('#clkTZ').textContent = tzLabel(d);
    $('#clkDate').textContent = SHORT.format(d);
    if (!$('#clockPop').hidden) renderClockPop();
  }
  function accessLabel() {
    if (!access) return 'Akses gratis';
    if (access.scope === 'ALL') return 'Semua bab terbuka';
    return 'Bab ' + access.scope.map(chNum).sort(function (a, b) { return a - b; }).join(', ') + ' terbuka';
  }
  function renderClockPop() {
    var d = new Date(), mins = Math.floor((Date.now() - sessionStart) / 60000);
    var pct = Math.round(prog.read.length / M.stats.entries * 100);
    $('#clockPop').innerHTML =
      '<div class="pop-greet">' + greet(d.getHours()) + ', pembaca!</div>' +
      '<div class="pop-time">' + pad(d.getHours()) + ':' + pad(d.getMinutes()) + '<small>:' + pad(d.getSeconds()) + '</small></div>' +
      '<div class="pop-date">' + DAYS.format(d) + ' · ' + tzLabel(d) + '</div>' +
      '<div class="pop-grid">' +
      '<div class="pop-stat"><b>' + pct + '%</b><span>progres pemahaman</span></div>' +
      '<div class="pop-stat"><b>' + prog.read.length + '/' + M.stats.entries + '</b><span>entri dipahami</span></div>' +
      '<div class="pop-stat"><b>' + prog.marks.length + '</b><span>entri tersimpan</span></div>' +
      '<div class="pop-stat"><b>' + mins + ' mnt</b><span>sesi baca ini</span></div></div>' +
      '<div class="pop-stat" style="margin-top:8px"><b style="font-size:1rem">' + esc(accessLabel()) + '</b><span>status akses perangkat ini</span></div>';
  }
  $('#clock').addEventListener('click', function (e) { e.stopPropagation(); var p = $('#clockPop'); p.hidden = !p.hidden; if (!p.hidden) renderClockPop(); });
  document.addEventListener('click', function (e) { if (!e.target.closest('#clockPop') && !e.target.closest('#clock')) $('#clockPop').hidden = true; });
  setInterval(tick, 1000); tick();

  /* =====================================================
     NAVIGASI SAMPING
     ===================================================== */
  function chapterProgress(c) { var n = 0; prog.read.forEach(function (x) { if (x >= c.first && x <= c.last) n++; }); return n; }
  function buildNav() {
    var out = '', group = null;
    PARTS.forEach(function (p) {
      if (p.group !== group) { group = p.group; out += '<div class="nav-group">' + esc(group) + '</div>'; }
      var st = partState(p), hasSub = p.sections && p.sections.length;
      var ch = p.ch ? M.chapters.filter(function (c) { return c.n === p.ch; })[0] : null;
      var bar = ch ? '<span class="ni-bar"><i style="width:' + (chapterProgress(ch) / ch.count * 100) + '%"></i></span>' : '';
      var tag = st === 'locked' ? '<span class="tag tag-lock">' + 'Terkunci</span>' : st === 'preview' ? '<span class="tag tag-free">Cuplikan</span>' : '';
      out += '<button class="nav-item" data-go="' + p.id + '"' + (p.ch ? ' data-ch="' + p.ch + '"' : '') + '>' +
        '<span class="ni-ic">' + icon(st === 'locked' ? 'lock' : (p.icon || 'bookA')) + '</span><span class="ni-t">' + esc(p.title) + tag + bar + '</span>' +
        (hasSub ? icon('right', 'chev') : '') + '</button>';
      if (hasSub) out += '<div class="nav-sub" data-sub="' + p.id + '">' + p.sections.map(function (s) { return '<button data-go="' + p.id + '" data-anchor="' + s.id + '">' + esc(s.title) + '</button>'; }).join('') + '</div>';
    });
    $('#nav').innerHTML = '<button class="nav-item" data-go="home"><span class="ni-ic">' + icon('home') + '</span><span class="ni-t">Beranda</span></button>' + out;
    renderSideProgress(); renderSideAccess(); markActiveNav();
  }
  function renderSideProgress() {
    var pct = prog.read.length / M.stats.entries, C = 2 * Math.PI * 24;
    $('#sideProgress').innerHTML = '<div class="ring"><svg viewBox="0 0 58 58"><circle class="bg" cx="29" cy="29" r="24"/><circle class="fg" cx="29" cy="29" r="24" stroke-dasharray="' + C + '" stroke-dashoffset="' + (C * (1 - pct)) + '"/></svg><b>' + Math.round(pct * 100) + '%</b></div>' +
      '<div><div class="t1">Progres Anda</div><div class="t2">' + prog.read.length + ' dari ' + M.stats.entries + ' entri sudah dipahami</div></div>';
  }
  function renderSideAccess() {
    var full = access && access.scope === 'ALL';
    $('#sideAccess').innerHTML = icon(full ? 'unlock' : 'ticket') + '<div class="sa-t"><b>' + esc(accessLabel()) + '</b>' +
      (full ? 'Terima kasih telah mendukung karya ini.' : 'Buka bab lain mulai ' + rp(S.priceChapter) + '.') + '</div>' +
      (full ? '<button class="btn btn-soft btn-sm" data-open="mycode">Kode</button>' : '<button class="btn btn-primary btn-sm" data-open="buy">Buka</button>');
  }
  function markActiveNav() {
    $$('#nav .nav-item').forEach(function (b) { var on = b.getAttribute('data-go') === current.id; b.classList.toggle('active', on); b.classList.toggle('open', on); });
    $$('#nav .nav-sub').forEach(function (s) { s.classList.toggle('open', s.getAttribute('data-sub') === current.id); });
  }
  function renderMarks() {
    var box = $('#marks');
    if (!prog.marks.length) { box.innerHTML = '<div class="empty">Belum ada. Ketuk “Simpan” pada entri.</div>'; return; }
    var draw = function () {
      box.innerHTML = prog.marks.slice().sort(function (a, b) { return a - b; }).map(function (n) {
        var e = searchIndex && searchIndex.filter(function (x) { return x[0] === n; })[0];
        return '<button data-entry="' + n + '"><b>' + n + '.</b> ' + esc(e ? e[1] : 'Entri ' + n) + '</button>';
      }).join('');
    };
    loadSearch().then(draw, draw);
  }
  document.addEventListener('click', function (e) {
    if (adminOpen() && !e.target.closest('#modal')) return;
    var g = e.target.closest('[data-go]');
    if (g) { e.preventDefault(); go(g.getAttribute('data-go'), g.getAttribute('data-anchor')); return; }
    var en = e.target.closest('[data-entry]');
    if (en) { e.preventDefault(); goEntry(+en.getAttribute('data-entry')); return; }
    var op = e.target.closest('[data-open]');
    if (op) { e.preventDefault(); var w = op.getAttribute('data-open'); if (w === 'buy') openBuy(op.getAttribute('data-pre')); else if (w === 'code') openRedeem(); else if (w === 'mycode') openMyCode(); }
  });
  $('#btnMenu').addEventListener('click', function () { body.classList.toggle('nav-open'); });
  $('#scrim').addEventListener('click', function () { body.classList.remove('nav-open'); });

  /* =====================================================
     ROUTER & RENDER
     ===================================================== */
  var current = { id: null };
  function go(id, anchor, opts) {
    opts = opts || {};
    if (!PART[id] && id !== 'home') id = 'home';
    body.classList.remove('nav-open', 'search-open'); closeResults(); closeModal();
    var view = $('#view'), sameView = current.id === id && view.firstChild && !opts.force;
    current = { id: id }; markActiveNav();
    if (!opts.noHash) { try { history.replaceState(null, '', '#' + id); } catch (e) {} }
    if (id !== 'home') { prog.last = { id: id, anchor: anchor || null }; saveProg(); }
    if (sameView) { scrollToAnchor(anchor, opts.flash); return Promise.resolve(); }
    if (id === 'home') { render(homeHTML()); afterHome(); window.scrollTo(0, 0); return Promise.resolve(); }
    if (id === 'indeks') { render(loaderHTML('Menyiapkan indeks…')); return loadSearch().then(function () { render(indexHTML()); decorate(); scrollToAnchor(anchor); }, loadFail(id)); }
    if (id === 'info') { render(infoHTML()); decorate(); window.scrollTo(0, 0); return Promise.resolve(); }
    var p = PART[id];
    if (partState(p) === 'locked') { render(loaderHTML('Memuat ' + p.title + '…')); return loadSearch().then(function () { render(lockedHTML(p)); decorate(); window.scrollTo(0, 0); }, function () { render(lockedHTML(p)); }); }
    render('<div class="skel h"></div><div class="skel"></div><div class="skel" style="width:80%"></div>' + loaderHTML('Memuat ' + p.title + '…'));
    window.scrollTo(0, 0);
    return loadFile(p.file).then(function (r) {
      if (current.id !== id) return;
      if (r.locked) { delete fileCache[p.file]; return loadSearch().then(function () { render(lockedHTML(p)); decorate(); }); }
      var tpl = document.createElement('template'); tpl.innerHTML = r.html;
      var node = tpl.content.querySelector('[data-part="' + id + '"]');
      render(node ? node.outerHTML + partEnd(p) : '<p>Bagian tidak ditemukan.</p>');
      var cut = $('#view .paywall-cut'); if (cut) cut.outerHTML = paywallHTML(p.file, +cut.getAttribute('data-next'));
      decorate(); scrollToAnchor(anchor, opts.flash);
    }, loadFail(id));
  }
  function loaderHTML(t) { return '<div class="loader">' + icon('pulse') + esc(t) + '</div>'; }
  function loadFail(id) {
    return function (err) {
      render('<div class="loader">' + icon('info') + esc(err && err.message || 'Gagal memuat.') + '<button class="btn btn-soft" data-go="' + id + '">Coba lagi</button></div>');
      current.id = null;
    };
  }
  function render(h) { var v = $('#view'); v.classList.remove('enter'); v.innerHTML = h; void v.offsetWidth; v.classList.add('enter'); }
  function scrollToAnchor(anchor, flash) {
    if (!anchor) { window.scrollTo({ top: 0, behavior: 'smooth' }); return; }
    var el = document.getElementById(anchor);
    if (!el) { var pw = $('#view .paywall'); if (pw && /^e-/.test(anchor)) { setTimeout(function () { pw.scrollIntoView({ behavior: 'smooth', block: 'center' }); }, 60); } return; }
    setTimeout(function () {
      el.scrollIntoView({ behavior: 'smooth', block: 'start' });
      if (flash && el.classList.contains('entry')) { el.classList.remove('flash'); void el.offsetWidth; el.classList.add('flash'); }
    }, 60);
  }
  function goEntry(n) { return go(chapterOf(n).id, 'e-' + n, { flash: true }); }
  function partEnd(p) {
    var prev = PARTS[p.index - 1], next = PARTS[p.index + 1];
    return '<div class="discuss-cta reveal"><div><b>Ada yang ingin ditanyakan tentang bagian ini?</b><span>Tinggalkan komentar atau ajukan pertanyaan langsung kepada penulis.</span></div>' +
      '<button class="btn btn-primary" data-talk="' + p.id + '" data-label="' + esc(p.title) + '">' + icon('messages') + ' Diskusikan <span class="cnt" data-count="' + p.id + '"></span></button></div>' +
      '<nav class="part-end">' +
      (prev ? '<button class="pn" data-go="' + prev.id + '"><small>‹ Sebelumnya</small><b>' + esc(prev.title) + '</b></button>' : '<span></span>') +
      (next ? '<button class="pn next" data-go="' + next.id + '"><small>Berikutnya ›</small><b>' + esc(next.title) + '</b></button>' : '') + '</nav>';
  }

  /* ---------- Paywall ---------- */
  function paywallHTML(chId, nextEntry) {
    var full = chId === 'lampiran';
    var title = full ? 'Lampiran ini untuk pemegang akses semua bab' : nextEntry ? 'Cuplikan gratis berakhir di sini' : 'Bab ini masih terkunci';
    var txt = full ? 'Kunci jawaban seluruh Uji Diri terbuka setelah Anda membuka paket semua bab.'
      : nextEntry ? 'Anda sudah membaca ' + (nextEntry - 1) + ' entri pertama secara gratis. Lanjutkan membaca entri ' + nextEntry + ' dan seterusnya dengan membuka akses bab ini.'
      : 'Dukung karya ini untuk membaca ' + esc(chTitle(chId)) + ' secara lengkap, termasuk penjelasan linguistik, catatan nuansa, rangkuman, dan Uji Diri.';
    return '<div class="paywall reveal"><div class="pw-ic">' + icon('lock') + '</div><h3>' + title + '</h3><p>' + txt + '</p>' +
      '<div class="pw-price"><span>Per bab <b>' + rp(S.priceChapter) + '</b></span><span>Semua bab <b>' + rp(S.priceAll) + '</b></span></div>' +
      '<div class="pw-actions"><button class="btn btn-primary" data-open="buy" data-pre="' + (full ? 'ALL' : chId) + '">' + icon('qr') + ' Buka dengan QRIS</button>' +
      '<button class="btn btn-line" data-open="code">' + icon('ticket') + ' Saya punya kode</button></div></div>';
  }
  function lockedHTML(p) {
    var ch = CH[p.file], n = p.ch || 0;
    var head = n ? '<header class="ch-hero" data-ch="' + n + '"><div class="ch-pattern"></div><div class="ch-kicker">Bab ' + n + ' · Terkunci</div><h1 class="ch-title">' + esc(chTitle(p.file)) + '</h1><p class="ch-en">' + esc(ch ? ch.en : 'The Surgery Test') + '</p></header>'
      : '<header class="pg-hero"><div class="pg-kicker">Terkunci</div><h1 class="pg-title">' + esc(p.title) + '</h1></header>';
    var tz = '';
    if (ch && searchIndex) {
      tz = '<div class="teaser">' + (p.sections || []).map(function (sec) {
        return '<h2 class="sec-h">' + esc(sec.title) + '</h2>' + (sec.subs || []).map(function (sb) {
          var num = sb.title.split(' ')[0], items = searchIndex.filter(function (e) { return e[3] === p.file && subOf(e[0]) === num; });
          return '<h3 class="sub-h">' + esc(sb.title) + '</h3><div class="tz-list">' + items.map(function (e) {
            return '<div class="tz-item"><b>' + e[0] + '</b><span>' + esc(e[1]) + '</span>' + icon('lock') + '</div>';
          }).join('') + '</div>';
        }).join('');
      }).join('') + '</div>';
    }
    return '<div class="part">' + head + (ch ? '<div class="prose"><p>' + esc(ch.intro) + '…</p></div>' : '') + paywallHTML(p.file) + tz + '</div>' + partEnd(p);
  }
  var SUBMAP = null;
  function subOf(n) {
    if (!SUBMAP) { SUBMAP = {}; (M.subRanges || []).forEach(function (r) { for (var i = r[1]; i <= r[2]; i++) SUBMAP[i] = r[0]; }); }
    return SUBMAP[n];
  }

  /* ---------- Beranda ---------- */
  function homeHTML() {
    var last = prog.last && PART[prog.last.id];
    var s = '<section class="hero reveal in"><span class="orb o1"></span><span class="orb o2"></span>' +
      '<svg class="ecg" viewBox="0 0 1000 70" preserveAspectRatio="none"><path d="M0 40 H260 l18 -26 22 52 18 -40 14 14 H560 l16 -22 20 44 16 -34 12 12 H1000"/></svg>' +
      '<span class="hero-kicker">' + icon('pulse') + ' Buku Analisis Kesalahan Berbahasa</span>' +
      '<h1>' + esc(S.title) + '</h1><p class="sub">' + esc(S.subtitle) + '</p><p class="by">oleh ' + esc(S.author) + '</p>' +
      '<div class="hero-actions">' +
      (last ? '<button class="btn btn-primary" data-go="' + last.id + '"' + (prog.last.anchor ? ' data-anchor="' + prog.last.anchor + '"' : '') + '>' + icon('read') + ' Lanjutkan membaca</button>'
            : '<button class="btn btn-primary" data-go="pendahuluan">' + icon('read') + ' Mulai Membaca Gratis</button>') +
      (access && access.scope === 'ALL' ? '' : '<button class="btn btn-ghost" data-open="buy">' + icon('unlock') + ' Buka Semua Bab</button>') +
      '<button class="btn btn-ghost" id="heroRandom">' + icon('shuffle') + ' Entri Acak</button></div></section>';
    s += '<div class="stats">' + [[M.stats.entries, 'entri kesalahan dibedah'], [M.stats.chapters, 'bab tematik + uji kompetensi'], [M.stats.terms, 'istilah di glosarium'], [M.stats.refs, 'rujukan ilmiah']]
      .map(function (x) { return '<div class="stat reveal"><b data-count-up="' + x[0] + '">0</b><span>' + x[1] + '</span></div>'; }).join('') + '</div>';
    s += '<div class="daily reveal" id="daily"><div class="d-badge">…</div><div><div class="d-k">' + icon('spark') + ' Entri Hari Ini</div><div class="d-t">Memuat…</div></div></div>';
    s += '<h2 class="h-sec reveal">Daftar Bab</h2><p class="h-sec-sub reveal">Pendahuluan dan ' + S.freeEntries + ' entri pertama bisa dibaca gratis. Bab lainnya terbuka setelah donasi.</p><div class="cards">';
    M.chapters.forEach(function (c) {
      var done = chapterProgress(c), st = partState(PART[c.id]);
      s += '<button class="card reveal" data-ch="' + c.n + '" data-go="' + c.id + '"><span class="c-ic">' + icon(st === 'locked' ? 'lock' : c.icon) + '</span>' +
        '<span class="c-k">Bab ' + c.n + ' · Entri ' + c.first + '–' + c.last + (st === 'preview' ? ' · Cuplikan gratis' : st === 'open' ? ' · Terbuka' : '') + '</span><span class="c-t">' + esc(c.title) + '</span>' +
        '<span class="c-d">' + esc(c.intro) + '…</span><span class="c-f"><span>' + done + '/' + c.count + ' dipahami</span><span>' + icon('right') + '</span></span>' +
        '<span class="c-bar"><i data-w="' + (done / c.count * 100) + '"></i></span></button>';
    });
    var st7 = partState(PART.bab7);
    s += '<button class="card reveal" data-ch="7" data-go="bab7"><span class="c-ic">' + icon(st7 === 'locked' ? 'lock' : 'target') + '</span><span class="c-k">Bab 7 · The Surgery Test</span><span class="c-t">Uji Kompetensi Terpadu</span><span class="c-d">Latihan bertingkat dari kalimat hingga paragraf, lengkap dengan kunci jawaban dan rubrik penilaian.</span><span class="c-f"><span>4 bagian</span><span>' + icon('right') + '</span></span></button></div>';
    if (!(access && access.scope === 'ALL')) {
      s += '<h2 class="h-sec reveal" id="harga">Dukung Karya Ini</h2><p class="h-sec-sub reveal">Bayar dengan QRIS dari aplikasi bank atau dompet digital apa pun, lalu konfirmasi lewat WhatsApp untuk menerima kode akses.</p>' +
        '<div class="pricing"><div class="price-card reveal"><span class="pc-t">Per Bab</span><span class="pc-p">' + rp(S.priceChapter) + ' <small>/ bab</small></span><ul><li>Pilih bab yang Anda butuhkan</li><li>Bisa ditambah kapan saja</li><li>Akses di ' + S.maxDevices + ' perangkat</li></ul><button class="btn btn-line" data-open="buy" data-pre="pick">' + icon('qr') + ' Pilih bab</button></div>' +
        '<div class="price-card best reveal"><span class="ribbon">Paling hemat</span><span class="pc-t">Semua Bab</span><span class="pc-p">' + rp(S.priceAll) + '</span><ul><li>Bab 1–7, 360 entri lengkap</li><li>Kunci jawaban Uji Diri & Bab 7</li><li>Hemat ' + rp(Math.max(0, S.priceChapter * 7 - S.priceAll)) + ' dibanding per bab</li></ul><button class="btn btn-primary" data-open="buy" data-pre="ALL">' + icon('unlock') + ' Buka semua bab</button></div></div>' +
        '<p class="price-note">' + icon('ticket') + ' Sudah punya kode akses? <button class="btn btn-soft btn-sm" data-open="code">Masukkan kode</button></p>';
    }
    s += '<h2 class="h-sec reveal">Cara Menikmati Situs Ini</h2><div class="features">' +
      '<div class="feat reveal">' + icon('read') + '<b>Mode baca</b><span>Tampilan bersih tanpa gangguan, huruf dapat diperbesar, tersedia warna kertas.</span></div>' +
      '<div class="feat reveal">' + icon('search') + '<b>Cari cepat</b><span>Ketik kata seperti “discuss about” atau nomor entri. Tekan / untuk mulai.</span></div>' +
      '<div class="feat reveal">' + icon('messages') + '<b>Tanya penulis</b><span>Setiap entri punya ruang diskusi; pertanyaan Anda bisa dijawab langsung oleh penulis.</span></div></div>';
    return s;
  }
  function afterHome() {
    observeReveal();
    $$('[data-count-up]').forEach(countUp);
    setTimeout(function () { $$('.c-bar i').forEach(function (i) { i.style.width = i.getAttribute('data-w') + '%'; }); }, 200);
    $('#heroRandom').addEventListener('click', randomEntry);
    loadSearch().then(function (idx) {
      var d = new Date(), seed = d.getFullYear() * 1000 + Math.floor((d - new Date(d.getFullYear(), 0, 0)) / 864e5);
      var e = idx[(seed * 7919) % idx.length], box = $('#daily'); if (!box) return;
      var open = e[4] && entryOpen(e[0]);
      box.innerHTML = '<div class="d-badge">' + e[0] + '</div><div><div class="d-k">Entri Hari Ini</div><div class="d-t">' + esc(e[1]) + '</div>' +
        (open ? '<div class="d-e"><s>' + esc(e[4]) + '</s><br><ins>' + esc(e[5]) + '</ins></div>' : '<div class="d-e">' + esc(e[2]) + '</div>') +
        '<button class="btn btn-soft" style="margin-top:10px" data-entry="' + e[0] + '">' + icon(open ? 'right' : 'lock') + (open ? ' Baca penjelasannya' : ' Buka entri ini') + '</button></div>';
    }).catch(function () { var b = $('#daily'); if (b) b.remove(); });
  }
  function countUp(el) {
    var to = +el.getAttribute('data-count-up'), t0 = performance.now(), dur = 1200;
    (function step(t) { var k = Math.min(1, (t - t0) / dur); el.textContent = Math.round(to * (1 - Math.pow(1 - k, 3))); if (k < 1) requestAnimationFrame(step); })(t0);
  }

  /* ---------- Indeks & Info buku ---------- */
  function indexHTML() {
    var items = searchIndex.map(function (e) {
      var m = e[1].match(/"([^"]+)"/); return { k: (m ? m[1] : e[1].replace(/^The\s+|\s+Error.*$/g, '')).trim(), n: e[0] };
    }).sort(function (a, b) { return norm(a.k).replace(/[^a-z0-9 ]/g, '').localeCompare(norm(b.k).replace(/[^a-z0-9 ]/g, '')); });
    var groups = {};
    items.forEach(function (it) { var L = (norm(it.k).replace(/[^a-z]/g, '')[0] || '#').toUpperCase(); (groups[L] = groups[L] || []).push(it); });
    var letters = Object.keys(groups).sort();
    var s = '<div class="part"><header class="pg-hero"><div class="pg-kicker">Rujukan</div><h1 class="pg-title">Indeks Kesalahan</h1><p class="pg-sub">Kata kunci setiap entri, disusun menurut abjad. Angka adalah nomor entri; ikon gembok menandai entri yang belum terbuka.</p></header>' +
      '<div class="az">' + letters.map(function (L) { return '<button data-az="' + L + '">' + L + '</button>'; }).join('') + '</div>';
    letters.forEach(function (L) {
      s += '<div class="idx-letter" id="idx-' + L + '">' + L + '</div><div class="idx-grid">' +
        groups[L].map(function (it) { return '<button data-entry="' + it.n + '">' + esc(it.k) + '<span>' + (entryOpen(it.n) ? '' : icon('lock', 'lock-ic') + ' ') + it.n + '</span></button>'; }).join('') + '</div>';
    });
    return s + '</div>' + partEnd(PART.indeks);
  }
  document.addEventListener('click', function (e) { var b = e.target.closest('[data-az]'); if (b) { var t = document.getElementById('idx-' + b.getAttribute('data-az')); if (t) t.scrollIntoView({ behavior: 'smooth' }); } });
  function infoHTML() {
    var rows = [['Judul', S.title], ['Subjudul', S.subtitle], ['Penulis', S.author], ['Penerbit', S.publisher], ['Kota terbit', S.city], ['Tahun terbit', S.year],
      ['Edisi', S.edition], ['ISBN', S.isbn], ['Ukuran', S.size], ['Jumlah halaman', S.pages], ['Kontak', S.email]].filter(function (r) { return r[1]; });
    return '<div class="part"><header class="pg-hero"><div class="pg-kicker">Tentang Buku</div><h1 class="pg-title">Info Buku</h1><p class="pg-sub">Data terbitan resmi.</p></header>' +
      '<div class="book-mock"><div class="book3d"><em>' + esc(S.author) + '</em><b>' + esc(S.title) + '</b><small>' + esc(S.subtitle) + '</small></div>' +
      '<div class="prose" style="flex:1;min-width:240px"><p>' + esc(S.title) + ' membedah 360 kesalahan tata bahasa Inggris yang paling sering dilakukan pembelajar Indonesia, lengkap dengan penjelasan linguistik mengapa kesalahan itu terjadi.</p>' +
      '<p class="hint">Seluruh isi dilindungi Undang-Undang Nomor 28 Tahun 2014 tentang Hak Cipta. Dilarang memperbanyak sebagian atau seluruh isi tanpa izin tertulis.</p></div></div>' +
      '<dl class="colophon">' + rows.map(function (r) { return '<dt>' + r[0] + '</dt><dd>' + esc(r[1]) + '</dd>'; }).join('') + '</dl></div>' + partEnd(PART.info);
  }

  /* ---------- Hiasan & interaksi di setiap bagian ---------- */
  function decorate() {
    var view = $('#view');
    $$('.entry', view).forEach(function (el) {
      var n = +el.getAttribute('data-n'), ch = chapterOf(n); el.setAttribute('data-ch', ch.n);
      var read = prog.read.indexOf(n) > -1, mk = prog.marks.indexOf(n) > -1;
      el.classList.toggle('is-read', read);
      var a = document.createElement('div'); a.className = 'entry-actions';
      a.innerHTML = '<button class="chip read' + (read ? ' on' : '') + '" data-act="read">' + icon('check') + '<span>' + (read ? 'Sudah paham' : 'Tandai paham') + '</span></button>' +
        '<button class="chip' + (mk ? ' on' : '') + '" data-act="mark">' + icon('mark') + '<span>' + (mk ? 'Tersimpan' : 'Simpan') + '</span></button>' +
        '<button class="chip" data-talk="e-' + n + '" data-label="Entri ' + n + ': ' + esc($('.entry-title', el).textContent) + '">' + icon('msg') + '<span>Diskusi</span><span class="cnt" data-count="e-' + n + '"></span></button>';
      el.appendChild(a); el.classList.add('reveal');
    });
    $$('.sec, .goals, .pg-hero, .ch-hero, .quiz-list li, .gl-item, .tz-item', view).forEach(function (el) { el.classList.add('reveal'); });
    $$('.scratch', view).forEach(function (t) { var k = 'scratch_' + t.getAttribute('data-key'); t.value = store.get(k, ''); t.addEventListener('input', function () { store.set(k, t.value); }); });
    $$('.filter', view).forEach(function (f) {
      var sel = f.getAttribute('data-filter');
      f.addEventListener('input', function () { var q_ = norm(f.value); $$(sel, view).forEach(function (it) { it.style.display = !q_ || norm(it.textContent).indexOf(q_) > -1 ? '' : 'none'; }); });
    });
    paintCounts(); observeReveal();
  }
  $('#view').addEventListener('click', function (e) {
    var b = e.target.closest('[data-act]'); if (!b) return;
    var el = b.closest('.entry'), n = +el.getAttribute('data-n'), act = b.getAttribute('data-act');
    var list = act === 'read' ? prog.read : prog.marks, i = list.indexOf(n);
    if (i > -1) list.splice(i, 1); else list.push(n);
    var on = i === -1; saveProg();
    b.classList.toggle('on', on); b.classList.remove('pop-anim'); void b.offsetWidth; b.classList.add('pop-anim');
    if (act === 'read') { el.classList.toggle('is-read', on); b.querySelector('span').textContent = on ? 'Sudah paham' : 'Tandai paham'; buildNav(); if (on) celebrate(n); }
    else { b.querySelector('span').textContent = on ? 'Tersimpan' : 'Simpan'; renderMarks(); toast(on ? 'Entri ' + n + ' disimpan.' : 'Entri ' + n + ' dihapus dari simpanan.', 'mark'); }
  });
  function celebrate(n) {
    var c = chapterOf(n), done = chapterProgress(c);
    if (done === c.count) { toast('Luar biasa! Seluruh Bab ' + c.n + ' sudah Anda pahami. 🎉', 'spark'); confetti(); }
    else if (prog.read.length % 25 === 0) toast(prog.read.length + ' entri sudah dipahami. Terus semangat!', 'spark');
  }
  var io = 'IntersectionObserver' in window ? new IntersectionObserver(function (es) {
    es.forEach(function (en) { if (en.isIntersecting) { en.target.classList.add('in'); io.unobserve(en.target); } });
  }, { rootMargin: '0px 0px -8% 0px' }) : null;
  function observeReveal() { $$('.reveal:not(.in)').forEach(function (el) { if (io) io.observe(el); else el.classList.add('in'); }); }
  function randomEntry() {
    var pool = []; for (var i = 1; i <= M.stats.entries; i++) if (entryOpen(i)) pool.push(i);
    goEntry(pool[Math.floor(Math.random() * pool.length)] || 1);
  }
  $('#fabRandom').addEventListener('click', randomEntry);

  /* =====================================================
     PEMBAYARAN QRIS + KONFIRMASI WHATSAPP + KODE AKSES
     ===================================================== */
  var qrisSrc = null;
  function getQris() {
    if (S.qrisUrl) return Promise.resolve(S.qrisUrl);
    if (qrisSrc) return Promise.resolve(qrisSrc);
    if (ASSETS.qris) { qrisSrc = ASSETS.qris; return Promise.resolve(qrisSrc); }
    return call('asset', { name: 'qris' }).then(function (d) { qrisSrc = d; return d; });
  }
  function openBuy(pre) {
    var owned = function (id) { return owns(id); };
    var chs = CHIDS.map(function (id) {
      var o = owned(id);
      return '<label class="chk-ch' + (o ? ' owned' : '') + '"><input type="checkbox" value="' + id + '"' + (o ? ' disabled checked' : (pre === id ? ' checked' : '')) + '><span><b>Bab ' + chNum(id) + '</b> · ' + esc(chTitle(id)) + (o ? ' (sudah terbuka)' : '') + '</span></label>';
    }).join('');
    var allMode = pre === 'ALL' || !pre;
    var card = modal('<button class="ib x" data-close aria-label="Tutup">' + icon('x') + '</button><h3>Buka Akses Bab</h3><p>Tiga langkah singkat: pilih paket, bayar dengan QRIS, lalu konfirmasi ke admin lewat WhatsApp untuk menerima kode akses.</p>' +
      '<div class="steps">' +
      '<div class="step"><div class="step-h"><i>1</i> Pilih paket</div>' +
      '<label class="opt' + (allMode ? ' on' : '') + '"><input type="radio" name="pk" value="ALL"' + (allMode ? ' checked' : '') + '><span class="o-t"><b>Semua bab</b><small>Bab 1–7 + kunci jawaban, paling hemat</small></span><span class="o-p">' + rp(S.priceAll) + '</span></label>' +
      '<label class="opt' + (!allMode ? ' on' : '') + '"><input type="radio" name="pk" value="PICK"' + (!allMode ? ' checked' : '') + '><span class="o-t"><b>Pilih bab</b><small>' + rp(S.priceChapter) + ' per bab</small></span><span class="o-p" id="pickSum">—</span></label>' +
      '<div class="chips" id="chPick"' + (allMode ? ' hidden' : '') + '>' + chs + '</div>' +
      '<div class="total"><span>Total pembayaran</span><b id="payTotal">' + rp(S.priceAll) + '</b></div></div>' +
      '<div class="step"><div class="step-h"><i>2</i> Bayar dengan QRIS</div><div class="qris-wrap"><div id="qrisBox"><div class="skel qris-ph"></div></div>' +
      '<ol><li>Buka aplikasi m-banking atau dompet digital (GoPay, OVO, DANA, ShopeePay, LinkAja, dll.).</li><li>Pilih <b>Scan/Bayar QRIS</b>, arahkan ke kode di samping (atau ketuk untuk memperbesar).</li><li>Masukkan nominal <b id="payTotal2">' + rp(S.priceAll) + '</b> tepat, lalu bayar ke <b>' + esc(S.merchant) + '</b>.</li><li>Simpan tangkapan layar bukti pembayaran.</li></ol></div></div>' +
      '<div class="step"><div class="step-h"><i>3</i> Konfirmasi ke admin</div>' +
      '<label class="lbl" for="buyName">Nama Anda</label><input class="fld" id="buyName" maxlength="60" placeholder="Nama sesuai bukti pembayaran" value="' + esc(store.get('name', '')) + '">' +
      '<p class="hint" style="margin:8px 0 10px">ID perangkat Anda: <span class="dev-id">' + device.slice(0, 8) + '</span>. ID ini ikut terkirim agar admin dapat membantu bila ada kendala.</p>' +
      '<a class="btn btn-wa" id="waBtn" target="_blank" rel="noopener" href="#">' + icon('wa') + ' Kirim konfirmasi via WhatsApp</a>' +
      '<p class="hint" style="margin-top:8px">Lampirkan bukti pembayaran di WhatsApp. Admin akan membalas dengan <b>kode akses</b>.</p></div>' +
      '<div class="step"><div class="step-h"><i>4</i> Masukkan kode akses</div><div class="code-in"><input class="fld" id="codeIn" placeholder="TGS-XXXX-XXXX" maxlength="20" autocomplete="off"><button class="btn btn-primary" id="codeGo">' + icon('unlock') + ' Aktifkan</button></div></div>' +
      '</div>', true);
    function selected() {
      var pk = $('input[name=pk]:checked', card).value;
      if (pk === 'ALL') return { scope: 'ALL', total: S.priceAll, label: 'Semua bab' };
      var ids = $$('#chPick input:checked:not([disabled])', card).map(function (i) { return i.value; });
      return { scope: ids, total: ids.length * S.priceChapter, label: ids.length ? ids.map(function (i) { return 'Bab ' + chNum(i); }).join(', ') : '' };
    }
    function update() {
      var sel = selected(), pick = $('input[name=pk]:checked', card).value === 'PICK';
      $$('.opt', card).forEach(function (o) { o.classList.toggle('on', $('input', o).checked); });
      $('#chPick', card).hidden = !pick;
      var t = sel.total;
      if (pick && t >= S.priceAll) { $('#pickSum', card).textContent = rp(t) + ' → paket semua lebih hemat'; }
      else $('#pickSum', card).textContent = pick ? rp(t) : '—';
      $('#payTotal', card).textContent = rp(t); $('#payTotal2', card).textContent = rp(t);
      var name = $('#buyName', card).value.trim();
      var msg = 'Halo Admin ' + S.title + ' 👋\nSaya sudah membayar via QRIS.\n\n• Paket: ' + (sel.label || '-') + '\n• Nominal: ' + rp(t) + '\n• Nama: ' + (name || '-') + '\n• ID perangkat: ' + device.slice(0, 8) + '\n\nBerikut bukti pembayarannya. Mohon dikirimkan kode aksesnya. Terima kasih.';
      $('#waBtn', card).href = waLink(S.waAdmin, msg);
      $('#waBtn', card).style.opacity = t > 0 ? '' : '.5';
    }
    card.addEventListener('change', update); card.addEventListener('input', update);
    $('#waBtn', card).addEventListener('click', function (e) {
      if (selected().total <= 0) { e.preventDefault(); toast('Pilih minimal satu bab terlebih dahulu.', 'info'); return; }
      store.set('name', $('#buyName', card).value.trim());
      setTimeout(function () { toast('Setelah admin membalas, masukkan kode akses di langkah 4.', 'ticket'); }, 800);
    });
    $('#codeGo', card).addEventListener('click', function () { redeem($('#codeIn', card).value, $('#codeGo', card)); });
    $('#codeIn', card).addEventListener('keydown', function (e) { if (e.key === 'Enter') redeem(this.value, $('#codeGo', card)); });
    update();
    getQris().then(function (src) {
      var b = $('#qrisBox', card); if (!b) return;
      b.innerHTML = '<img class="qris" src="' + esc(src) + '" alt="QRIS ' + esc(S.merchant) + '" draggable="false">';
      $('img', b).addEventListener('click', function () { zoom(src); });
    }, function () { var b = $('#qrisBox', card); if (b) b.innerHTML = '<p class="hint">Gambar QRIS gagal dimuat. Silakan hubungi admin via WhatsApp.</p>'; });
  }
  function zoom(src) {
    var z = document.createElement('div'); z.className = 'zoom'; z.innerHTML = '<img alt="QRIS" draggable="false">'; z.firstChild.src = src;
    z.addEventListener('click', function () { z.remove(); }); body.appendChild(z);
  }
  function openRedeem() {
    modal('<button class="ib x" data-close aria-label="Tutup">' + icon('x') + '</button><h3>Masukkan Kode Akses</h3><p>Ketik kode yang Anda terima dari admin melalui WhatsApp.</p>' +
      '<div class="code-in"><input class="fld" id="codeIn" placeholder="TGS-XXXX-XXXX" maxlength="20" autocomplete="off"><button class="btn btn-primary" id="codeGo">' + icon('unlock') + ' Aktifkan</button></div>' +
      '<p class="hint" style="margin-top:12px">Belum punya kode? <button class="btn btn-soft btn-sm" data-open="buy">Lihat cara membeli</button></p>');
    $('#codeGo').addEventListener('click', function () { redeem($('#codeIn').value, $('#codeGo')); });
    $('#codeIn').addEventListener('keydown', function (e) { if (e.key === 'Enter') redeem(this.value, $('#codeGo')); });
  }
  function redeem(code, btn) {
    code = String(code || '').trim();
    if (code.replace(/[^A-Za-z0-9]/g, '').length < 8) { toast('Kode akses belum lengkap.', 'info'); return; }
    if (btn) { btn.disabled = true; btn.style.opacity = .6; }
    call('redeem', { code: code }).then(function (a) {
      access = { code: a.code, scope: a.scope }; store.set('access', access);
      fileCache = {}; searchIndex = null;
      closeModal(); confetti();
      toast('Akses berhasil dibuka: ' + accessLabel() + '. Selamat membaca!', 'unlock');
      buildNav(); go(current.id && current.id !== 'home' ? current.id : 'home', null, { force: true });
    }).catch(function (e) { toast(e.message, 'info'); })
      .then(function () { if (btn) { btn.disabled = false; btn.style.opacity = ''; } });
  }
  function openMyCode() {
    if (!access) return openRedeem();
    var masked = access.code.replace(/(TGS-....-)(....)/, '$1••••');
    modal('<h3>Akses Anda</h3><p><b>' + esc(accessLabel()) + '</b></p><p>Kode: <span class="dev-id">' + esc(masked) + '</span><br><span class="hint">Kode ini dapat dipakai di maksimal ' + S.maxDevices + ' perangkat. Jangan bagikan kode kepada orang lain.</span></p>' +
      '<div class="modal-actions"><button class="btn btn-line" id="forget">Keluarkan dari perangkat ini</button>' + (access.scope === 'ALL' ? '' : '<button class="btn btn-primary" data-open="buy">Tambah bab</button>') + '<button class="btn btn-soft" data-close>Tutup</button></div>');
    $('#forget').addEventListener('click', function () {
      access = null; store.del('access'); fileCache = {}; searchIndex = null; closeModal(); buildNav(); go('home', null, { force: true });
      toast('Kode akses dikeluarkan dari perangkat ini.', 'logout');
    });
  }

  /* =====================================================
     PENCARIAN
     ===================================================== */
  var q = $('#q'), results = $('#results'), resItems = [], resActive = -1, qTimer;
  q.addEventListener('focus', function () { loadSearch().catch(function () {}); });
  q.addEventListener('input', function () { clearTimeout(qTimer); qTimer = setTimeout(doSearch, 110); });
  q.addEventListener('keydown', function (e) {
    if (e.key === 'ArrowDown') { e.preventDefault(); setActive(resActive + 1); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActive(resActive - 1); }
    else if (e.key === 'Enter') { e.preventDefault(); var it = resItems[Math.max(0, resActive)]; if (it) pick(it[0]); }
    else if (e.key === 'Escape') { closeResults(); q.blur(); body.classList.remove('search-open'); }
  });
  function hl(text, terms) {
    var s = esc(text);
    terms.forEach(function (t) { if (t.length > 1) s = s.replace(new RegExp('(' + t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + ')', 'ig'), '<mark>$1</mark>'); });
    return s;
  }
  function doSearch() {
    var raw = q.value.trim(); if (!raw) return closeResults();
    loadSearch().then(function (idx) {
      var nq = norm(raw), terms = nq.split(' ').filter(Boolean), num = /^\d{1,3}$/.test(raw) ? +raw : null, scored = [];
      idx.forEach(function (e) {
        var t = norm(e[1]), c = norm(e[2]), x = norm(e[4] + ' ' + e[5]), sc = 0, all = true;
        if (num !== null && e[0] === num) sc += 100;
        if (t.indexOf(nq) > -1) sc += 30;
        if (x.indexOf(nq) > -1) sc += 12;
        terms.forEach(function (w) { var hit = false; if (t.indexOf(w) > -1) { sc += 6; hit = true; } if (c.indexOf(w) > -1) { sc += 3; hit = true; } if (x.indexOf(w) > -1) { sc += 2; hit = true; } if (!hit) all = false; });
        if (!all && sc < 30) sc = 0;
        if (sc > 0) scored.push([sc, e]);
      });
      scored.sort(function (a, b) { return b[0] - a[0] || a[1][0] - b[1][0]; });
      resItems = scored.slice(0, 12).map(function (s) { return s[1]; }); resActive = -1;
      results.innerHTML = resItems.length ? resItems.map(function (e, i) {
        return '<div class="res" role="option" data-i="' + i + '"><span class="rn">' + e[0] + '</span><div><div class="rt">' + hl(e[1], terms) + '</div><div class="rs">' + hl(e[2], terms) + ' · Bab ' + chapterOf(e[0]).n + '</div></div>' + (entryOpen(e[0]) ? '' : icon('lock', 'lock-ic')) + '</div>';
      }).join('') : '<div class="res-empty">Tidak ditemukan. Coba kata lain atau nomor entri.</div>';
      results.classList.add('open');
    }).catch(function () { results.innerHTML = '<div class="res-empty">Indeks pencarian gagal dimuat.</div>'; results.classList.add('open'); });
  }
  function setActive(i) {
    var rows = $$('.res', results); if (!rows.length) return;
    resActive = (i + rows.length) % rows.length;
    rows.forEach(function (r, k) { r.classList.toggle('active', k === resActive); }); rows[resActive].scrollIntoView({ block: 'nearest' });
  }
  results.addEventListener('mousedown', function (e) { var r = e.target.closest('.res'); if (r) { e.preventDefault(); pick(resItems[+r.getAttribute('data-i')][0]); } });
  function pick(n) { closeResults(); q.value = ''; q.blur(); body.classList.remove('search-open'); goEntry(n); }
  function closeResults() { results.classList.remove('open'); }
  document.addEventListener('click', function (e) { if (!e.target.closest('#searchBox')) closeResults(); });
  $('#btnSearchM').addEventListener('click', function () { body.classList.toggle('search-open'); if (body.classList.contains('search-open')) setTimeout(function () { q.focus(); }, 50); });

  /* =====================================================
     DISKUSI
     ===================================================== */
  var talk = { target: 'umum', label: 'Ruang Diskusi Umum', opened: 0 };
  var COLORS = ['#0d9488', '#4f46e5', '#7c3aed', '#d97706', '#e11d48', '#059669', '#0284c7', '#c026d3'];
  function openTalk(target, label) {
    talk = { target: target, label: label, opened: Date.now() };
    $('#drTitle').textContent = label; $('#drawer').classList.add('open'); $('#drawer').setAttribute('aria-hidden', 'false');
    $('#fName').value = store.get('name', ''); loadComments();
  }
  function closeTalk() { $('#drawer').classList.remove('open'); $('#drawer').setAttribute('aria-hidden', 'true'); }
  $('#drClose').addEventListener('click', closeTalk);
  document.addEventListener('click', function (e) { var t = e.target.closest('[data-talk]'); if (t && !adminOpen()) { e.preventDefault(); openTalk(t.getAttribute('data-talk'), t.getAttribute('data-label')); } });
  $('#fabTalk').addEventListener('click', function () {
    if (current.id && current.id !== 'home' && PART[current.id]) openTalk(current.id, PART[current.id].title); else openTalk('umum', 'Ruang Diskusi Umum');
  });
  function timeAgo(iso) {
    var d = new Date(iso), s = (Date.now() - d) / 1000;
    try {
      var rtf = new Intl.RelativeTimeFormat('id', { numeric: 'auto' });
      if (s < 60) return 'baru saja'; if (s < 3600) return rtf.format(-Math.round(s / 60), 'minute');
      if (s < 86400) return rtf.format(-Math.round(s / 3600), 'hour'); if (s < 2592000) return rtf.format(-Math.round(s / 86400), 'day');
    } catch (e) {}
    return d.toLocaleDateString('id-ID', { day: 'numeric', month: 'short', year: 'numeric' });
  }
  function commentEl(c, pending) {
    var el = document.createElement('div'); el.className = 'cm' + (pending ? ' pending' : '');
    el.innerHTML = '<div class="cm-h"><span class="cm-av"></span><div><div class="cm-n"></div><div class="cm-t"></div></div><span class="cm-type"></span></div><div class="cm-b"></div>';
    $('.cm-av', el).style.background = COLORS[(c.name || 'P').charCodeAt(0) % COLORS.length];
    $('.cm-av', el).textContent = (c.name || 'P').trim().charAt(0).toUpperCase();
    $('.cm-n', el).textContent = c.name || 'Pembaca';
    $('.cm-t', el).textContent = pending ? 'menunggu moderasi' : timeAgo(c.time);
    var ty = $('.cm-type', el); ty.textContent = c.type === 'Pertanyaan' ? 'Pertanyaan' : 'Komentar'; if (c.type === 'Pertanyaan') ty.classList.add('q');
    $('.cm-b', el).textContent = c.message;
    if (c.reply) { var r = document.createElement('div'); r.className = 'cm-r'; r.innerHTML = '<b>' + icon('pen') + 'Balasan Penulis</b><span></span>'; r.lastChild.textContent = c.reply; el.appendChild(r); }
    return el;
  }
  function loadComments() {
    var list = $('#drList'), tg = talk.target;
    list.innerHTML = '<div class="skel"></div><div class="skel" style="width:70%"></div><div class="skel"></div>';
    call('getComments', { target: tg }).then(function (arr) {
      if (talk.target !== tg) return;
      list.innerHTML = '';
      if (!arr.length) { list.innerHTML = '<div class="cm-empty">' + icon('messages') + '<div>Belum ada diskusi. Jadilah yang pertama!</div></div>'; return; }
      arr.forEach(function (c) { list.appendChild(commentEl(c)); });
    }).catch(function () { list.innerHTML = '<div class="cm-empty">Komentar belum dapat dimuat.</div>'; });
  }
  $('#fMsg').addEventListener('input', function () { $('#fCount').textContent = this.value.length + '/1500'; });
  $('#drForm').addEventListener('submit', function (e) {
    e.preventDefault();
    var f = e.target, msg = f.message.value.trim(), name = f.name.value.trim();
    if (msg.length < 3) { toast('Pesan masih terlalu pendek.', 'info'); f.message.focus(); return; }
    var btn = $('#fSend'); btn.disabled = true; btn.style.opacity = .6;
    var payload = { target: talk.target, label: talk.label, type: f.type.value, name: name, message: msg, website: f.website.value, elapsed: Date.now() - talk.opened };
    store.set('name', name);
    call('postComment', payload).then(function (r) {
      f.message.value = ''; $('#fCount').textContent = '0/1500';
      var list = $('#drList'), empty = $('.cm-empty', list); if (empty) empty.remove();
      list.insertBefore(commentEl({ name: name || 'Pembaca', type: payload.type, message: msg, time: new Date().toISOString() }, !r.published), list.firstChild);
      toast(r.published ? 'Terima kasih! Pesan Anda sudah tampil.' : 'Terima kasih! Pesan Anda akan tampil setelah ditinjau.', 'send');
      if (r.published) { counts[talk.target] = (counts[talk.target] || 0) + 1; paintCounts(); }
    }).catch(function (err) { toast(err.message || 'Gagal mengirim. Coba lagi.', 'info'); })
      .then(function () { btn.disabled = false; btn.style.opacity = ''; });
  });
  function paintCounts() {
    $$('[data-count]').forEach(function (s) { var n = counts[s.getAttribute('data-count')] || 0; s.textContent = n ? n : ''; s.style.display = n ? '' : 'none'; });
    var total = Object.keys(counts).reduce(function (a, k) { return a + counts[k]; }, 0), dot = $('#fabDot');
    dot.textContent = total > 99 ? '99+' : total; dot.style.display = total ? 'grid' : 'none';
  }
  function refreshCounts() { call('getCommentCounts').then(function (c) { counts = c || {}; paintCounts(); }).catch(function () {}); }

  /* =====================================================
     PROGRES BACA, TOMBOL ATAS, PINTASAN
     ===================================================== */
  var ticking = false;
  window.addEventListener('scroll', function () {
    if (ticking) return; ticking = true;
    requestAnimationFrame(function () {
      var h = document.documentElement, max = h.scrollHeight - h.clientHeight;
      $('#readProgress span').style.width = (max > 0 ? (h.scrollTop / max * 100) : 0) + '%';
      $('#fabTop').classList.toggle('show', h.scrollTop > 600); ticking = false;
    });
  }, { passive: true });
  $('#fabTop').addEventListener('click', function () { window.scrollTo({ top: 0, behavior: 'smooth' }); });
  document.addEventListener('keydown', function (e) {
    var k = e.key, typing = isField(e.target);
    if (k === 'Escape') {
      if ($('.zoom')) return $('.zoom').remove();
      if (!$('#modal').hidden) return closeModal();
      if (adminOpen()) return;
      if ($('#drawer').classList.contains('open')) return closeTalk();
      if (body.classList.contains('nav-open')) return body.classList.remove('nav-open');
      if (body.classList.contains('reading')) return setReading(false);
    }
    if (typing || e.ctrlKey || e.metaKey || e.altKey || adminOpen() || !$('#modal').hidden) return;
    if (k === '/') { e.preventDefault(); if (innerWidth <= 860) body.classList.add('search-open'); q.focus(); }
    else if (k === 'r' || k === 'R') setReading(!body.classList.contains('reading'));
    else if (k === 't' || k === 'T') setTheme(prefs.theme !== 'dark', $('#themeToggle').parentNode);
    else if (k === 'f' || k === 'F') toggleFull();
    else if (k === 'a' || k === 'A') randomEntry();
    else if (k === 'd' || k === 'D') $('#fabTalk').click();
    else if (k === '?') showKeys();
    else if ((k === 'n' || k === 'N' || k === 'p' || k === 'P') && PART[current.id]) { var t = PARTS[PART[current.id].index + (k.toLowerCase() === 'n' ? 1 : -1)]; if (t) go(t.id); }
  });

  /* =====================================================
     PROTEKSI KONTEN (dapat diatur dari panel admin)
     ===================================================== */
  function allow(e) { return isField(e.target) || adminOpen(); }
  document.addEventListener('contextmenu', function (e) { if (!S.protectRightClick || allow(e)) return; e.preventDefault(); softToast('Klik kanan dinonaktifkan untuk melindungi isi buku.', 'shield'); });
  ['copy', 'cut'].forEach(function (ev) {
    document.addEventListener(ev, function (e) {
      if (!S.protectCopy || allow(e)) return;
      e.preventDefault(); if (e.clipboardData) e.clipboardData.setData('text/plain', '© ' + S.author + ' — ' + S.title);
      softToast('Menyalin isi buku tidak diizinkan.', 'shield');
    });
  });
  document.addEventListener('selectstart', function (e) { if (S.protectCopy && !allow(e)) e.preventDefault(); });
  document.addEventListener('dragstart', function (e) { if (S.protectCopy && !allow(e)) e.preventDefault(); });
  document.addEventListener('paste', function (e) { if (S.protectCopy && !allow(e)) e.preventDefault(); });
  document.addEventListener('keydown', function (e) {
    if (adminOpen()) return;
    var k = (e.key || '').toLowerCase(), mod = e.ctrlKey || e.metaKey;
    var devtools = k === 'f12' || (mod && e.shiftKey && (k === 'i' || k === 'j' || k === 'c')) || (mod && k === 'u');
    var blocked = mod && (k === 's' || (k === 'p' && S.protectPrint) || ((k === 'c' || k === 'x' || k === 'a') && !isField(e.target)));
    if (S.protectCopy && (devtools || blocked)) { e.preventDefault(); e.stopPropagation(); softToast('Pintasan ini dinonaktifkan di situs ini.', 'shield'); }
  }, true);
  document.addEventListener('keyup', function (e) {
    if (e.key === 'PrintScreen' && S.protectSwap && !adminOpen()) {
      shield(true); setTimeout(function () { shield(false); }, 1500);
      try { navigator.clipboard && navigator.clipboard.writeText('© ' + S.author + ' — ' + S.title).catch(function () {}); } catch (x) {}
      softToast('Tangkapan layar tidak diizinkan.', 'shield');
    }
  });
  var shieldTimer;
  function shield(on) { body.classList.toggle('shielded', on && S.protectSwap && !adminOpen()); }
  document.addEventListener('visibilitychange', function () { if (document.hidden) shield(true); else setTimeout(function () { shield(false); }, 120); });
  window.addEventListener('pagehide', function () { shield(true); });
  window.addEventListener('blur', function () { clearTimeout(shieldTimer); shieldTimer = setTimeout(function () { if (!document.hasFocus()) shield(true); }, 250); });
  window.addEventListener('focus', function () { clearTimeout(shieldTimer); shield(false); });
  $('#shield').addEventListener('click', function () { shield(false); });
  $('#shield').addEventListener('touchstart', function () { shield(false); }, { passive: true });

  /* =====================================================
     PANEL ADMIN (ketuk logo 5x)
     ===================================================== */
  var taps = [], adminToken = sess.get('admin'), AD = null, adTab = 'ringkasan', lastNew = null;
  $('#logo').addEventListener('click', function (e) {
    var now = Date.now(); taps = taps.filter(function (t) { return now - t < 2500; }); taps.push(now);
    var l = $('#logo'); l.classList.remove('tap'); void l.offsetWidth; l.classList.add('tap');
    if (taps.length >= 5) { taps = []; e.preventDefault(); e.stopPropagation(); adminToken ? openAdmin() : adminLogin(); }
  }, true);
  function adminLogin() {
    modal('<button class="ib x" data-close aria-label="Tutup">' + icon('x') + '</button><h3>' + icon('shield') + ' Masuk Admin</h3><p>Area khusus pengelola situs.</p>' +
      '<form id="admForm"><label class="lbl" for="admPass">Kata sandi</label><input class="fld" id="admPass" type="password" autocomplete="current-password" required>' +
      '<div class="modal-actions" style="margin-top:14px"><button type="button" class="btn btn-line" data-close>Batal</button><button class="btn btn-primary" id="admGo">Masuk</button></div></form>');
    $('#admForm').addEventListener('submit', function (e) {
      e.preventDefault(); var b = $('#admGo'); b.disabled = true;
      call('adminLogin', { password: $('#admPass').value }).then(function (r) { adminToken = r.token; sess.set('admin', adminToken); closeModal(); openAdmin(); })
        .catch(function (err) { toast(err.message, 'shield'); b.disabled = false; });
    });
  }
  function adminCall(action, params) {
    params = params || {}; params.token = adminToken;
    return call(action, params).catch(function (e) {
      if (e.code === 'auth') { adminToken = null; sess.del('admin'); closeAdmin(); toast(e.message, 'shield'); adminLogin(); }
      throw e;
    });
  }
  function openAdmin() {
    body.classList.add('admin-open'); var a = $('#admin'); a.hidden = false;
    a.innerHTML = '<div class="ad-top"><span class="logo"><img src="' + esc(ASSETS.logo || '') + '" alt=""></span><h2>Panel Admin<small>' + esc(S.title) + '</small></h2>' +
      '<a class="ib" id="adSheet" target="_blank" rel="noopener" title="Buka Google Sheet" href="#">' + icon('sheet') + '</a>' +
      '<button class="ib" id="adRefresh" title="Muat ulang data">' + icon('reset') + '</button><button class="ib" id="adLogout" title="Keluar">' + icon('logout') + '</button><button class="ib" id="adClose" title="Tutup panel">' + icon('x') + '</button></div>' +
      '<nav class="ad-tabs">' + [['ringkasan', 'chart', 'Ringkasan'], ['kode', 'ticket', 'Kode Akses'], ['komentar', 'messages', 'Komentar'], ['info', 'info', 'Info Buku & Pengaturan'], ['keamanan', 'shield', 'Keamanan']]
        .map(function (t) { return '<button data-tab="' + t[0] + '"' + (t[0] === adTab ? ' class="on"' : '') + '>' + icon(t[1]) + t[2] + '</button>'; }).join('') + '</nav>' +
      '<div class="ad-body" id="adBody">' + loaderHTML('Memuat data admin…') + '</div>';
    $('#adClose').addEventListener('click', closeAdmin);
    $('#adRefresh').addEventListener('click', loadAdmin);
    $('#adLogout').addEventListener('click', function () { call('adminLogout', { token: adminToken }).catch(function () {}); adminToken = null; sess.del('admin'); closeAdmin(); toast('Anda telah keluar dari panel admin.', 'logout'); });
    $$('.ad-tabs button', a).forEach(function (b) { b.addEventListener('click', function () { adTab = b.getAttribute('data-tab'); $$('.ad-tabs button', a).forEach(function (x) { x.classList.toggle('on', x === b); }); drawAdmin(); }); });
    loadAdmin();
  }
  function closeAdmin() { $('#admin').hidden = true; $('#admin').innerHTML = ''; body.classList.remove('admin-open'); }
  function loadAdmin() {
    $('#adBody').innerHTML = loaderHTML('Memuat data admin…');
    adminCall('adminGet').then(function (d) { AD = d; var sl = $('#adSheet'); if (sl) sl.href = d.sheetUrl || '#'; drawAdmin(); })
      .catch(function (e) { if (e.code !== 'auth') $('#adBody').innerHTML = '<div class="loader">' + esc(e.message) + '</div>'; });
  }
  function drawAdmin() {
    if (!AD) return; var b = $('#adBody');
    if (adTab === 'ringkasan') b.innerHTML = adSummary();
    if (adTab === 'kode') { b.innerHTML = adCodes(); bindCodes(); }
    if (adTab === 'komentar') { b.innerHTML = adComments('all'); bindComments(); }
    if (adTab === 'info') { b.innerHTML = adSettings(); bindSettings(); }
    if (adTab === 'keamanan') { b.innerHTML = adSecurity(); bindSecurity(); }
    $$('[data-tabgo]', b).forEach(function (x) { x.addEventListener('click', function () { adTab = x.getAttribute('data-tabgo'); $$('.ad-tabs button').forEach(function (y) { y.classList.toggle('on', y.getAttribute('data-tab') === adTab); }); drawAdmin(); }); });
  }
  function adSummary() {
    var s = AD.stats;
    return '<div class="ad-grid">' + [[s.active, 'kode akses aktif'], [s.fullAccess, 'pemegang akses semua bab'], [rp(s.revenue), 'total donasi tercatat'], [s.comments, 'komentar & pertanyaan'], [s.unanswered, 'pertanyaan belum dijawab']]
      .map(function (x) { return '<div class="ad-stat"><b>' + x[0] + '</b><span>' + x[1] + '</span></div>'; }).join('') + '</div>' +
      '<div class="ad-card"><h3>' + icon('spark') + ' Tindakan cepat</h3><div class="row-act"><button class="btn btn-primary btn-sm" data-tabgo="kode">' + icon('ticket') + ' Buat kode akses</button>' +
      '<button class="btn btn-soft btn-sm" data-tabgo="komentar">' + icon('messages') + ' Jawab pertanyaan</button><button class="btn btn-soft btn-sm" data-tabgo="info">' + icon('gear') + ' Ubah info buku</button></div></div>' +
      '<div class="ad-card"><h3>' + icon('info') + ' Alur pembukaan akses</h3><ol class="hint" style="margin:0;padding-left:1.2em;line-height:1.7"><li>Pembaca membayar via QRIS lalu mengirim bukti ke WhatsApp ' + esc(S.waAdmin) + '.</li><li>Cocokkan nominal & waktu di mutasi QRIS Anda.</li><li>Buka tab <b>Kode Akses</b>, isi nama, nomor WA, dan paket, lalu klik <b>Buat kode</b>.</li><li>Klik <b>Kirim via WhatsApp</b> untuk mengirim kode ke pembeli.</li></ol></div>';
  }
  function adCodes() {
    var chs = CHIDS.map(function (id) { return '<label class="chk-ch"><input type="checkbox" name="nc" value="' + id + '"><span>Bab ' + chNum(id) + '</span></label>'; }).join('');
    var rows = AD.codes.map(function (c) {
      var pk = c.scope === 'ALL' ? 'Semua bab' : c.scope.split(',').map(chNum).join(', ');
      return '<tr data-row="' + esc(c.code) + '" data-q="' + esc(norm(c.code + ' ' + c.name + ' ' + c.wa + ' ' + c.note)) + '"><td class="mono">' + esc(c.code) + '</td><td>' + esc(c.name) + '<div class="hint">' + esc(c.wa) + '</div></td><td>' + esc(pk) + '</td><td>' + rp(c.amount) +
        '</td><td>' + c.devices.length + '/' + c.maxDevices + '</td><td><span class="st st-' + esc(c.status) + '">' + esc(c.status) + '</span></td><td><div class="row-act">' +
        '<button data-c="wa">Kirim WA</button><button data-c="copy">Salin</button><button data-c="reset">Reset perangkat</button>' +
        (c.status === 'Aktif' ? '<button data-c="off">Nonaktifkan</button>' : '<button data-c="on">Aktifkan</button>') + '</div></td></tr>';
    }).join('');
    return '<div class="ad-card"><h3>' + icon('ticket') + ' Buat kode akses baru</h3><div class="form-grid">' +
      '<div><label class="lbl">Nama pembeli</label><input class="fld" id="ncName" maxlength="80"></div>' +
      '<div><label class="lbl">Nomor WhatsApp pembeli</label><input class="fld" id="ncWa" inputmode="tel" placeholder="08xxxxxxxxxx"></div>' +
      '<div class="full"><label class="lbl">Paket</label><label class="opt on" style="margin-bottom:6px"><input type="radio" name="ncp" value="ALL" checked><span class="o-t"><b>Semua bab</b></span><span class="o-p">' + rp(S.priceAll) + '</span></label>' +
      '<label class="opt"><input type="radio" name="ncp" value="PICK"><span class="o-t"><b>Pilih bab</b></span><span class="o-p">' + rp(S.priceChapter) + '/bab</span></label><div class="chips" id="ncChs" hidden>' + chs + '</div></div>' +
      '<div><label class="lbl">Nominal diterima (Rp)</label><input class="fld" id="ncAmt" inputmode="numeric" value="' + S.priceAll + '"></div>' +
      '<div><label class="lbl">Maksimal perangkat</label><input class="fld" id="ncMax" type="number" min="1" max="10" value="' + S.maxDevices + '"></div>' +
      '<div class="full"><label class="lbl">Catatan (opsional)</label><input class="fld" id="ncNote" maxlength="200" placeholder="mis. ref. transaksi QRIS 20 Nov 10.15"></div></div>' +
      '<div class="modal-actions" style="margin-top:12px"><button class="btn btn-primary" id="ncGo">' + icon('spark') + ' Buat kode</button></div><div id="ncOut">' + (lastNew ? newCodeHTML(lastNew) : '') + '</div></div>' +
      '<div class="ad-card"><h3>' + icon('list') + ' Daftar kode (' + AD.codes.length + ')</h3><div class="ad-filter"><input class="fld" id="codeFilter" placeholder="Cari kode, nama, nomor…"></div>' +
      (AD.codes.length ? '<div style="overflow-x:auto"><table class="ad-table"><thead><tr><th>Kode</th><th>Pembeli</th><th>Paket</th><th>Nominal</th><th>Perangkat</th><th>Status</th><th>Aksi</th></tr></thead><tbody>' + rows + '</tbody></table></div>' : '<p class="hint">Belum ada kode akses.</p>') + '</div>';
  }
  function codeMsg(c) {
    var pk = c.scope === 'ALL' ? 'Semua bab' : String(c.scope).split(',').map(function (i) { return 'Bab ' + chNum(i); }).join(', ');
    return 'Halo ' + (c.name || 'Kak') + ', terima kasih atas dukungannya untuk buku ' + S.title + ' 🙏\n\nKode akses Anda: *' + c.code + '*\nPaket: ' + pk +
      '\n\nCara memakai: buka situs, ketuk "Saya punya kode" atau "Masukkan kode", lalu ketik kode di atas. Kode berlaku untuk ' + (c.maxDevices || S.maxDevices) + ' perangkat. Mohon tidak dibagikan.\n\nSelamat membaca!\n— ' + S.author;
  }
  function newCodeHTML(c) {
    return '<div class="newcode"><div><div class="hint">Kode baru untuk ' + esc(c.name || 'pembeli') + '</div><div class="nc">' + esc(c.code) + '</div></div><div class="row-act">' +
      '<button class="btn btn-soft btn-sm" id="ncCopy">' + icon('copy') + ' Salin</button>' +
      (c.wa ? '<a class="btn btn-wa btn-sm" target="_blank" rel="noopener" href="' + esc(waLink(c.wa, codeMsg(c))) + '">' + icon('wa') + ' Kirim via WhatsApp</a>' : '<span class="hint">Isi nomor WA pembeli untuk tombol kirim otomatis.</span>') + '</div></div>';
  }
  function bindCodes() {
    var b = $('#adBody');
    function pkUpdate() {
      var pick = $('input[name=ncp]:checked', b).value === 'PICK';
      $$('.opt', b).forEach(function (o) { o.classList.toggle('on', $('input', o).checked); });
      $('#ncChs', b).hidden = !pick;
      var n = $$('#ncChs input:checked', b).length;
      $('#ncAmt', b).value = pick ? n * S.priceChapter : S.priceAll;
    }
    $$('input[name=ncp], #ncChs input', b).forEach(function (i) { i.addEventListener('change', pkUpdate); });
    $('#ncGo', b).addEventListener('click', function () {
      var pick = $('input[name=ncp]:checked', b).value === 'PICK';
      var scope = pick ? $$('#ncChs input:checked', b).map(function (i) { return i.value; }) : 'ALL';
      if (pick && !scope.length) return toast('Pilih minimal satu bab.', 'info');
      var btn = this; btn.disabled = true;
      adminCall('adminCreateCode', { data: { name: $('#ncName', b).value, wa: $('#ncWa', b).value, scope: scope, amount: $('#ncAmt', b).value, maxDevices: $('#ncMax', b).value, note: $('#ncNote', b).value } })
        .then(function (c) { lastNew = c; toast('Kode ' + c.code + ' berhasil dibuat.', 'ticket'); return adminCall('adminGet'); })
        .then(function (d) { AD = d; drawAdmin(); })
        .catch(function (e) { toast(e.message, 'info'); btn.disabled = false; });
    });
    var cp = $('#ncCopy', b); if (cp) cp.addEventListener('click', function () { copyText(lastNew.code); });
    $('#codeFilter', b).addEventListener('input', function () { var v = norm(this.value); $$('tr[data-q]', b).forEach(function (r) { r.style.display = !v || r.getAttribute('data-q').indexOf(v) > -1 ? '' : 'none'; }); });
    $$('tr[data-row] [data-c]', b).forEach(function (btn) {
      btn.addEventListener('click', function () {
        var code = btn.closest('tr').getAttribute('data-row'), c = AD.codes.filter(function (x) { return x.code === code; })[0], act = btn.getAttribute('data-c');
        if (act === 'copy') return copyText(code);
        if (act === 'wa') { if (!c.wa) return toast('Nomor WA pembeli belum diisi.', 'info'); window.open(waLink(c.wa, codeMsg(c)), '_blank', 'noopener'); return; }
        var data = act === 'reset' ? { resetDevices: true } : { status: act === 'on' ? 'Aktif' : 'Nonaktif' };
        btn.disabled = true;
        adminCall('adminUpdateCode', { code: code, data: data }).then(function () { toast('Kode ' + code + ' diperbarui.', 'ticket'); return adminCall('adminGet'); })
          .then(function (d) { AD = d; drawAdmin(); }).catch(function (e) { toast(e.message, 'info'); btn.disabled = false; });
      });
    });
  }
  var cmFilter = 'all';
  function adComments() {
    var list = AD.comments.filter(function (c) { return cmFilter === 'all' || (cmFilter === 'q' && c.type === 'Pertanyaan' && !c.reply) || (cmFilter === 'hidden' && !c.visible); });
    return '<div class="ad-filter">' + [['all', 'Semua'], ['q', 'Pertanyaan belum dijawab'], ['hidden', 'Tersembunyi']].map(function (f) { return '<button class="pill' + (cmFilter === f[0] ? ' on' : '') + '" data-f="' + f[0] + '">' + f[1] + '</button>'; }).join('') + '</div>' +
      (list.length ? list.map(function (c) {
        return '<div class="ad-cm' + (c.visible ? '' : ' hid') + '" data-id="' + esc(c.id) + '"><div class="ad-cm-h"><span class="who">' + esc(c.name) + '</span><span class="cm-type' + (c.type === 'Pertanyaan' ? ' q' : '') + '">' + esc(c.type) + '</span><span class="where">' + esc(c.label || c.target) + ' · ' + esc(timeAgo(c.time)) + '</span></div>' +
          '<div class="ad-cm-m"></div><textarea class="fld" placeholder="Tulis balasan penulis…">' + esc(c.reply) + '</textarea>' +
          '<div class="row-act"><button data-m="reply">' + 'Simpan balasan</button><button data-m="vis">' + (c.visible ? 'Sembunyikan' : 'Tampilkan') + '</button><button data-m="del">Hapus</button></div></div>';
      }).join('') : '<p class="hint">Tidak ada komentar pada filter ini.</p>');
  }
  function bindComments() {
    var b = $('#adBody');
    $$('.ad-cm', b).forEach(function (el) { var c = AD.comments.filter(function (x) { return x.id === el.getAttribute('data-id'); })[0]; $('.ad-cm-m', el).textContent = c.message; });
    $$('[data-f]', b).forEach(function (p) { p.addEventListener('click', function () { cmFilter = p.getAttribute('data-f'); drawAdmin(); }); });
    $$('[data-m]', b).forEach(function (btn) {
      btn.addEventListener('click', function () {
        var el = btn.closest('.ad-cm'), id = el.getAttribute('data-id'), c = AD.comments.filter(function (x) { return x.id === id; })[0], m = btn.getAttribute('data-m'), data;
        if (m === 'reply') data = { reply: $('textarea', el).value };
        if (m === 'vis') data = { visible: !c.visible };
        if (m === 'del') { if (btn.getAttribute('data-sure') !== '1') { btn.setAttribute('data-sure', '1'); btn.textContent = 'Yakin hapus?'; return; } data = { remove: true }; }
        btn.disabled = true;
        adminCall('adminComment', { id: id, data: data }).then(function () {
          toast(m === 'reply' ? 'Balasan disimpan.' : m === 'vis' ? 'Visibilitas diperbarui.' : 'Komentar dihapus.', 'messages');
          if (m === 'reply') c.reply = data.reply; if (m === 'vis') c.visible = data.visible; if (m === 'del') AD.comments = AD.comments.filter(function (x) { return x.id !== id; });
          drawAdmin();
        }).catch(function (e) { toast(e.message, 'info'); btn.disabled = false; });
      });
    });
  }
  var FIELDS = [
    ['Info terbitan', [['title', 'Judul buku'], ['subtitle', 'Subjudul', 'full'], ['author', 'Penulis'], ['publisher', 'Nama penerbit'], ['city', 'Kota terbit'], ['year', 'Tahun terbit'], ['edition', 'Edisi / cetakan'], ['isbn', 'ISBN'], ['size', 'Ukuran buku'], ['pages', 'Jumlah halaman'], ['email', 'Surel kontak']]],
    ['Pembayaran & akses', [['waAdmin', 'Nomor WhatsApp admin'], ['merchant', 'Nama merchant QRIS'], ['priceChapter', 'Harga per bab (Rp)', 'num'], ['priceAll', 'Harga semua bab (Rp)', 'num'], ['freeEntries', 'Jumlah entri gratis', 'num'], ['maxDevices', 'Maks. perangkat per kode (bawaan)', 'num'], ['qrisUrl', 'URL gambar QRIS lain (opsional)', 'full']]],
    ['Pengumuman', [['announcementOn', 'Tampilkan pengumuman di atas situs', 'bool'], ['announcement', 'Teks pengumuman', 'full']]],
    ['Proteksi konten', [['protectCopy', 'Larang salin, tempel & pintasan papan ketik', 'bool'], ['protectRightClick', 'Larang klik kanan', 'bool'], ['protectSwap', 'Samarkan isi saat beralih aplikasi / tangkapan layar', 'bool'], ['protectPrint', 'Larang mencetak halaman', 'bool']]],
    ['Komentar', [['autoPublish', 'Komentar langsung tampil (tanpa moderasi)', 'bool'], ['notifyQuestion', 'Kirim surel saat ada pertanyaan baru', 'bool'], ['notifyComment', 'Kirim surel saat ada komentar baru', 'bool']]]
  ];
  function adSettings() {
    var s = AD.settings;
    return FIELDS.map(function (g) {
      return '<div class="ad-card"><h3>' + icon('gear') + ' ' + g[0] + '</h3><div class="form-grid">' + g[1].map(function (f) {
        if (f[2] === 'bool') return '<label class="tgl full">' + f[1] + '<input type="checkbox" data-k="' + f[0] + '"' + (s[f[0]] ? ' checked' : '') + '></label>';
        return '<div' + (f[2] === 'full' ? ' class="full"' : '') + '><label class="lbl">' + f[1] + '</label><input class="fld" data-k="' + f[0] + '"' + (f[2] === 'num' ? ' inputmode="numeric"' : '') + ' value="' + esc(s[f[0]]) + '"></div>';
      }).join('') + '</div></div>';
    }).join('') + '<div class="ad-save"><button class="btn btn-primary" id="saveSet">' + icon('check') + ' Simpan pengaturan</button></div>';
  }
  function bindSettings() {
    $('#saveSet').addEventListener('click', function () {
      var out = {}, btn = this;
      $$('[data-k]', $('#adBody')).forEach(function (i) { out[i.getAttribute('data-k')] = i.type === 'checkbox' ? i.checked : i.value; });
      btn.disabled = true;
      adminCall('adminSaveSettings', { settings: out }).then(function (s) {
        AD.settings = s; applySettings(s); toast('Pengaturan tersimpan dan langsung berlaku.', 'check'); btn.disabled = false;
      }).catch(function (e) { toast(e.message, 'info'); btn.disabled = false; });
    });
  }
  function adSecurity() {
    return '<div class="ad-card"><h3>' + icon('shield') + ' Ganti kata sandi admin</h3><div class="form-grid"><div><label class="lbl">Kata sandi lama</label><input class="fld" id="pwOld" type="password" autocomplete="current-password"></div>' +
      '<div><label class="lbl">Kata sandi baru (min. 8 karakter)</label><input class="fld" id="pwNew" type="password" autocomplete="new-password"></div><div><label class="lbl">Ulangi kata sandi baru</label><input class="fld" id="pwNew2" type="password" autocomplete="new-password"></div></div>' +
      '<div class="modal-actions" style="margin-top:12px"><button class="btn btn-primary" id="pwGo">Simpan kata sandi</button></div></div>' +
      '<div class="ad-card"><h3>' + icon('info') + ' Catatan keamanan</h3><ul class="hint" style="margin:0;padding-left:1.2em;line-height:1.7"><li>Panel ini dibuka dengan mengetuk logo 5 kali. Sesi admin berlaku 6 jam di tab ini saja.</li><li>Setelah 5 kali salah kata sandi, percobaan masuk dikunci 15 menit.</li><li>Lupa kata sandi? Jalankan fungsi <b>resetAdminPassword</b> di editor Apps Script, lalu lihat log eksekusi.</li></ul></div>';
  }
  function bindSecurity() {
    $('#pwGo').addEventListener('click', function () {
      var a = $('#pwOld').value, n = $('#pwNew').value, n2 = $('#pwNew2').value;
      if (n !== n2) return toast('Kata sandi baru tidak sama.', 'info');
      adminCall('adminPassword', { oldPassword: a, newPassword: n }).then(function () { toast('Kata sandi admin berhasil diganti.', 'shield'); $$('#adBody input').forEach(function (i) { i.value = ''; }); })
        .catch(function (e) { toast(e.message, 'info'); });
    });
  }

  /* =====================================================
     PENGATURAN DARI SERVER
     ===================================================== */
  function applySettings(s) {
    var priceChanged = s.freeEntries !== S.freeEntries;
    for (var k in s) S[k] = s[k];
    html.classList.toggle('no-print', !!S.protectPrint);
    $('.brand-t b').textContent = S.title; $('.brand-t small').textContent = S.author;
    $('#footMain').innerHTML = '<b>' + esc(S.title) + '</b> · © ' + esc(S.year) + ' ' + esc(S.author) + '. Seluruh isi dilindungi hak cipta.';
    $('#footSub').innerHTML = [S.publisher ? 'Penerbit ' + esc(S.publisher) : '', S.isbn ? 'ISBN ' + esc(S.isbn) : '', '<button class="link-btn" style="display:inline-flex" data-go="info">Info buku</button>']
      .filter(String).join(' · ');
    var an = $('#announce');
    if (S.announcementOn && S.announcement && store.get('annDismiss', '') !== S.announcement) {
      an.hidden = false; an.innerHTML = '<span></span><button aria-label="Tutup">' + icon('x') + '</button>'; an.firstChild.textContent = S.announcement;
      body.classList.add('has-announce');
      an.lastChild.addEventListener('click', function () { store.set('annDismiss', S.announcement); an.hidden = true; body.classList.remove('has-announce'); });
    } else { an.hidden = true; body.classList.remove('has-announce'); }
    if (priceChanged) { fileCache = {}; searchIndex = null; }
    buildNav();
  }

  /* =====================================================
     MULAI
     ===================================================== */
  applyPrefs(); html.classList.add('no-print'); buildNav(); renderMarks();
  var h0 = (location.hash || '').replace(/^#/, '').split('/');
  var startId = h0[0] && PART[h0[0]] ? h0[0] : 'home';
  if (!HAS_API) {
    render('<div class="loader">' + icon('info') + '<b>Alamat API belum diatur.</b><span>Isi <code>API_URL</code> di <code>assets/js/config.js</code> dengan URL Web App Apps Script Anda.</span></div>');
  } else {
    call('init', {}).then(function (d) {
      if (access && !d.access) { access = null; store.del('access'); toast('Kode akses di perangkat ini tidak berlaku lagi. Hubungi admin bila ini keliru.', 'info'); }
      else if (d.access) { access = { code: d.access.code, scope: d.access.scope }; store.set('access', access); }
      counts = d.counts || {}; applySettings(d.settings || {}); paintCounts();
      go(startId, h0[1] || null, { noHash: startId === 'home', force: true });
    }).catch(function (e) {
      toast(e.message || 'Server belum dapat dihubungi.', 'info');
      go(startId, h0[1] || null, { noHash: true, force: true });
    });
    setInterval(refreshCounts, 120000);
  }
  if (adminToken) setTimeout(function () { toast('Sesi admin masih aktif. Ketuk logo 5x untuk membuka panel.', 'shield'); }, 1500);
  if (!store.get('welcomed', false)) {
    var touch = window.matchMedia && matchMedia('(pointer: coarse)').matches;
    setTimeout(function () { toast(touch ? 'Selamat datang! Pendahuluan dan ' + S.freeEntries + ' entri pertama bisa dibaca gratis.' : 'Selamat datang! Tekan ? untuk pintasan, atau / untuk mencari.', 'spark'); }, 1400);
    store.set('welcomed', true);
  }
})();
