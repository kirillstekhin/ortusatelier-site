/* Ortus Atelier — конфигуратор пары: два неба на одном горизонтальном листе (18.09.2026).
   Родословная: ortus.js (натальная: геокод open-meteo UK-first, IANA → пояс, живое превью,
   гейт-сводка, хранилище дизайнов) и family.js (несколько людей в записи дизайна).
   Отличия: ①ДВА человека, у каждого своё имя, дата, время и место — все четыре поля обязательны
   у обоих; ②в design-коде только тема/формат/рама (CP2-00000000-…), люди уходят в запись дизайна
   `members` (имя, дата, время, tz_min, место с координатами) — см. functions/api/design.js;
   ③превью — assets/natal-preview.js renderCoupleSvg: тот же порт печатного рендера, лист лежит;
   ④лист горизонтальный: размеры показываем как 40×30 (тот же артикул, повёрнутый).
   ⚠️Блок «хранилище дизайнов» — близнец ortus.js/family.js: правки держать синхронными. */

const PRICES = {
  print:   { '3040': 34.99, '4050': 39.99, '5070': 44.99 },
  classic: { '3040': 69.99, '4050': 79.99, '5070': 89.99 },
};

/* Темы = NT2-токены натальной (fulfil.THEME_HUMAN). Порядок = галерея страницы. */
const THEMES = [
  { id: 'copperbloom',  label: 'Copper bloom' },
  { id: 'goldcontrast', label: 'Gold · Midnight' },
  { id: 'gardenpaper',  label: 'Garden on paper' },
  { id: 'bimetal',      label: 'Gold & silver' },
];
/* токен размера — как у всех продуктов (артикул Prodigi); подпись — лёжа */
const SIZES  = [['3040', '40×30 cm'], ['4050', '50×40 cm'], ['5070', '70×50 cm']];
const COLORS = ['black', 'gold', 'silver'];
const WHO = ['a', 'b'];

function blankPerson(dateStr, timeStr) {
  return { name: '', dateStr, timeStr, place: '', lat: null, lon: null, tz: 0, iana: 'UTC' };
}
const state = {
  a: blankPerson('1994-06-19', '08:45'),
  b: blankPerson('1991-03-05', '21:04'),
  theme: 'copperbloom', frameType: 'print', size: '3040', frameColor: 'gold',
};
const placeBound = { a: false, b: false };   // человек привязал место (клик/автоприменение) — без этого не продаём

function formatToken() { return state.frameType.toUpperCase() + state.size; }

function tzOffsetHours(iana, dateStr, timeStr, lon) {
  try {
    const [y, mo, d] = dateStr.split('-').map(Number);
    const [hh, mm] = timeStr.split(':').map(Number);
    const probe = new Date(Date.UTC(y, mo - 1, d, hh, mm));
    const part = new Intl.DateTimeFormat('en-US', { timeZone: iana, timeZoneName: 'shortOffset' })
      .formatToParts(probe).find(p => p.type === 'timeZoneName').value;
    const m = part.match(/GMT([+-]\d+)(?::(\d+))?/);
    if (!m) return 0;
    return parseInt(m[1], 10) + (m[2] ? Math.sign(parseInt(m[1], 10)) * parseInt(m[2], 10) / 60 : 0);
  } catch (e) { return lon ? Math.round(lon / 15) : 0; }
}

/* ⚠️Даты и координаты в коде — заглушки, как у FC2: оба человека едут в записи дизайна. */
function designCode() {
  const frame = state.frameType === 'classic' ? state.frameColor.toUpperCase() : 'NONE';
  return `CP2-00000000-0000-N0-E0-Z0-${state.theme.toUpperCase()}-${formatToken()}-${frame}`;
}

function price() { return PRICES[state.frameType][state.size]; }

function refresh() {
  /* ⚠️Любое изменение формы поднимает версию: ответ сервера на СТАРУЮ версию не должен
     открывать чекаут. Сюда приходят даты, времена, тема, формат, размер, цвет и места. */
  bumpVersion();
  WHO.forEach(w => { const p = state[w]; p.tz = tzOffsetHours(p.iana, p.dateStr, p.timeStr, p.lon); });
  const p = `£${price().toFixed(2)}`;
  document.getElementById('cp-price').textContent = p;
  document.getElementById('cp-buy').textContent = `Create our charts — ${p}`;
  document.getElementById('cp-colors').hidden = state.frameType !== 'classic';
  document.querySelectorAll('#cp-formats .cfg-opt').forEach(b =>
    b.querySelector('.f-price').textContent = `£${PRICES[b.dataset.frametype][state.size].toFixed(2)}`);
  renderPreview();
  applyPreviewFrame();
}

