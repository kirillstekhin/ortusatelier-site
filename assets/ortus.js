/* Ortus Atelier — конфигуратор натальной карты (03.09.2026).
   Родословная: site/assets/starmap.js (SKN) — геокод open-meteo (UK-first, там же IANA
   для Z-токена), сборка design-кода, переход в Stripe payment link с client_reference_id.
   Отличия от SKN: ①превью в браузере — порт печатного рендера (assets/natal-preview.js, 15.09.2026);
   письмо с превью ПЕЧАТНОГО файла до печати осталось — это обещание конвейера,
   экранное превью его не заменяет; ②гейт перед оплатой ВСЕГДА показывает
   сводку (дата+время+место+имя): у натальной три критичных поля против одного у SKN,
   один лишний клик дешевле напечатанного дефолта вместо места покупателя;
   ③FRAMED-яруса нет — Print и Classic (BFP снят с производства, петля 25.08). */

const PRICES = {
  print:   { '3040': 34.99, '4050': 39.99, '5070': 44.99 },
  classic: { '3040': 69.99, '4050': 79.99, '5070': 89.99 },
};

/* ⛔ТАБЛИЦА БОЕВЫХ PAYMENT LINKS УБРАНА 13.09.2026. Она уже не использовалась — адрес
   оплаты возвращает сервер, — но лежала в коде живыми ссылками. Мёртвый код с боевыми
   ссылками опаснее отсутствующего: любой откат «на прежнее поведение» молча увёл бы
   покупателя платить МИМО хранилища дизайнов, то есть без сохранённой персонализации.
   Старые оплаты по этим ссылкам по-прежнему обрабатываются — таблицей на СЕРВЕРЕ
   (`design_store.ORTUS['live']`, поле `link`), а не здесь. */

/* Темы = NT2-токены (fulfil.py THEME_TOKENS натальной). Порядок = галерея лендинга. */
const THEMES = [
  { id: 'copperbloom',  label: 'Copper bloom' },
  { id: 'goldcontrast', label: 'Gold · Midnight' },
  { id: 'gardenpaper',  label: 'Garden on paper' },
  { id: 'bimetal',      label: 'Gold & silver' },
];
const SIZES  = [['3040', '30×40 cm'], ['4050', '40×50 cm'], ['5070', '50×70 cm']];
const COLORS = ['black', 'gold', 'silver'];

const state = {
  dateStr: '1994-06-19', timeStr: '08:45',
  place: '', lat: null, lon: null, tz: 0, iana: 'UTC',
  name: '',
  theme: 'copperbloom', frameType: 'print', size: '3040', frameColor: 'gold',
};
let placeBound = false;          // человек привязал место (клик/автоприменение) — без этого не продаём

function formatToken() { return state.frameType.toUpperCase() + state.size; }

function tzOffsetHours(iana, dateStr, timeStr) {
  try {
    const [y, mo, d] = dateStr.split('-').map(Number);
    const [hh, mm] = timeStr.split(':').map(Number);
    const probe = new Date(Date.UTC(y, mo - 1, d, hh, mm));
    const part = new Intl.DateTimeFormat('en-US', { timeZone: iana, timeZoneName: 'shortOffset' })
      .formatToParts(probe).find(p => p.type === 'timeZoneName').value;
    const m = part.match(/GMT([+-]\d+)(?::(\d+))?/);
    if (!m) return 0;
    return parseInt(m[1], 10) + (m[2] ? Math.sign(parseInt(m[1], 10)) * parseInt(m[2], 10) / 60 : 0);
  } catch (e) { return state.lon ? Math.round(state.lon / 15) : 0; }
}

function designCode() {
  const d = state.dateStr.replace(/-/g, '');
  const t = state.timeStr.replace(':', '');
  const la = (state.lat >= 0 ? 'N' : 'S') + Math.abs(Math.round(state.lat * 10000));
  const lo = (state.lon >= 0 ? 'E' : 'W') + Math.abs(Math.round(state.lon * 10000));
  const z = 'Z' + Math.round(state.tz * 60);
  const frame = state.frameType === 'classic' ? state.frameColor.toUpperCase() : 'NONE';
  return `NT2-${d}-${t}-${la}-${lo}-${z}-${state.theme.toUpperCase()}-${formatToken()}-${frame}`;
}

