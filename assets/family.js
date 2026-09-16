/* Ortus Atelier — конфигуратор family constellations (04.09.2026).
   Родословная: ortus.js. Особенность продукта: члены семьи (2–6 имён с датами) НЕ влезают
   в design-код. ⚠️ШАПКА ПЕРЕПИСАНА 13.09.2026: раньше источником истины было Stripe-поле
   «members», которое покупатель заполнял НА ЧЕКАУТЕ, а конфигуратор клал строку в буфер.
   Теперь персонализация уходит на сервер ДО оплаты и хранится в записи дизайна; поля на
   чекауте нет вовсе. `familyLine()` остался — он показывает сводку перед подтверждением. */

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

const THEMES = [
  { id: 'coppernight', label: 'Copper night' },
  { id: 'sknnight',    label: 'Midnight' },
  { id: 'paper',       label: 'Paper' },
];
const SIZES  = [['3040', '30×40 cm'], ['4050', '40×50 cm'], ['5070', '50×70 cm']];
const COLORS = ['black', 'gold', 'silver'];

const state = { theme: 'coppernight', frameType: 'print', size: '3040', frameColor: 'gold' };

function formatToken() { return state.frameType.toUpperCase() + state.size; }

function designCode() {
  const frame = state.frameType === 'classic' ? state.frameColor.toUpperCase() : 'NONE';
  return `FC2-00000000-0000-N0-E0-Z0-${state.theme.toUpperCase()}-${formatToken()}-${frame}`;
}

function price() { return PRICES[state.frameType][state.size]; }

function readMembers() {
  const rows = [...document.querySelectorAll('#fc-members .mrow')];
  const out = [], bad = [];
  rows.forEach(r => {
    const name = r.querySelector('.m-name').value.trim();
    const date = r.querySelector('.m-date').value;   // YYYY-MM-DD
    if (!name && !date) return;                      // пустая строка — игнор
    if (!name || !date) { bad.push(r); return; }
    const [y, mo, d] = date.split('-');
    out.push({ name, line: `${name} ${d}/${mo}/${y}` });
  });
  return { out, bad };
}

function familyLine() { return readMembers().out.map(m => m.line).join('; '); }

function refresh() {
  bumpVersion();          // ⚠️любое изменение формы поднимает версию
  const p = `£${price().toFixed(2)}`;
  document.getElementById('fc-price').textContent = p;
  document.getElementById('fc-buy').textContent = `Create our sky — ${p}`;
  document.getElementById('fc-colors').hidden = state.frameType !== 'classic';
  document.querySelectorAll('#fc-formats .cfg-opt').forEach(b =>
    b.querySelector('.f-price').textContent = `£${PRICES[b.dataset.frametype][state.size].toFixed(2)}`);
}

function addRow(name = '', date = '') {
  const box = document.getElementById('fc-members');
  if (box.children.length >= 6) return;
  const row = document.createElement('div');
  row.className = 'mrow';
  row.innerHTML =
    `<input class="m-name" type="text" maxlength="24" placeholder="First name" value="${name}">` +
    `<input class="m-date" type="date" value="${date}">` +
    `<button type="button" class="rm" title="Remove">×</button>`;
  row.querySelector('.rm').addEventListener('click', () => {
    if (box.children.length > 2) { row.remove(); bumpVersion(); }
  });
  /* ⚠️Имена и даты участников идут МИМО refresh() — версию поднимаем здесь, иначе
     правка участника во время запроса осталась бы незамеченной и чекаут открылся бы
     на старом составе семьи. */
  row.querySelectorAll('.m-name, .m-date').forEach(i =>
    i.addEventListener('input', bumpVersion));
  box.appendChild(row);
}

let gateBox = null;

/* ═══ ХРАНИЛИЩЕ ДИЗАЙНОВ: подтверждённая версия формы → ID → оплата ═══
   ⚠️БЛИЗНЕЦ блока в ortus.js — правки держать синхронными.
   ⛔Для Family это важнее, чем для натальной: участники и их даты НЕ помещаются в
   design-код и раньше набирались в поле Stripe ВТОРОЙ раз целиком.
   ⛔Молчаливого отката на старый чекаут нет: уйти платить «как раньше» значит потерять
   персонализацию так, что покупатель об этом не узнает. */
let designInFlight = false;
let formVersion = 0;
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
  const anchor = document.getElementById('fc-buy');
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