/* ── рама на живом превью при Classic — как в ortus.js (те же файлы рам, срез 80 px,
   лицо рамы ≈ 6 % ширины листа; у лежащего листа ширина больше — планка тоже) ── */
const FRAME_FILES = { black: 'frame-classic-black.png', gold: 'frame-classic-gold.png', silver: 'frame-classic-silver.png' };
let frameKey = '';
function applyPreviewFrame() {
  const pv = document.getElementById('np-preview');
  if (!pv) return;
  const file = state.frameType === 'classic' ? FRAME_FILES[state.frameColor] : null;
  const bw = file ? Math.max(12, Math.round((pv.offsetWidth || 560) * 0.045)) : 0;
  const key = file ? file + bw : '';
  if (key === frameKey) return;
  frameKey = key;
  pv.classList.toggle('np-framed', !!file);
  pv.style.border = file ? `${bw}px solid transparent` : '';
  pv.style.borderImage = file ? `url(/assets/frames/${file}) 80 stretch` : '';
  pv.style.background = file ? '#0b1220' : '';
}

/* активные кнопки групп = состояние (после черновика и после пресета) */
function syncActive() {
  ['#cp-themes .cfg-opt|theme|theme', '#cp-formats .cfg-opt|frameType|frametype',
   '#cp-sizes .cfg-opt|size|size', '#cp-colors .cfg-opt|frameColor|color'].forEach(spec => {
    const [sel, key, attr] = spec.split('|');
    document.querySelectorAll(sel).forEach(b =>
      b.classList.toggle('active', b.dataset[attr] === String(state[key])));
  });
}

/* пресеты сетки «Sizes & prices»: клик → формат и размер в конфигураторе (близнец ortus.js).
   ⛔Пресет не трогает людей — только тему, формат, размер и цвет рамы. */
function attachPresets() {
  const ok = {
    theme: v => THEMES.some(t => t.id === v), frameType: v => v in PRICES,
    size: v => SIZES.some(s => s[0] === v), frameColor: v => COLORS.includes(v),
  };
  document.querySelectorAll('[data-preset-frametype]').forEach(a => a.addEventListener('click', () => {
    const d = a.dataset;
    [['theme', d.presetTheme], ['frameType', d.presetFrametype], ['size', d.presetSize],
     ['frameColor', d.presetColor]].forEach(([k, v]) => { if (v && ok[k](v)) state[k] = v; });
    syncActive();
    refresh();
  }));
}

/* ── живое превью листа пары (assets/natal-preview.js — порт печатного рендера) ──
   ⚠️До привязки места небо человека считается над Лондоном, но на листе плейсхолдер вместо
   места, без координат и знака асцендента: чужое место не должно выглядеть как выбранное. */
const PREVIEW_FALLBACK = { lat: 51.5074, lon: -0.1278, iana: 'Europe/London' };
function previewPerson(w) {
  const p = state[w];
  const bound = placeBound[w] && p.lat != null && p.lon != null;
  return {
    dateStr: p.dateStr, timeStr: p.timeStr,
    lat: bound ? p.lat : PREVIEW_FALLBACK.lat,
    lon: bound ? p.lon : PREVIEW_FALLBACK.lon,
    tz: bound ? p.tz : tzOffsetHours(PREVIEW_FALLBACK.iana, p.dateStr, p.timeStr, null),
    place: p.place, placeBound: bound, name: p.name,
  };
}
function renderPreview() {
  if (!window.OrtusNatal || !window.OrtusNatal.showCouple) return;
  window.OrtusNatal.showCouple({
    theme: state.theme, frameType: state.frameType, size: state.size,
    a: previewPerson('a'), b: previewPerson('b'),
  });
}