function price() { return PRICES[state.frameType][state.size]; }

function refresh() {
  /* ⚠️Любое изменение формы поднимает версию: ответ сервера на СТАРУЮ версию не должен
     открывать чекаут. Сюда приходят дата, время, тема, формат, размер, цвет и место. */
  bumpVersion();
  state.tz = tzOffsetHours(state.iana, state.dateStr, state.timeStr);
  const p = `£${price().toFixed(2)}`;
  document.getElementById('ns-price').textContent = p;
  document.getElementById('ns-buy').textContent = `Create my chart — ${p}`;
  document.getElementById('ns-colors').hidden = state.frameType !== 'classic';
  document.querySelectorAll('#ns-formats .cfg-opt').forEach(b =>
    b.querySelector('.f-price').textContent = `£${PRICES[b.dataset.frametype][state.size].toFixed(2)}`);
  renderPreview();
}

/* ── живое превью листа (assets/natal-preview.js — порт печатного рендера) ──
   ⚠️До привязки места небо считается над Лондоном, но на листе вместо места плейсхолдер,
   а координат и знака асцендента нет: чужое место не должно выглядеть как выбранное. */
const PREVIEW_FALLBACK = { lat: 51.5074, lon: -0.1278, iana: 'Europe/London' };
function renderPreview() {
  if (!window.OrtusNatal) return;
  const bound = placeBound && state.lat != null && state.lon != null;
  window.OrtusNatal.show({
    dateStr: state.dateStr, timeStr: state.timeStr,
    lat: bound ? state.lat : PREVIEW_FALLBACK.lat,
    lon: bound ? state.lon : PREVIEW_FALLBACK.lon,
    tz: bound ? state.tz : tzOffsetHours(PREVIEW_FALLBACK.iana, state.dateStr, state.timeStr),
    place: state.place, placeBound: bound, name: state.name,
    theme: state.theme, frameType: state.frameType, size: state.size,
  });
}