const DRAFT_KEY = 'ortus_family_draft';
function saveDraft() {
  try {
    sessionStorage.setItem(DRAFT_KEY, JSON.stringify({
      _at: Date.now(),
      state,
      family: document.getElementById('fc-family').value,
      rows: [...document.querySelectorAll('#fc-members .mrow')].map(r => ({
        name: r.querySelector('.m-name').value, date: r.querySelector('.m-date').value })),
    }));
  } catch (e) {}
}
/* Срок годности черновика внутри вкладки.
   ⚠️ФОРМУЛИРОВКА ТОЧНАЯ: очистка происходит ПРИ ЧТЕНИИ. Значит просроченный черновик
   удаляется при следующем заходе на страницу, а НЕ ровно через 24 часа сам по себе.
   Если вкладку не открывать, данные лежат до её закрытия. Гарантию даёт только
   sessionStorage (умирает с вкладкой) и очистка на thank-you после заказа. */
const DRAFT_TTL_MS = 24 * 3600 * 1000;

function restoreDraft() {
  try {
    const d = JSON.parse(sessionStorage.getItem(DRAFT_KEY) || 'null');
    if (!d) return null;
    if (!d._at || Date.now() - d._at > DRAFT_TTL_MS) {   /* просрочен — стираем, не поднимаем */
      sessionStorage.removeItem(DRAFT_KEY);
      return null;
    }
    Object.assign(state, d.state || {});
    return d;
  } catch (e) { return null; }
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

function designPayload(fam) {
  const members = [...document.querySelectorAll('#fc-members .mrow')].map(r => ({
    name: r.querySelector('.m-name').value.trim(),
    date: r.querySelector('.m-date').value,
  })).filter(m => m.name && m.date);
  return { attempt: attemptId, product: 'family', design_code: designCode(), format: formatToken(),
           dedication: fam || null, members };
}

async function goToCheckout(btn, fam) {
  if (designInFlight) return;                       // ②двойной клик
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
      body: JSON.stringify(designPayload(fam)), signal: ctrl.signal,
    });
    clearTimeout(timer);
    data = await res.json().catch(() => ({}));
  } catch (e) {
    designInFlight = false; btn.disabled = false; btn.textContent = label;
    showProblem(e.name === 'AbortError'
      ? 'Saving your design took too long. Everyone you added is still here — press the button again.'
      : 'We could not reach our server. Everyone you added is still here — press the button again.');
    return;                                         // ④данные целы ⑤ссылки нет
  }
  designInFlight = false; btn.disabled = false; btn.textContent = label;

  if (myVersion !== formVersion) {
    showProblem('You changed something while we were saving. Check the family and press the button again.');
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

function confirmSummary(members, onKeep) {
  const anchor = document.getElementById('fc-buy');
  if (!gateBox) {
    gateBox = document.createElement('div');
    gateBox.className = 'cfg-gate';
    anchor.insertAdjacentElement('afterend', gateBox);
  }
  const fam = document.getElementById('fc-family').value.trim() || 'Our Family';
  const esc = s => s.replace(/[<>&]/g, '');
  gateBox.innerHTML =
    `<strong>${esc(fam)}</strong> — ${members.out.length} of you:` +
    `<code>${esc(familyLine())}</code>` +
    /* ⛔ТЕКСТ ПЕРЕПИСАН 13.09.2026. Раньше здесь стояло «на оплате одно поле просит эту же
       строку — мы скопировали её в буфер, вставьте туда»: так работали Payment Links, где
       покупатель вводил семью ВТОРОЙ раз руками. Теперь персонализация уходит на сервер до
       оплаты, и никакого поля на чекауте нет — прогон через форму показал у сессии ноль
       custom_fields. Старый текст отправлял бы покупателя искать несуществующее поле. */
    'We have saved this exactly as written — nothing to retype at checkout. ' +
    'Every name and birthday right?' +
    '<div class="cfg-gate-row">' +
    '<button type="button" class="btn btn-copper g-keep">Yes — to the checkout</button>' +
    '<button type="button" class="btn btn-ghost g-change">Let me fix something</button></div>';
  gateBox.hidden = false;
  gateBox.querySelector('.g-keep').addEventListener('click', () => { gateBox.hidden = true; onKeep(fam); });
  gateBox.querySelector('.g-change').addEventListener('click', () => {
    gateBox.hidden = true;
    document.getElementById('fc-members').scrollIntoView({ behavior: 'smooth', block: 'center' });
  });
  gateBox.scrollIntoView({ behavior: 'smooth', block: 'center' });
}

function attachControls() {
  const wireGroup = (sel, key, dataAttr) => document.querySelectorAll(sel).forEach(b =>
    b.addEventListener('click', () => {
      state[key] = b.dataset[dataAttr];
      document.querySelectorAll(sel).forEach(x => x.classList.toggle('active', x === b));
      refresh();
    }));
  wireGroup('#fc-themes .cfg-opt', 'theme', 'theme');
  wireGroup('#fc-formats .cfg-opt', 'frameType', 'frametype');
  wireGroup('#fc-sizes .cfg-opt', 'size', 'size');
  wireGroup('#fc-colors .cfg-opt', 'frameColor', 'color');

  document.getElementById('fc-add').addEventListener('click', () => addRow());

  document.getElementById('fc-buy').addEventListener('click', () => {
    const members = readMembers();
    if (members.bad.length) {
      members.bad[0].scrollIntoView({ behavior: 'smooth', block: 'center' });
      members.bad[0].querySelector('.m-name').focus();
      return;
    }
    if (members.out.length < 2) {
      const box = document.getElementById('fc-members');
      box.scrollIntoView({ behavior: 'smooth', block: 'center' });
      box.querySelector('.m-name').focus();
      return;
    }
    confirmSummary(members, fam => {
      /* ⛔БУФЕР ОБМЕНА БОЛЬШЕ НЕ ТРОГАЕМ. Копирование строки семьи было нужно, пока её
         приходилось вставлять в поле Stripe. Поля нет — значит это просто затирание
         чужого буфера без всякой причины.
         ⛔Ссылку выбирает СЕРВЕР по доверенной сетке. Браузер не решает, за сколько платить. */
      goToCheckout(document.getElementById('fc-buy'), fam);
    });
  });
}

document.addEventListener('DOMContentLoaded', () => {
  document.getElementById('fc-themes').innerHTML = THEMES.map((t, i) =>
    `<button type="button" class="cfg-opt${i === 0 ? ' active' : ''}" data-theme="${t.id}">${t.label}</button>`).join('');
  document.getElementById('fc-formats').innerHTML =
    `<button type="button" class="cfg-opt active" data-frametype="print">Museum print <span class="f-price"></span></button>` +
    `<button type="button" class="cfg-opt" data-frametype="classic">Classic frame <span class="f-price"></span></button>`;
  document.getElementById('fc-sizes').innerHTML = SIZES.map(([v, l], i) =>
    `<button type="button" class="cfg-opt${i === 0 ? ' active' : ''}" data-size="${v}">${l}</button>`).join('');
  document.getElementById('fc-colors').innerHTML = COLORS.map(c =>
    `<button type="button" class="cfg-opt${c === 'gold' ? ' active' : ''}" data-color="${c}">${c[0].toUpperCase() + c.slice(1)}</button>`).join('');
  /* ⑥ВОЗВРАТ ИЗ STRIPE (или «назад») НЕ ДОЛЖЕН СТИРАТЬ СЕМЬЮ. Для Family это дороже
     всего: заново вводить шесть имён с датами — ровно та боль, ради которой всё затевалось. */
  restoreAttempt();     // ⚠️до восстановления формы: попытка принадлежит ИМЕННО этому черновику
  const draft = restoreDraft();
  if (draft && draft.rows && draft.rows.length >= 2) {
    draft.rows.forEach(r => addRow(r.name || '', r.date || ''));
    if (draft.family != null) document.getElementById('fc-family').value = draft.family;
    syncActive();
  } else {
    addRow(); addRow();
  }
  attachControls();
  attachPresets();
  refresh();
});

/* активные кнопки групп = состояние (после черновика и после пресета) */
function syncActive() {
  ['#fc-themes .cfg-opt|theme|theme', '#fc-formats .cfg-opt|frameType|frametype',
   '#fc-sizes .cfg-opt|size|size', '#fc-colors .cfg-opt|frameColor|color'].forEach(spec => {
    const [sel, key, attr] = spec.split('|');
    document.querySelectorAll(sel).forEach(b =>
      b.classList.toggle('active', b.dataset[attr] === String(state[key])));
  });
}

/* пресеты сетки «Sizes & prices»: клик → формат и размер в конфигураторе (близнец ortus.js);
   до #create доскроллит якорь. ⛔Состав семьи и фамилию пресет не трогает. */
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