/* ── место: open-meteo, UK-выдача первой, IANA из результата — по одному экземпляру на человека ── */
function attachGeocode(w) {
  const p = state[w];
  const input = document.getElementById(`cp-${w}-place`);
  const list = document.getElementById(`cp-${w}-place-list`);
  const echo = document.getElementById(`cp-${w}-place-echo`);
  let timer = null, lastResults = [], appliedAt = 0;

  function showEcho() {
    if (!placeBound[w]) { echo.textContent = ''; return; }
    echo.textContent = '✦ ' + p.place +
      '  ·  ' + Math.abs(p.lat).toFixed(4) + (p.lat >= 0 ? '°N ' : '°S ') +
      Math.abs(p.lon).toFixed(4) + (p.lon >= 0 ? '°E' : '°W');
  }

  function apply(res) {
    p.place = [res.name, res.country].filter(Boolean).join(', ');
    p.lat = res.latitude; p.lon = res.longitude;
    p.iana = res.timezone || 'UTC';
    input.value = p.place;
    list.hidden = true;
    appliedAt = Date.now();
    placeBound[w] = true;
    showEcho();
    refresh();
  }

  const preferred = rs => rs.find(r => r.country_code === 'GB') || rs[0];

  async function lookup(q) {
    const url = extra => `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(q)}&count=5&language=en&format=json${extra}`;
    const get = async u => { try { const r = await fetch(u); return (await r.json()).results || []; } catch (e) { return []; } };
    const [uk, world] = await Promise.all([get(url('&countryCode=GB')), get(url(''))]);
    const seen = new Set(), out = [];
    for (const r of uk.concat(world)) {
      const k = r.latitude.toFixed(3) + ',' + r.longitude.toFixed(3);
      if (seen.has(k)) continue;
      seen.add(k); out.push(r);
    }
    return out.slice(0, 6);
  }

  /* «City, UK» у open-meteo даёт пусто — повторяем по части до запятой (урок 08.09, ortus.js) */
  async function search(q) {
    let out = await lookup(q);
    if (!out.length && q.includes(',')) out = await lookup(q.split(',')[0].trim());
    return out;
  }

  input.addEventListener('input', () => {
    clearTimeout(timer);
    placeBound[w] = false; bumpVersion(); showEcho(); renderPreview();
    const q = input.value.trim();
    if (q.length < 2) { list.hidden = true; return; }
    timer = setTimeout(async () => {
      lastResults = await search(q);
      list.innerHTML = '';
      lastResults.forEach(res => {
        const div = document.createElement('div');
        div.className = 'cfg-suggest';
        div.textContent = [res.name, res.admin1, res.country].filter(Boolean).join(', ');
        div.addEventListener('mousedown', () => apply(res));   // mousedown раньше blur
        list.appendChild(div);
      });
      list.hidden = lastResults.length === 0;
    }, 250);
  });

  input.addEventListener('keydown', async e => {
    if (e.key !== 'Enter') return;
    e.preventDefault();
    const q = input.value.trim();
    if (!q || q === p.place) { list.hidden = true; return; }
    const res = lastResults.length ? lastResults : await search(q);
    if (res.length) apply(preferred(res));
  });

  /* blur: автопривязка набранного (гонка blur/click решена флагом appliedAt + 250 мс) */
  input.addEventListener('blur', () => {
    const left = Date.now();
    setTimeout(async () => {
      if (appliedAt > left) return;
      const q = input.value.trim();
      if (!q || q === p.place) return;
      const res = lastResults.length ? lastResults : await search(q);
      if (res.length) apply(preferred(res));
    }, 250);
  });

  document.addEventListener('click', e => {
    if (!list.contains(e.target) && e.target !== input) list.hidden = true;
  });
  return showEcho;
}

/* ── гейт-сводка перед оплатой: всегда, одно нажатие ── */
let gateBox = null;

/* ═══ ХРАНИЛИЩЕ ДИЗАЙНОВ: подтверждённая версия формы → ID → оплата ═══
   Проект: platform/DESIGN_STORE_SPEC.md. Близнецы блока — ortus.js и family.js.
   ⛔МОЛЧАЛИВОГО ОТКАТА НА СТАРЫЙ ЧЕКАУТ НЕТ: у пары его никогда и не было — оба человека
   помещаются только в записи дизайна. Ошибка проверки возвращает к исправлению данных,
   сбой — предлагает повторить. */
let designInFlight = false;
let formVersion = 0;                 // ⚠️растёт на КАЖДОЕ изменение формы
let problemBox = null;

