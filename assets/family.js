/* Ortus Atelier — конфигуратор family constellations (04.09.2026).
   Родословная: ortus.js. Особенность продукта: члены семьи (2–6 имён с датами) НЕ влезают
   в design-код — источник истины для конвейера = Stripe-поле «members», которое покупатель
   заполняет НА ЧЕКАУТЕ (паттерн SKN: place тоже вводится на чекауте). Конфигуратор собирает
   «семейную строку» и кладёт её в буфер при переходе — покупателю остаётся вставить.
   fulfil.parse_members_field ждёт «Имя ДД/ММ/ГГГГ; …» — строим ровно этот формат.
   PAYMENT_LINKS пусты до ключа ortus-setup-2 → честный fallback (заказ письмом). */

const PRICES = {
  print:   { '3040': 34.99, '4050': 39.99, '5070': 44.99 },
  classic: { '3040': 69.99, '4050': 79.99, '5070': 89.99 },
};

/* Заполнить после создания family-линков (ключ ortus-setup-2): fmt → URL. */
const PAYMENT_LINKS = {};

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
    if (box.children.length > 2) row.remove();
  });
  box.appendChild(row);
}

let gateBox = null;
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
    'At checkout, one field asks for exactly this family line — we’ve copied it to your ' +
    'clipboard, just paste it there. Every name and birthday right?' +
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
      const line = familyLine();
      try { navigator.clipboard.writeText(line); } catch (e) {}
      const link = PAYMENT_LINKS[formatToken()];
      if (link) {
        window.location.href = `${link}?client_reference_id=${encodeURIComponent(designCode())}`;
      } else {
        /* линков ещё нет — заказ письмом, ничего не теряем */
        const subject = encodeURIComponent(`Family constellations — ${fam}`);
        const body = encodeURIComponent(
          `Hello!\n\nWe'd love a family constellations print.\n\nFamily name: ${fam}\n` +
          `The family: ${line}\nFinish: ${state.theme} · ${formatToken()}` +
          (state.frameType === 'classic' ? ` · ${state.frameColor} frame` : '') +
          `\nPrice shown: £${price().toFixed(2)}\n\nThank you!`);
        window.location.href = `mailto:admin@shopcienty.com?subject=${subject}&body=${body}`;
      }
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
  addRow(); addRow();
  attachControls();
  refresh();
});
