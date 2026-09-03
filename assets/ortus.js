/* Ortus Atelier — конфигуратор натальной карты (03.09.2026).
   Родословная: site/assets/starmap.js (SKN) — геокод open-meteo (UK-first, там же IANA
   для Z-токена), сборка design-кода, переход в Stripe payment link с client_reference_id.
   Отличия от SKN: ①превью в браузере НЕТ (рендерер натальной — Python, «preview by email
   before we print» — честное обещание конвейера); ②гейт перед оплатой ВСЕГДА показывает
   сводку (дата+время+место+имя): у натальной три критичных поля против одного у SKN,
   один лишний клик дешевле напечатанного дефолта (класс Emily ord_14413913);
   ③FRAMED-яруса нет — Print и Classic (BFP снят с производства, петля 25.08). */

const PRICES = {
  print:   { '3040': 34.99, '4050': 39.99, '5070': 44.99 },
  classic: { '3040': 69.99, '4050': 79.99, '5070': 89.99 },
};

/* platform/natal/stripe_links.json (root@e298b0e) — 6 live-линков ключа ortus-setup. */
const PAYMENT_LINKS = {
  PRINT3040:   'https://buy.stripe.com/14AbJ24AKfyJan1dW07g40i',
  PRINT4050:   'https://buy.stripe.com/28E9AU5EO72d8eTdW07g40j',
  PRINT5070:   'https://buy.stripe.com/eVqdRaaZ84U59iX6ty7g40k',
  CLASSIC3040: 'https://buy.stripe.com/aFa14ogjs86hgLpdW07g40l',
  CLASSIC4050: 'https://buy.stripe.com/00wbJ27MWaep0Mr2di7g40m',
  CLASSIC5070: 'https://buy.stripe.com/3cI00kc3cbit3YDf047g40n',
};

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
  state.tz = tzOffsetHours(state.iana, state.dateStr, state.timeStr);
  const p = `£${price().toFixed(2)}`;
  document.getElementById('ns-price').textContent = p;
  document.getElementById('ns-buy').textContent = `Create my chart — ${p}`;
  document.getElementById('ns-colors').hidden = state.frameType !== 'classic';
  document.querySelectorAll('#ns-formats .cfg-opt').forEach(b =>
    b.querySelector('.f-price').textContent = `£${PRICES[b.dataset.frametype][state.size].toFixed(2)}`);
}

/* ── место: open-meteo, UK-выдача первой (урок Berwick 14.08), IANA из результата ── */
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

  async function search(q) {
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

  input.addEventListener('input', () => {
    clearTimeout(timer);
    placeBound = false; showEcho();
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
  document.getElementById('ns-name').addEventListener('input', e => { state.name = e.target.value.slice(0, 40); });

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
      confirmSummary(() => {
        const link = PAYMENT_LINKS[formatToken()];
        const code = designCode();
        window.location.href = `${link}?client_reference_id=${encodeURIComponent(code)}`;
      });
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
  refresh();
});