function bumpVersion() {
  formVersion++;
  attemptId = null;   // ①изменили данные — попытка новая
  saveAttempt();      //   и из черновика её тоже убираем
}
let attemptId = null;
const EXPIRED_MSG = {
  design_expired:
    'This order waited too long, so we cleared the saved copy. Everything you typed is still here — press the button again to confirm it and we will open a fresh checkout.',
  attempt_expired:
    'This order waited too long to be paid. Everything you typed is still here — press the button again to confirm it and we will open a fresh checkout.',
  checkout_expired:
    'Your checkout window has closed. Everything you typed is still here — press the button again to confirm it and we will open a fresh checkout.',
  already_paid:
    'This order has already been paid. Check your inbox for the confirmation — if it is not there, reply to us and we will sort it out.',
  not_on_sale:
    'This print is not on sale just yet. Nothing has been charged — please check back shortly.',
};

function newAttempt() {
  const t = Math.floor(Date.now() / 1000).toString(36).padStart(8, '0');
  const r = crypto.getRandomValues(new Uint8Array(10));
  return 'a_' + t + [...r].map(b => b.toString(36).padStart(2, '0')).join('');
}

function showProblem(text) {
  const anchor = document.getElementById('cp-buy');
  if (!problemBox) {
    problemBox = document.createElement('p');
    problemBox.className = 'cfg-note';
    problemBox.style.color = '#e0a94a';
    anchor.insertAdjacentElement('afterend', problemBox);
  }
  problemBox.textContent = text;
  problemBox.hidden = false;
  problemBox.scrollIntoView({ behavior: 'smooth', block: 'center' });
}
function clearProblem() { if (problemBox) problemBox.hidden = true; }

const DRAFT_KEY = 'ortus_couple_draft';
function saveDraft() {
  try { sessionStorage.setItem(DRAFT_KEY, JSON.stringify({ ...state, bound: { ...placeBound }, _at: Date.now() })); } catch (e) {}
}
/* Срок годности черновика внутри вкладки — очистка ПРИ ЧТЕНИИ, гарантию даёт sessionStorage
   (умирает с вкладкой) и очистка на thank-you после заказа. */
const DRAFT_TTL_MS = 24 * 3600 * 1000;

function restoreDraft() {
  try {
    const d = JSON.parse(sessionStorage.getItem(DRAFT_KEY) || 'null');
    if (!d) return false;
    if (!d._at || Date.now() - d._at > DRAFT_TTL_MS) {
      sessionStorage.removeItem(DRAFT_KEY);
      return false;
    }
    const bound = d.bound || {};
    delete d._at; delete d.bound;
    WHO.forEach(w => { if (d[w]) Object.assign(state[w], d[w]); delete d[w]; });
    Object.assign(state, d);
    /* ⚠️место считается привязанным только если в черновике есть КООРДИНАТЫ */
    WHO.forEach(w => { placeBound[w] = !!(bound[w] && state[w].lat != null && state[w].lon != null && state[w].place); });
    return true;
  } catch (e) { return false; }
}
/* ⛔ПОПЫТКА ПЕРЕЖИВАЕТ ПЕРЕЗАГРУЗКУ — лежит рядом с черновиком, тот же срок, та же очистка. */
const ATTEMPT_DRAFT_KEY = DRAFT_KEY + '_attempt';
function saveAttempt() {
  try {
    if (attemptId) sessionStorage.setItem(ATTEMPT_DRAFT_KEY, JSON.stringify({ a: attemptId, _at: Date.now() }));
    else sessionStorage.removeItem(ATTEMPT_DRAFT_KEY);
  } catch (e) {}
}
function restoreAttempt() {
  try {
    const d = JSON.parse(sessionStorage.getItem(ATTEMPT_DRAFT_KEY) || 'null');
    if (!d || !d.a || !d._at || Date.now() - d._at > DRAFT_TTL_MS) {
      sessionStorage.removeItem(ATTEMPT_DRAFT_KEY);
      return;
    }
    attemptId = d.a;
  } catch (e) {}
}