/* ── место: open-meteo, UK-выдача первой (урок 14.08: в общей выдаче британского места может не быть вовсе), IANA из результата ── */
function attachGeocode() {
  const input = document.getElementById('ns-place');
  const list = document.getElementById('ns-place-list');
  const echo = document.getElementById('ns-place-echo');
  let timer = null, lastResults = [], appliedAt = 0;

  function showEcho() {
    if (!placeBound) { echo.textContent = ''; return; }
    echo.textContent = '✦ ' + state.place +
      '  ·  ' + Math.abs(state.lat).toFixed(4) + (state.lat >= 0 ? '°N ' : '°S ') +
      Math.abs(state.lon).toFixed(4) + (state.lon >= 0 ? '°E' : '°W');
  }

  function apply(res) {
    state.place = [res.name, res.country].filter(Boolean).join(', ');
    state.lat = res.latitude; state.lon = res.longitude;
    state.iana = res.timezone || 'UTC';
    input.value = state.place;
    list.hidden = true;
    appliedAt = Date.now();
    placeBound = true;
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

  /* ⚠ «CITY, UK» ЛОМАЛ ПРИВЯЗКУ (08.09.2026, найдено прогоном прода). open-meteo ищет по
     имени места: «York, UK», «Bristol, UK» → ПУСТО («London, England» — находит).
     Плейсхолдер сам подсказывает «City, country», и самый естественный британский ввод
     молча оставлял место непривязанным → «Birthplace first», продажи нет. Нет выдачи —
     повторяем по части до запятой; UK-first в lookup сам ставит британский вариант первым.
     Тот же фикс в starmap.js (SKN). */
  async function search(q) {
    let out = await lookup(q);
    if (!out.length && q.includes(',')) out = await lookup(q.split(',')[0].trim());
    return out;
  }

  input.addEventListener('input', () => {
    clearTimeout(timer);
    placeBound = false; bumpVersion(); showEcho();
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
    if (!q || q === state.place) { list.hidden = true; return; }
    const res = lastResults.length ? lastResults : await search(q);
    if (res.length) apply(preferred(res));
  });

  /* blur: автопривязка набранного, как в SKN (см. starmap.js — гонка blur/click решена
     флагом appliedAt + 250 мс) */
  input.addEventListener('blur', () => {
    const left = Date.now();
    setTimeout(async () => {
      if (appliedAt > left) return;
      const q = input.value.trim();
      if (!q || q === state.place) return;
      const res = lastResults.length ? lastResults : await search(q);
      if (res.length) apply(preferred(res));
    }, 250);
  });

  document.addEventListener('click', e => {
    if (!list.contains(e.target) && e.target !== input) list.hidden = true;
  });
}

/* ── гейт-сводка перед оплатой: всегда, одно нажатие ── */
let gateBox = null;

/* ═══ ХРАНИЛИЩЕ ДИЗАЙНОВ: подтверждённая версия формы → ID → оплата ═══
   Проект: platform/DESIGN_STORE_SPEC.md. Близнец этого блока живёт в family.js —
   ⚠️правки держать синхронными, как у starmap.js/moon.js.

   ⛔ЗАЧЕМ. Покупатель вводил место и имя ВТОРОЙ раз на странице оплаты: Payment Links не
   умеют предзаполнять custom fields, а в client_reference_id персонализация не влезает.
   Теперь форма сохраняет дизайн на сервере и уходит по ссылке, которую вернул сервер.

   ⛔МОЛЧАЛИВОГО ОТКАТА НА СТАРЫЙ ЧЕКАУТ НЕТ. Ошибка проверки возвращает к исправлению
   данных, сбой — предлагает повторить. Уйти платить по старой ссылке «как раньше» нельзя:
   тогда персонализация не сохранится, а покупатель об этом не узнает. */
let designInFlight = false;
let formVersion = 0;                 // ⚠️растёт на КАЖДОЕ изменение формы
let problemBox = null;

function bumpVersion() {
  formVersion++;
  attemptId = null;   // ①изменили данные — попытка новая
  saveAttempt();      //   и из черновика её тоже убираем
}
/* ①ИДЕНТИФИКАТОР ПОПЫТКИ. Фиксируется ДО первого запроса и держится неизменным при
   повторах — иначе каждый повтор создавал бы новый дизайн, у каждого дубля был бы свой
   ключ идемпотентности, и защиты от дублей не было бы вовсе.
   ⛔Сбрасывается на ЛЮБОМ изменении персонализации (см. bumpVersion): изменили данные —
   это другая покупка, и сессия у неё должна быть своя. */
let attemptId = null;
/* ⛔МЕТКА ВРЕМЕНИ ВНУТРИ ИДЕНТИФИКАТОРА. Сервер обязан уметь отбить протухшую попытку
   даже когда её записи в хранилище уже нет, — значит срок надо нести с собой.
   `a_` + 8 символов base36 (секунды) + 20 случайных. Формат сверяется с ATTEMPT_RE. */
const EXPIRED_MSG = {
  design_expired:
    'This order waited too long, so we cleared the saved copy. Everything you typed is still here — press the button again to confirm it and we will open a fresh checkout.',
  attempt_expired:
    'This order waited too long to be paid. Everything you typed is still here — press the button again to confirm it and we will open a fresh checkout.',
  checkout_expired:
    'Your checkout window has closed. Everything you typed is still here — press the button again to confirm it and we will open a fresh checkout.',
  already_paid:
    'This order has already been paid. Check your inbox for the confirmation — if it is not there, reply to us and we will sort it out.',
};

function newAttempt() {
  const t = Math.floor(Date.now() / 1000).toString(36).padStart(8, '0');
  const r = crypto.getRandomValues(new Uint8Array(10));
  return 'a_' + t + [...r].map(b => b.toString(36).padStart(2, '0')).join('');
}


function showProblem(text) {
  const anchor = document.getElementById('ns-buy');
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

const DRAFT_KEY = 'ortus_natal_draft';
function saveDraft() {
  try { sessionStorage.setItem(DRAFT_KEY, JSON.stringify({ ...state, _at: Date.now() })); } catch (e) {}
}
/* Срок годности черновика внутри вкладки.
   ⚠️ФОРМУЛИРОВКА ТОЧНАЯ: очистка происходит ПРИ ЧТЕНИИ. Значит просроченный черновик
   удаляется при следующем заходе на страницу, а НЕ ровно через 24 часа сам по себе.
   Если вкладку не открывать, данные лежат до её закрытия. Гарантию даёт только
   sessionStorage (умирает с вкладкой) и очистка на thank-you после заказа. */
const DRAFT_TTL_MS = 24 * 3600 * 1000;

function restoreDraft() {
  /* ⚠️Чтобы возврат из Stripe (или «назад») не стирал введённое. */
  try {
    const d = JSON.parse(sessionStorage.getItem(DRAFT_KEY) || 'null');
    if (!d) return false;
    if (!d._at || Date.now() - d._at > DRAFT_TTL_MS) {   /* просрочен — стираем, не поднимаем */
      sessionStorage.removeItem(DRAFT_KEY);
      return false;
    }
    delete d._at;
    Object.assign(state, d);
    return true;
  } catch (e) { return false; }
}
/* ⛔ПОПЫТКА ПЕРЕЖИВАЕТ ПЕРЕЗАГРУЗКУ (правка 13.09.2026 после аудита юзера). Раньше
   `attemptId` жил только в памяти вкладки: после потерянного ответа и F5 повтор заводил
   НОВУЮ попытку, хотя сессия по прежней уже могла существовать — и покупатель получал
   вторую оплату за тот же заказ. Теперь попытка лежит рядом с черновиком: тот же срок,
   та же очистка. Смена персонализации (`bumpVersion`) по-прежнему её сбрасывает. */
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

function designPayload() {
  return {
    attempt: attemptId,
    product: 'natal',
    design_code: designCode(),
    format: formatToken(),
    place: { name: state.place, lat: state.lat, lon: state.lon },
    dedication: state.name || null,
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
    /* ③пока шёл запрос, форму изменили — ответ относится к СТАРОЙ версии, чекаут не открываем */
    showProblem('You changed something while we were saving. Check the details and press the button again.');
    return;
  }
  if (res.status === 410 || (res.status === 409 && data.error === 'already_paid')) {
    /* ⛔СРОК ВЫШЕЛ — И НИКАКОГО АВТОМАТИЧЕСКОГО ПЕРЕХОДА К ОПЛАТЕ. Попытку обнуляем, но
       новую НЕ заводим: она появится только когда покупатель подтвердит форму заново
       (`goToCheckout` заводит её сам). Введённое остаётся и сохраняется в черновике —
       ничего перенабирать не нужно. */
    attemptId = null;
    saveAttempt();
    saveDraft();
    showProblem(EXPIRED_MSG[data.error] || EXPIRED_MSG.checkout_expired);
    return;
  }
  if (!res.ok || !data.id || !data.payment_link) {
    showProblem(data && data.problems && data.problems.length
      ? data.problems.join(' · ')
      : 'We could not save your design, so we have not sent you to payment. Please try again.');
    return;
  }
  /* ⛔НИЧЕГО К ССЫЛКЕ НЕ ДОПИСЫВАЕМ. При Payment Links сюда подставлялся
     `?client_reference_id=…` — у серверной Checkout Session он уже внутри сессии, а сам
     URL заканчивается #фрагментом: приписанный ПОСЛЕ решётки запрос в него и попадёт. */
  window.location.href = data.payment_link;
}

function confirmSummary(onKeep) {
  const anchor = document.getElementById('ns-buy');
  if (!gateBox) {
    gateBox = document.createElement('div');
    gateBox.className = 'cfg-gate';
    anchor.insertAdjacentElement('afterend', gateBox);
  }
  const when = new Date(state.dateStr + 'T' + state.timeStr).toLocaleString('en-GB',
    { day: 'numeric', month: 'long', year: 'numeric' });
  gateBox.innerHTML =
    `The chart will be drawn for <strong>${when}, ${state.timeStr}</strong> — ` +
    `<strong>${state.place}</strong>` +
    (state.name ? `, titled “<strong>${state.name.replace(/[<>&]/g, '')}</strong>”` : ', with no name on it') +
    '. Every detail right?' +
    '<div class="cfg-gate-row">' +
    '<button type="button" class="btn btn-copper g-keep">Yes — to the checkout</button>' +
    '<button type="button" class="btn btn-ghost g-change">Let me fix something</button></div>';
  gateBox.hidden = false;
  gateBox.querySelector('.g-keep').addEventListener('click', () => { gateBox.hidden = true; onKeep(); });
  gateBox.querySelector('.g-change').addEventListener('click', () => {
    gateBox.hidden = true;
    document.getElementById('ns-date').scrollIntoView({ behavior: 'smooth', block: 'center' });
  });
  gateBox.scrollIntoView({ behavior: 'smooth', block: 'center' });
}

function attachControls() {
  document.getElementById('ns-date').addEventListener('change', e => { if (e.target.value) { state.dateStr = e.target.value; refresh(); } });
  document.getElementById('ns-time').addEventListener('change', e => { if (e.target.value) { state.timeStr = e.target.value; refresh(); } });
  document.getElementById('ns-name').addEventListener('input', e => {
    state.name = e.target.value.slice(0, 40);
    bumpVersion();                 // ⚠️имя идёт мимо refresh() — версию поднимаем здесь
    renderPreview();
  });

  const wireGroup = (sel, key, dataAttr) => document.querySelectorAll(sel).forEach(b =>
    b.addEventListener('click', () => {
      state[key] = b.dataset[dataAttr];
      document.querySelectorAll(sel).forEach(x => x.classList.toggle('active', x === b));
      refresh();
    }));
  wireGroup('#ns-themes .cfg-opt', 'theme', 'theme');
  wireGroup('#ns-formats .cfg-opt', 'frameType', 'frametype');
  wireGroup('#ns-sizes .cfg-opt', 'size', 'size');
  wireGroup('#ns-colors .cfg-opt', 'frameColor', 'color');

  document.getElementById('ns-buy').addEventListener('click', () => {
    /* 300 мс — даём blur-автопривязке места добежать (гонка из starmap.js) */
    setTimeout(() => {
      if (!placeBound) {
        const input = document.getElementById('ns-place');
        input.focus();
        input.scrollIntoView({ behavior: 'smooth', block: 'center' });
        input.placeholder = 'Birthplace first — the stars depend on it';
        return;
      }
      confirmSummary(() => goToCheckout(document.getElementById('ns-buy')));
    }, 300);
  });
}

document.addEventListener('DOMContentLoaded', () => {
  /* кнопки-опции генерим из констант — одна точка правды */
  document.getElementById('ns-themes').innerHTML = THEMES.map((t, i) =>
    `<button type="button" class="cfg-opt${i === 0 ? ' active' : ''}" data-theme="${t.id}">${t.label}</button>`).join('');
  document.getElementById('ns-formats').innerHTML =
    `<button type="button" class="cfg-opt active" data-frametype="print">Museum print <span class="f-price"></span></button>` +
    `<button type="button" class="cfg-opt" data-frametype="classic">Classic frame <span class="f-price"></span></button>`;
  document.getElementById('ns-sizes').innerHTML = SIZES.map(([v, l], i) =>
    `<button type="button" class="cfg-opt${i === 0 ? ' active' : ''}" data-size="${v}">${l}</button>`).join('');
  document.getElementById('ns-colors').innerHTML = COLORS.map(c =>
    `<button type="button" class="cfg-opt${c === 'gold' ? ' active' : ''}" data-color="${c}">${c[0].toUpperCase() + c.slice(1)}</button>`).join('');
  attachGeocode();
  attachControls();
  /* ⑥ВОЗВРАТ ИЗ STRIPE (или «назад») НЕ ДОЛЖЕН СТИРАТЬ ВВЕДЁННОЕ. Черновик кладётся
     в sessionStorage перед уходом на оплату и поднимается здесь. ⚠️Место считается
     привязанным только если в черновике есть КООРДИНАТЫ — иначе гейт места попросит
     подтвердить заново, и правильно: название без координат ничего не гарантирует. */
  restoreAttempt();     // ⚠️до восстановления формы: попытка принадлежит ИМЕННО этому черновику
  if (restoreDraft()) {
    const set = (id, v) => { const el = document.getElementById(id); if (el && v != null) el.value = v; };
    set('ns-date', state.dateStr); set('ns-time', state.timeStr);
    set('ns-place', state.place); set('ns-name', state.name);
    placeBound = !!(state.lat != null && state.lon != null && state.place);
    ['#ns-themes .cfg-opt|theme|theme', '#ns-formats .cfg-opt|frameType|frametype',
     '#ns-sizes .cfg-opt|size|size', '#ns-colors .cfg-opt|frameColor|color'].forEach(spec => {
      const [sel, key, attr] = spec.split('|');
      document.querySelectorAll(sel).forEach(b =>
        b.classList.toggle('active', b.dataset[attr] === String(state[key])));
    });
  }
  refresh();
  if (placeBound) showEcho();
});