function memberPayload(w) {
  const p = state[w];
  return { name: p.name.trim(), date: p.dateStr, time: p.timeStr, tz_min: Math.round(p.tz * 60),
           place: { name: p.place, lat: p.lat, lon: p.lon } };
}
function designPayload() {
  return {
    attempt: attemptId,
    product: 'couple',
    design_code: designCode(),
    format: formatToken(),
    members: WHO.map(memberPayload),
  };
}

async function goToCheckout(btn) {
  if (designInFlight) return;                       // ②двойной клик не плодит переходы
  const myVersion = formVersion;                    // ③версия на момент подтверждения
  if (!attemptId) { attemptId = newAttempt(); saveAttempt(); }   // ①фиксируем ДО первого запроса
  designInFlight = true;
  clearProblem();
  const label = btn.textContent;
  btn.disabled = true;
  btn.textContent = 'Saving your design…';
  saveDraft();
  let res, data;
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 15000);
    res = await fetch('/api/design', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(designPayload()), signal: ctrl.signal,
    });
    clearTimeout(timer);
    data = await res.json().catch(() => ({}));
  } catch (e) {
    designInFlight = false; btn.disabled = false; btn.textContent = label;
    showProblem(e.name === 'AbortError'
      ? 'Saving your design took too long. Everything you typed is still here — press the button again.'
      : 'We could not reach our server. Everything you typed is still here — press the button again.');
    return;                                         // ④данные целы ⑤ссылки нет
  }
  designInFlight = false; btn.disabled = false; btn.textContent = label;

  if (myVersion !== formVersion) {
    showProblem('You changed something while we were saving. Check the details and press the button again.');
    return;
  }
  if (res.status === 410 || (res.status === 409 && data.error === 'already_paid')) {
    attemptId = null;
    saveAttempt();
    saveDraft();
    showProblem(EXPIRED_MSG[data.error] || EXPIRED_MSG.checkout_expired);
    return;
  }
  if (res.status === 503 && data.error === 'not_on_sale') {
    /* Price пары ещё не создан (design_store.ORTUS «TBD»): запись годная, продажи нет — честно говорим */
    showProblem(EXPIRED_MSG.not_on_sale);
    return;
  }
  if (!res.ok || !data.id || !data.payment_link) {
    showProblem(data && data.problems && data.problems.length
      ? data.problems.join(' · ')
      : 'We could not save your design, so we have not sent you to payment. Please try again.');
    return;
  }
  /* ⛔НИЧЕГО К ССЫЛКЕ НЕ ДОПИСЫВАЕМ: у серверной Checkout Session всё уже внутри сессии. */
  window.location.href = data.payment_link;
}

function humanWhen(p) {
  const when = new Date(p.dateStr + 'T' + p.timeStr).toLocaleString('en-GB',
    { day: 'numeric', month: 'long', year: 'numeric' });
  return `${when}, ${p.timeStr}`;
}

function confirmSummary(onKeep) {
  const anchor = document.getElementById('cp-buy');
  if (!gateBox) {
    gateBox = document.createElement('div');
    gateBox.className = 'cfg-gate';
    anchor.insertAdjacentElement('afterend', gateBox);
  }
  const esc = s => s.replace(/[<>&]/g, '');
  const line = w => {
    const p = state[w];
    return `<strong>${esc(p.name.trim())}</strong> — ${esc(p.place)}, ${humanWhen(p)}`;
  };
  gateBox.innerHTML =
    `Two charts, side by side: ${line('a')} · ${line('b')}. ` +
    'Every name, date, time and place right?' +
    '<div class="cfg-gate-row">' +
    '<button type="button" class="btn btn-copper g-keep">Yes — to the checkout</button>' +
    '<button type="button" class="btn btn-ghost g-change">Let me fix something</button></div>';
  gateBox.hidden = false;
  gateBox.querySelector('.g-keep').addEventListener('click', () => { gateBox.hidden = true; onKeep(); });
  gateBox.querySelector('.g-change').addEventListener('click', () => {
    gateBox.hidden = true;
    document.getElementById('cp-a-name').scrollIntoView({ behavior: 'smooth', block: 'center' });
  });
  gateBox.scrollIntoView({ behavior: 'smooth', block: 'center' });
}

/* первое незаполненное поле: имя или место любого из двоих — туда и ведём */
function firstGap() {
  for (const w of WHO) {
    if (!state[w].name.trim()) return { el: document.getElementById(`cp-${w}-name`), hint: 'A first name for each of you' };
    if (!placeBound[w]) return { el: document.getElementById(`cp-${w}-place`), hint: 'Birthplace first — the stars depend on it' };
  }
  return null;
}

function attachControls() {
  WHO.forEach(w => {
    const p = state[w];
    document.getElementById(`cp-${w}-date`).addEventListener('change', e => { if (e.target.value) { p.dateStr = e.target.value; refresh(); } });
    document.getElementById(`cp-${w}-time`).addEventListener('change', e => { if (e.target.value) { p.timeStr = e.target.value; refresh(); } });
    document.getElementById(`cp-${w}-name`).addEventListener('input', e => {
      p.name = e.target.value.slice(0, 24);
      bumpVersion();                 // ⚠️имя идёт мимо refresh() — версию поднимаем здесь
      renderPreview();
    });
  });

  const wireGroup = (sel, key, dataAttr) => document.querySelectorAll(sel).forEach(b =>
    b.addEventListener('click', () => {
      state[key] = b.dataset[dataAttr];
      document.querySelectorAll(sel).forEach(x => x.classList.toggle('active', x === b));
      refresh();
    }));
  wireGroup('#cp-themes .cfg-opt', 'theme', 'theme');
  wireGroup('#cp-formats .cfg-opt', 'frameType', 'frametype');
  wireGroup('#cp-sizes .cfg-opt', 'size', 'size');
  wireGroup('#cp-colors .cfg-opt', 'frameColor', 'color');

  document.getElementById('cp-buy').addEventListener('click', () => {
    /* 300 мс — даём blur-автопривязке места добежать (гонка из starmap.js) */
    setTimeout(() => {
      const gap = firstGap();
      if (gap) {
        gap.el.focus();
        gap.el.scrollIntoView({ behavior: 'smooth', block: 'center' });
        gap.el.placeholder = gap.hint;
        return;
      }
      confirmSummary(() => goToCheckout(document.getElementById('cp-buy')));
    }, 300);
  });
}

document.addEventListener('DOMContentLoaded', () => {
  document.getElementById('cp-themes').innerHTML = THEMES.map((t, i) =>
    `<button type="button" class="cfg-opt${i === 0 ? ' active' : ''}" data-theme="${t.id}">${t.label}</button>`).join('');
  document.getElementById('cp-formats').innerHTML =
    `<button type="button" class="cfg-opt active" data-frametype="print">Museum print <span class="f-price"></span></button>` +
    `<button type="button" class="cfg-opt" data-frametype="classic">Classic frame <span class="f-price"></span></button>`;
  document.getElementById('cp-sizes').innerHTML = SIZES.map(([v, l], i) =>
    `<button type="button" class="cfg-opt${i === 0 ? ' active' : ''}" data-size="${v}">${l}</button>`).join('');
  document.getElementById('cp-colors').innerHTML = COLORS.map(c =>
    `<button type="button" class="cfg-opt${c === 'gold' ? ' active' : ''}" data-color="${c}">${c[0].toUpperCase() + c.slice(1)}</button>`).join('');
  const echoes = {};
  WHO.forEach(w => { echoes[w] = attachGeocode(w); });
  attachControls();
  /* ⑥ВОЗВРАТ ИЗ STRIPE (или «назад») НЕ ДОЛЖЕН СТИРАТЬ ВВЕДЁННОЕ — двое людей, восемь полей. */
  restoreAttempt();     // ⚠️до восстановления формы: попытка принадлежит ИМЕННО этому черновику
  const set = (id, v) => { const el = document.getElementById(id); if (el && v != null) el.value = v; };
  if (restoreDraft()) {
    WHO.forEach(w => {
      const p = state[w];
      set(`cp-${w}-date`, p.dateStr); set(`cp-${w}-time`, p.timeStr);
      set(`cp-${w}-place`, p.place); set(`cp-${w}-name`, p.name);
    });
    syncActive();
  }
  attachPresets();
  const pv = document.getElementById('np-preview');
  if (pv && window.ResizeObserver) {
    let queued = false;
    new ResizeObserver(() => {
      if (queued) return;
      queued = true;
      requestAnimationFrame(() => { queued = false; applyPreviewFrame(); });
    }).observe(pv);
  }
  refresh();
  WHO.forEach(w => { if (placeBound[w]) echoes[w](); });
});
