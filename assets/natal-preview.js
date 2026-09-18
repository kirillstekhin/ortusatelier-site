/* Ortus Atelier — живое превью натальной карты в браузере (15.09.2026).

   ⛔ЭТО ПОРТ ПЕЧАТНОГО РЕНДЕРА, А НЕ ИЛЛЮСТРАЦИЯ. Печатный файл делает Python —
   `platform/natal/natal_poster.py` (лист, небо, лепестки, листья, глифы) и `ephem.py`
   (10 тел + асцендент), их зовёт `tools/fulfil.py: render_print_file`. Здесь те же формулы
   и те же числа строка в строку: покупатель утверждает то, что видит, и получить он должен
   ровно это. Меняешь natal_poster.py или ephem.py — меняй здесь и гоняй сверку (приватный репо):
       python3 platform/natal/parity/check_preview_parity.py
   Небо — `assets/natal-sky.json`, сделан из тех же файлов, что берёт печать
   (`platform/natal/make_preview_sky.py`).

   Анимация — механика SKN (site/assets/starmap.js, refresh): интерполируются ДАННЫЕ, а не
   картинка. Дата, время, место: звёздное время и широта едут по кратчайшей дуге (малый сдвиг
   промётывается целыми сутками), асцендент считается из них же — колесо и небо поворачиваются
   вместе; планеты скользят по кругу; лепестки аспектов проявляются и гаснут, а не мигают;
   слабые звёзды на время движения прячутся. Последний кадр — честный рендер, как в печати.
   Тема и размер меняют геометрию — там кроссфейд, как у SKN. */
(function (root) {
'use strict';

/* ═══ арифметика Python: у `%` и `round()` другое поведение, чем у JS ═══ */
function pyMod(x, m) { const r = x % m; return (r !== 0 && (r < 0) !== (m < 0)) ? r + m : r; }
function pyRound(x) {                         // round() Python 3: ровная половина — к чётному
  const f = Math.floor(x), d = x - f;
  return d > 0.5 ? f + 1 : d < 0.5 ? f : (f % 2 === 0 ? f : f + 1);
}
const D2R = Math.PI / 180.0;
const R2D = 180.0 / Math.PI;                  // = math.degrees()
const f1 = v => v.toFixed(1);
const arc = d => pyMod(d + 180.0, 360.0) - 180.0;   // кратчайшая дуга, [-180, 180)
function esc(s) { return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }

/* ═══════════════ ephem.py — эфемерида (порт 1:1) ═══════════════ */

function julianDate(y, mo, d, utHours) {
  if (mo <= 2) { y -= 1; mo += 12; }
  const A = Math.floor(y / 100);
  const B = 2 - A + Math.floor(A / 4);
  return Math.trunc(365.25 * (y + 4716)) + Math.trunc(30.6001 * (mo + 1)) + d + B - 1524.5 + utHours / 24.0;
}

/* Кеплеровы элементы J2000 + скорости за век (Standish) — копия ELEMENTS из ephem.py */
const ELEMENTS = {
  Mercury: [[0.38709927, 0.20563593, 7.00497902, 252.25032350, 77.45779628, 48.33076593],
            [0.00000037, 0.00001906, -0.00594749, 149472.67411175, 0.16047689, -0.12534081]],
  Venus:   [[0.72333566, 0.00677672, 3.39467605, 181.97909950, 131.60246718, 76.67984255],
            [0.00000390, -0.00004107, -0.00078890, 58517.81538729, 0.00268329, -0.27769418]],
  Earth:   [[1.00000261, 0.01671123, -0.00001531, 100.46457166, 102.93768193, 0.0],
            [0.00000562, -0.00004392, -0.01294668, 35999.37244981, 0.32327364, 0.0]],
  Mars:    [[1.52371034, 0.09339410, 1.84969142, -4.55343205, -23.94362959, 49.55953891],
            [0.00001847, 0.00007882, -0.00813131, 19140.30268499, 0.44441088, -0.29257343]],
  Jupiter: [[5.20288700, 0.04838624, 1.30439695, 34.39644051, 14.72847983, 100.47390909],
            [-0.00011607, -0.00013253, -0.00183714, 3034.74612775, 0.21252668, 0.20469106]],
  Saturn:  [[9.53667594, 0.05386179, 2.48599187, 49.95424423, 92.59887831, 113.66242448],
            [-0.00125060, -0.00050991, 0.00193609, 1222.49362201, -0.41897216, -0.28867794]],
  Uranus:  [[19.18916464, 0.04725744, 0.77263783, 313.23810451, 170.95427630, 74.01692503],
            [-0.00196176, -0.00004397, -0.00242939, 428.48202785, 0.40805281, 0.04240589]],
  Neptune: [[30.06992276, 0.00859048, 1.77004347, -55.12002969, 44.96476227, 131.78422574],
            [0.00026291, 0.00005105, 0.00035372, 218.45945325, -0.32241464, -0.00508664]],
  Pluto:   [[39.48211675, 0.24882730, 17.14001206, 238.92903833, 224.06891629, 110.30393684],
            [-0.00031596, 0.00005170, 0.00004818, 145.20780515, -0.04062942, -0.01183482]],
};

function kepler(Mdeg, e) {
  const M = pyMod(Mdeg, 360.0) * D2R;
  let E = M + e * Math.sin(M);
  for (let i = 0; i < 12; i++) {
    const dE = (E - e * Math.sin(E) - M) / (1 - e * Math.cos(E));
    E -= dE;
    if (Math.abs(dE) < 1e-12) break;
  }
  return E;
}

function helioXyz(name, T) {
  const [[a0, e0, I0, L0, w0, O0], [da, de, dI, dL, dw, dO]] = ELEMENTS[name];
  const a = a0 + da * T, e = e0 + de * T;
  const I = (I0 + dI * T) * D2R, L = L0 + dL * T;
  const wbar = w0 + dw * T, O = (O0 + dO * T) * D2R;
  const w = (wbar - (O0 + dO * T)) * D2R;
  const E = kepler(L - wbar, e);
  const xp = a * (Math.cos(E) - e);
  const yp = a * Math.sqrt(1 - e * e) * Math.sin(E);
  const cw = Math.cos(w), sw = Math.sin(w), cO = Math.cos(O), sO = Math.sin(O), ci = Math.cos(I), si = Math.sin(I);
  const x = (cw * cO - sw * sO * ci) * xp + (-sw * cO - cw * sO * ci) * yp;
  const y = (cw * sO + sw * cO * ci) * xp + (-sw * sO + cw * cO * ci) * yp;
  const z = (sw * si) * xp + (cw * si) * yp;
  return [x, y, z];
}

function planetLons(jd) {
  const T = (jd - 2451545.0) / 36525.0;
  const [ex, ey] = helioXyz('Earth', T);
  const out = {};
  for (const name of ['Mercury', 'Venus', 'Mars', 'Jupiter', 'Saturn', 'Uranus', 'Neptune', 'Pluto']) {
    const [x, y] = helioXyz(name, T);
    const lon = Math.atan2(y - ey, x - ex) * R2D;
    out[name] = pyMod(lon + 1.3969713 * T, 360.0);
  }
  return out;
}

function sunParts(d) {
  const ws = pyMod(282.9404 + 4.70935e-5 * d, 360.0);
  const Ms = pyMod(356.0470 + 0.9856002585 * d, 360.0);
  const e = 0.016709 - 1.151e-9 * d;
  const E = kepler(Ms, e);
  const xv = Math.cos(E) - e;
  const yv = Math.sqrt(1 - e * e) * Math.sin(E);
  const v = Math.atan2(yv, xv) * R2D;
  return [pyMod(v + ws, 360.0), pyMod(ws + Ms, 360.0), Ms];
}
function sunLon(jd) { return sunParts(jd - 2451543.5)[0]; }

function moonLon(jd) {
  const d = jd - 2451543.5;
  const N = pyMod(125.1228 - 0.0529538083 * d, 360.0);
  const i = 5.1454 * D2R;
  const w = pyMod(318.0634 + 0.1643573223 * d, 360.0);
  const e = 0.054900;
  const M = pyMod(115.3654 + 13.0649929509 * d, 360.0);
  const E = kepler(M, e);
  const xv = Math.cos(E) - e;
  const yv = Math.sqrt(1 - e * e) * Math.sin(E);
  const v = Math.atan2(yv, xv) * R2D;
  const u = (v + w) * D2R;
  const Nr = N * D2R;
  const x = Math.cos(Nr) * Math.cos(u) - Math.sin(Nr) * Math.sin(u) * Math.cos(i);
  const y = Math.sin(Nr) * Math.cos(u) + Math.cos(Nr) * Math.sin(u) * Math.cos(i);
  let lon = Math.atan2(y, x) * R2D;
  const sp = sunParts(d), Ls = sp[1], Ms = sp[2];
  const Lm = pyMod(N + w + M, 360.0);
  const D = (Lm - Ls) * D2R;
  const F = (Lm - N) * D2R;
  const Mr = M * D2R, Msr = Ms * D2R;
  lon += (-1.274 * Math.sin(Mr - 2 * D)
          + 0.658 * Math.sin(2 * D)
          - 0.186 * Math.sin(Msr)
          - 0.059 * Math.sin(2 * Mr - 2 * D)
          - 0.057 * Math.sin(Mr - 2 * D + Msr)
          + 0.053 * Math.sin(Mr + 2 * D)
          + 0.046 * Math.sin(2 * D - Msr)
          + 0.041 * Math.sin(Mr - Msr)
          - 0.035 * Math.sin(D)
          - 0.031 * Math.sin(Mr + Msr)
          - 0.015 * Math.sin(2 * F - 2 * D)
          + 0.011 * Math.sin(Mr - 4 * D));
  return pyMod(lon, 360.0);
}

function obliquity(jd) { return 23.4393 - 3.563e-7 * (jd - 2451543.5); }
function gmstDeg(jd) { return pyMod(280.46061837 + 360.98564736629 * (jd - 2451545.0), 360.0); }
/* ephem.ascendant, разобранный на части: анимации нужен асцендент из ПРОМЕЖУТОЧНОГО звёздного
   времени, чтобы колесо поворачивалось вместе с небом. ramcDeg = gmst + lon, как в печати. */
function ascFromRamc(ramcDeg, lat, epsDeg) {
  const eps = epsDeg * D2R, ramc = ramcDeg * D2R, phi = lat * D2R;
  const asc = Math.atan2(-Math.cos(ramc), Math.sin(ramc) * Math.cos(eps) + Math.tan(phi) * Math.sin(eps)) * R2D;
  return pyMod(asc + 180.0, 360.0);
}
function ascendant(jd, lat, lon) { return ascFromRamc(gmstDeg(jd) + lon, lat, obliquity(jd)); }

const SIGNS = ['Aries', 'Taurus', 'Gemini', 'Cancer', 'Leo', 'Virgo', 'Libra',
               'Scorpio', 'Sagittarius', 'Capricorn', 'Aquarius', 'Pisces'];
function signOf(lon) { return SIGNS[Math.floor(lon / 30) % 12]; }

function chart(dateStr, timeStr, lat, lon, tz) {
  const [y, mo, dd] = dateStr.split('-').map(x => parseInt(x, 10));
  const [hh, mm] = timeStr.split(':').map(x => parseInt(x, 10));
  const jd = julianDate(y, mo, dd, hh + mm / 60.0 - tz);
  const bodies = { Sun: sunLon(jd), Moon: moonLon(jd) };
  Object.assign(bodies, planetLons(jd));
  return { jd, bodies, asc: ascendant(jd, lat, lon), obliquity: obliquity(jd) };
}

/* ═══════════════ natal_poster.py — лист (порт 1:1) ═══════════════ */

const W = 1050, CX = 525.0, CY = 590.0, RSKY = 475.0, PETAL_R = 295.0;
const DISC_TOP = 115.0, TITLE_GAP = 125.0;   // канон 3:4: 115 + диск 950 + 125 + текстовый блок 210 = 1400
const ORBS = [[0, 7], [60, 5], [90, 6], [120, 6], [180, 7]];                    // аспект°, орб°
const ORDER = ['Sun', 'Moon', 'Mercury', 'Venus', 'Mars', 'Jupiter', 'Saturn', 'Uranus', 'Neptune', 'Pluto'];
const GLYPH_PATHS = {
  Sun:     ['<circle cx="12" cy="12" r="7"/>', '<circle cx="12" cy="12" r="1.7" fill="CUR" stroke="none"/>'],
  Moon:    ['<path d="M14.5,4.2 A8.6,8.6 0 1 0 14.5,19.8 A10.8,10.8 0 0 1 14.5,4.2 Z"/>'],
  Mercury: ['<circle cx="12" cy="10.5" r="4.4"/>', '<path d="M12,14.9 V21 M9.4,18 H14.6"/>',
            '<path d="M7.8,2.6 A4.3,4.3 0 0 0 16.2,2.6"/>'],
  Venus:   ['<circle cx="12" cy="9" r="5"/>', '<path d="M12,14 V21 M9,17.5 H15"/>'],
  Mars:    ['<circle cx="10.4" cy="13.6" r="5"/>', '<path d="M14,10 L19.6,4.4 M15.4,4.4 H19.6 V8.6"/>'],
  Jupiter: ['<path d="M4.6,14.6 C4.6,9 8,4.6 11.6,4.6 C10,7 9.4,11 9.6,14.6"/>',
            '<path d="M4.6,14.6 H19.4 M15.8,7 V21"/>'],
  Saturn:  ['<path d="M8.2,3.6 V16 M5.6,7 H10.8"/>',
            '<path d="M8.2,12.4 C8.2,9.6 12.4,9 13.8,11.6 C15.2,14.2 13.6,17.2 12.6,19 C12,20.4 13,21.2 14.6,20.4"/>'],
  Uranus:  ['<path d="M7,3.6 V13.6 M17,3.6 V13.6 M7,8.6 H17 M12,8.6 V16.4"/>',
            '<circle cx="12" cy="18.8" r="2.3"/>'],
  Neptune: ['<path d="M6.4,4.2 C6.4,10.4 8.8,13 12,13 C15.2,13 17.6,10.4 17.6,4.2"/>',
            '<path d="M12,3.8 V19.6 M9,16.6 H15"/>',
            '<path d="M4.6,6 L6.4,4.2 L8.2,6 M15.8,6 L17.6,4.2 L19.4,6 M10.2,5.6 L12,3.8 L13.8,5.6"/>'],
  Pluto:   ['<circle cx="12" cy="5.6" r="2.2"/>',
            '<path d="M7.6,8 C7.6,12.4 9.6,14.4 12,14.4 C14.4,14.4 16.4,12.4 16.4,8"/>',
            '<path d="M12,14.4 V21 M9.2,17.8 H14.8"/>'],
};
const ELEMENTS4 = ['fire', 'earth', 'air', 'water'];
const GOLD = ['#6b4a0c', '#ffe89a', '#c9a227', '#fff6cf', '#7d5810'];
const SILVER = ['#5b636d', '#ffffff', '#a8b2bd', '#ffffff', '#69727c'];
const COPPER = ['#7d4526', '#f0b783', '#c07a4a', '#ffd9b8', '#8f5330'];
const PODACHI = {
  'gold-contrast': { bg: '#05070c', halo: '#0e1526', star: '#ffffff', glyph: '#ffe89a', ink: '#f6ecd0',
    dim: '#6a7590', accent: '#c9a227', outer: GOLD, inner: GOLD, glow: true, w: 1.5 * 2.5, op: 0.95, fill: 0.2 },
  'copper-bloom': { bg: '#0c1512', halo: '#16261f', star: '#e6efe8', glyph: '#e8b98f', ink: '#f0f4ef',
    dim: '#61796d', accent: '#c07a4a', outer: COPPER, inner: COPPER, glow: false, w: 1.05 * 2.5, op: 0.8, fill: 0.14 },
  'garden-paper': { bg: '#f6f1e7', halo: '#efe6d5', star: '#4a443a', glyph: '#6b5a3a', ink: '#2a251d',
    dim: '#9c9384', accent: '#b08d5a',
    elem: { fire: '#c96f5e', earth: '#8fa07a', air: '#cfa444', water: '#7fa8c0' },
    leaf: '#8fa07a', node: '#8a6a3a', light_sky: true, glow: false, w: 0.95 * 2.5, op: 0.72, fill: 0.16 },
  'bimetal': { bg: '#060810', halo: '#111a2e', star: '#ffffff', glyph: '#ffe89a', ink: '#f4eeda',
    dim: '#6b7488', accent: '#c9a227', outer: GOLD, inner: SILVER, glow: true, w: 1.5 * 2.5, op: 0.95, fill: 0.2 },
};
const THEME_TOKENS = { copperbloom: 'copper-bloom', goldcontrast: 'gold-contrast',
                       gardenpaper: 'garden-paper', bimetal: 'bimetal' };
const TITLE_FONT = "'Cormorant Garamond',Georgia,serif";
const META_FONT = "'IBM Plex Mono',Menlo,Consolas,monospace";
const MONTHS = ['', 'JANUARY', 'FEBRUARY', 'MARCH', 'APRIL', 'MAY', 'JUNE', 'JULY',
                'AUGUST', 'SEPTEMBER', 'OCTOBER', 'NOVEMBER', 'DECEMBER'];

/* ── подписи листа (15.09.2026) — ТЕ ЖЕ правила и числа, что в natal_poster.py ──
   Заголовок «Город, Страна» не влезал в лист: длинная пара при 67 px выходила за ширину 1050 px.
   Без подписи в заголовке город, остальное — в строку даты; с подписью место целиком в строке
   даты; длинное ужимается кеглем до TEXT_MAX. Ширина — по таблице advance Cormorant Garamond 500
   (копия CORMORANT_500_ADV из natal_poster.py, сверка ②b), Plex Mono моноширинный — 600/1000.
   ⛔Шрифтовой движок не спрашиваем: браузер и rsvg мерили бы по-разному, превью разошлось бы
   с печатью. */
const TEXT_MAX = 930.0;
const TITLE_SIZE = 67, TITLE_LS = 0.05, TITLE_MIN = 24;
const SUB_SIZE = 24, SUB_LS = 0.20, SUB_MIN = 12;
const MONO_ADV = 600;
const ADV_FALLBACK = 641;
const CORMORANT_500_ADV = {
  " ": 234, "!": 252, "\"": 289, "#": 526, "$": 414, "%": 574, "&": 703, "'": 143,
  "(": 309, ")": 309, "*": 448, "+": 398, ",": 222, "-": 323, ".": 200, "/": 344,
  "0": 477, "1": 332, "2": 402, "3": 391, "4": 453, "5": 409, "6": 465, "7": 429,
  "8": 489, "9": 465, ":": 200, ";": 227, "<": 407, "=": 468, ">": 407, "?": 332,
  "@": 722, "A": 706, "B": 570, "C": 684, "D": 696, "E": 542, "F": 513, "G": 719,
  "H": 761, "I": 335, "J": 327, "K": 652, "L": 537, "M": 842, "N": 730, "O": 766,
  "P": 546, "Q": 766, "R": 681, "S": 499, "T": 637, "U": 700, "V": 664, "W": 925,
  "X": 650, "Y": 612, "Z": 598, "[": 274, "\\": 344, "]": 274, "_": 398, "À": 706,
  "Á": 706, "Â": 706, "Ã": 706, "Ä": 706, "Å": 706, "Æ": 879, "Ç": 684, "È": 542,
  "É": 542, "Ê": 542, "Ë": 542, "Ì": 335, "Í": 335, "Î": 335, "Ï": 335, "Ð": 696,
  "Ñ": 730, "Ò": 766, "Ó": 766, "Ô": 766, "Õ": 766, "Ö": 766, "Ø": 776, "Ù": 700,
  "Ú": 700, "Û": 700, "Ü": 700, "Ý": 612, "Þ": 541, "Ÿ": 612, "Œ": 920, "Š": 499,
  "Ž": 598, "Ā": 706, "Ă": 706, "Ą": 708, "Ć": 684, "Č": 684, "Ď": 696, "Đ": 696,
  "Ē": 542, "Ė": 542, "Ę": 542, "Ě": 542, "Ğ": 719, "Ģ": 719, "Ī": 335, "Į": 335,
  "İ": 335, "Ķ": 652, "Ĺ": 537, "Ļ": 537, "Ľ": 537, "Ł": 530, "Ń": 730, "Ņ": 730,
  "Ň": 730, "Ō": 766, "Ő": 766, "Ŕ": 681, "Ř": 681, "Ś": 499, "Ş": 499, "Ţ": 637,
  "Ť": 637, "Ū": 700, "Ů": 700, "Ű": 700, "Ų": 700, "Ź": 598, "Ż": 598, "А": 706,
  "Б": 570, "В": 570, "Г": 517, "Д": 713, "Е": 542, "Ё": 542, "Ж": 998, "З": 515,
  "И": 768, "Й": 768, "К": 660, "Л": 706, "М": 842, "Н": 761, "О": 766, "П": 744,
  "Р": 546, "С": 669, "Т": 637, "У": 616, "Ф": 776, "Х": 650, "Ц": 730, "Ч": 630,
  "Ш": 1041, "Щ": 1047, "Ъ": 663, "Ы": 861, "Ь": 554, "Э": 635, "Ю": 1039, "Я": 603,
  "І": 335, "Ї": 335, "Є": 669, "Ґ": 512, "·": 195, "–": 515, "—": 830, "‘": 192,
  "’": 190, "“": 346, "”": 346, "«": 462, "»": 462,
};

function emWidth(text, table, ls) {
  let total = 0, n = 0;
  for (const ch of text) {
    total += table === null ? MONO_ADV
      : (Object.prototype.hasOwnProperty.call(table, ch) ? table[ch] : ADV_FALLBACK);
    n++;
  }
  return total / 1000.0 + ls * Math.max(n - 1, 0);
}
function fitSize(text, table, size, ls, minimum, maxW = TEXT_MAX) {
  const emw = emWidth(text, table, ls);
  if (emw <= 0) return size;
  return Math.max(minimum, Math.min(size, Math.floor(maxW / emw)));
}

/* ⛔ВЫСОТА ЛИСТА — ИЗ ПИКСЕЛЕЙ АРТИКУЛА, КАК В ПЕЧАТИ: fulfil.py зовёт рендер с
   `H_override=int(round(1050 * h / w))`. Пиксели — копия fulfil.CATALOG. У 40×50 выходит
   ровно 1312.5, и Python округляет К ЧЁТНОМУ (1312), а Math.round дал бы 1313. */
const PRINT_PX = { PRINT3040: [3600, 4800], PRINT4050: [4800, 6000], PRINT5070: [6000, 8400],
                   CLASSIC3040: [3614, 4795], CLASSIC4050: [4800, 6000], CLASSIC5070: [6000, 8400] };
function canvasH(frameType, size) {
  const px = PRINT_PX[String(frameType || 'print').toUpperCase() + size] || PRINT_PX.PRINT3040;
  return pyRound(1050 * px[1] / px[0]);
}

function glyphSvg(name, cx, cy, size, color) {
  const sc = size / 24.0;
  const inner = GLYPH_PATHS[name].map(p => p.split('CUR').join(color)).join('');
  return `<g transform="translate(${f1(cx - size / 2)},${f1(cy - size / 2)}) scale(${sc.toFixed(3)})" `
       + `stroke="${color}" stroke-width="1.6" fill="none" stroke-linecap="round" stroke-linejoin="round">${inner}</g>`;
}

function pt(lon, r, asc) {                    // долгота → точка кольца; ASC слева
  const a = (180.0 - (lon - asc)) * Math.PI / 180.0;
  return [CX + r * Math.cos(a), CY - r * Math.sin(a)];
}

function aspects(bodies) {
  const out = [];
  for (let i = 0; i < ORDER.length; i++) {
    for (let j = i + 1; j < ORDER.length; j++) {
      let d = pyMod(Math.abs(bodies[ORDER[i]] - bodies[ORDER[j]]), 360.0);
      if (d > 180.0) d = 360.0 - d;
      for (const [ang, orb] of ORBS) {
        if (Math.abs(d - ang) <= orb) { out.push([ORDER[i], ORDER[j], ang]); break; }
      }
    }
  }
  return out;
}

/* порядок отрисовки печати: длинные лепестки ПОД короткими (sorted(..., reverse=True) стабилен) */
function sortBySep(asp, bodies) {
  const sep = x => { const d = pyMod(Math.abs(bodies[x[0]] - bodies[x[1]]), 360.0); return d > 180.0 ? 360.0 - d : d; };
  return asp.slice().sort((p, q) => sep(q) - sep(p));
}
function drawOrder(bodies) { return sortBySep(aspects(bodies), bodies); }

/* ═══ небо: altaz/project = starmap_v3 (тот же порт, что у SKN), фильтры = real_sky ═══ */
let SKY = null;            // {mag_limit, stars:[[ra,dec,mag]…] от слабых к ярким, lines:[[[ra,dec]…]…]}
function setSky(d) { SKY = d; }

function altAz(raDeg, decDeg, lst, latDeg) {
  const ha = pyMod(lst - raDeg, 360.0) * D2R;
  const dec = decDeg * D2R, lat = latDeg * D2R;
  const sinA = Math.sin(dec) * Math.sin(lat) + Math.cos(dec) * Math.cos(lat) * Math.cos(ha);
  const alt = Math.asin(Math.max(-1, Math.min(1, sinA)));
  const cosZ = (Math.sin(dec) - Math.sin(lat) * sinA) / (Math.cos(lat) * Math.cos(alt) + 1e-12);
  let az = Math.acos(Math.max(-1, Math.min(1, cosZ)));
  if (Math.sin(ha) > 0) az = 2 * Math.PI - az;
  return [alt, az];
}
function project(alt, az, cx, cy, R) {
  const r = (Math.PI / 2 - alt) / (Math.PI / 2);
  return [cx + R * r * Math.sin(az), cy - R * r * Math.cos(az)];
}

const LOD_MAG = 5.2;       // на кадрах движения рисуем звёзды не слабее этой величины

function realSky(t, lst, lat, lod, fadeFaint) {
  const light = !!t.light_sky;
  const s = [];
  const lnOp = light ? 0.20 : 0.26;
  for (const line of SKY.lines) {
    let top = -Infinity;
    const seg = [];
    for (const [ra, dec] of line) {
      const [a, z] = altAz(ra, dec, lst, lat);
      if (a > top) top = a;
      if (a > 0.0) { const [x, y] = project(a, z, CX, CY, RSKY); seg.push(f1(x) + ',' + f1(y)); }
    }
    if (top <= 0.02) continue;
    if (seg.length > 1) s.push(`<path d="M${seg.join(' L')}" fill="none" stroke="${t.star}" stroke-width="1.0" opacity="${lnOp}"/>`);
  }
  const faint = [], bright = [];
  for (const [ra, dec, m] of SKY.stars) {
    if (lod && m > LOD_MAG) continue;
    const [a, z] = altAz(ra, dec, lst, lat);
    if (!(a > 0.01)) continue;
    const [x, y] = project(a, z, CX, CY, RSKY);
    const rad = Math.max(0.9, 0.75 * Math.pow(Math.max(7.2 - m, 0.35), 1.25));
    const op = light ? (m < 2.5 ? 0.85 : m < 4.5 ? 0.48 : 0.24) : (m < 2.5 ? 0.95 : m < 4.5 ? 0.6 : 0.32);
    (m > LOD_MAG ? faint : bright).push(`<circle cx="${f1(x)}" cy="${f1(y)}" r="${rad.toFixed(2)}" fill="${t.star}" fill-opacity="${op.toFixed(2)}"/>`);
  }
  if (fadeFaint && faint.length) s.push(`<g class="np-faint">${faint.join('')}</g>`);
  else s.push(faint.join(''));
  s.push(bright.join(''));
  return s.join('');
}

function petalPath(x1, y1, x2, y2, bow) {
  const mx = (x1 + x2) / 2, my = (y1 + y2) / 2;
  const dx = x2 - x1, dy = y2 - y1;
  const ln = Math.hypot(dx, dy) || 1.0;
  const px = -dy / ln, py = dx / ln;
  const bw = ln * bow;
  return `M${f1(x1)} ${f1(y1)} Q${f1(mx + px * bw)} ${f1(my + py * bw)} ${f1(x2)} ${f1(y2)} `
       + `Q${f1(mx - px * bw)} ${f1(my - py * bw)} ${f1(x1)} ${f1(y1)} Z`;
}

function fillRef(t, layer, bodyLon, gid) {
  if (t.elem) return t.elem[ELEMENTS4[Math.floor(bodyLon / 30) % 4]];   // «Сад на бумаге»: цвет стихии
  return `url(#${layer}${gid})`;
}

/* asp: [[n1, n2, ang, alpha]…]; alpha = 1 в честном кадре, 0…1 — лепесток проявляется/гаснет */
function petals(t, gid, asc, bodies, asp, radius, bow, aMul, wMul, layer, opMul) {
  const s = [];
  for (const [n1, n2, , al] of asp) {
    const [x1, y1] = pt(bodies[n1], radius, asc);
    const [x2, y2] = pt(bodies[n2], radius, asc);
    const ref = fillRef(t, layer, bodies[n1], gid);
    const d = petalPath(x1, y1, x2, y2, bow);
    s.push(`<path d="${d}" fill="${ref}" opacity="${(t.fill * aMul * al).toFixed(3)}"/>`);
    s.push(`<path d="${d}" fill="none" stroke="${ref}" stroke-width="${(t.w * wMul).toFixed(2)}" `
         + `opacity="${(t.op * opMul * al).toFixed(3)}" stroke-linejoin="round"/>`);
  }
  return s.join('');
}

/* разводка глифов (natal_poster, 26.08): соседи ближе 8° получают ступеньки 0/30/60 px */
function clusterRings(bodies) {
  const order = ORDER.slice().sort((a, b) => bodies[a] - bodies[b]);
  const ring = {};
  let cluster = [];
  const flush = cl => cl.forEach((nm, k) => { ring[nm] = (k % 3) * 30.0; });
  for (const nm of order) {
    if (cluster.length && pyMod(bodies[nm] - bodies[cluster[cluster.length - 1]], 360.0) <= 8.0) cluster.push(nm);
    else { flush(cluster); cluster = [nm]; }
  }
  if (cluster.length && order.length && pyMod(bodies[order[0]] - bodies[cluster[cluster.length - 1]], 360.0) <= 8.0
      && !cluster.includes(order[0])) cluster.push(order[0]);
  flush(cluster);
  return ring;
}

function leavesAndPlanets(t, gid, asc, bodies, ring) {
  const s = [];
  const L = 35.0, Wd = 12.5;
  for (const name of ORDER) {
    const lon = bodies[name];
    const [x, y] = pt(lon, PETAL_R, asc);
    const ang = (180.0 - (lon - asc)) * Math.PI / 180.0;
    const ux = Math.cos(ang), uy = -Math.sin(ang);
    const px = -uy, py = ux;
    const ref = t.leaf || `url(#outer${gid})`;
    s.push(`<path d="M${f1(x)} ${f1(y)} `
         + `Q${f1(x + ux * L * .5 + px * Wd)} ${f1(y + uy * L * .5 + py * Wd)} `
         + `${f1(x + ux * L)} ${f1(y + uy * L)} `
         + `Q${f1(x + ux * L * .5 - px * Wd)} ${f1(y + uy * L * .5 - py * Wd)} `
         + `${f1(x)} ${f1(y)} Z" fill="${ref}" opacity="${Math.min(1.0, t.fill * 2.4).toFixed(3)}"/>`);
    const node = t.node || `url(#outer${gid})`;
    const [gx, gy] = pt(lon, PETAL_R + 75 + (ring[name] || 0.0), asc);
    s.push(`<circle cx="${f1(x)}" cy="${f1(y)}" r="6.5" fill="${node}"/>`);
    s.push(glyphSvg(name, gx, gy, 36, t.glyph));
  }
  return s.join('');
}

function grad(gid, layer, ramp) {
  const stops = ramp.map((c, i) => `<stop offset="${(i / (ramp.length - 1) * 100).toFixed(0)}%" stop-color="${c}"/>`).join('');
  return `<linearGradient id="${layer}${gid}" x1="0" y1="0" x2="1" y2="1">${stops}</linearGradient>`;
}

/* подписи листа — как в печати; до привязки места вместо него плейсхолдер, координат нет */
function textBlock(o, asc) {
  const [y, mo, d] = o.dateStr.split('-').map(x => parseInt(x, 10));
  const bound = o.placeBound !== false;
  const place = bound ? (o.place || '') : 'Your birthplace';
  const dateS = `${d} ${MONTHS[mo]} ${y} · ${o.timeStr}`;
  const ded = (o.name || '').trim();                   // fulfil.py: `.strip()`, «Sky That Night» = пусто
  let title, sub;
  if (ded && ded !== 'Sky That Night') {
    title = ded;
    sub = `${place.toUpperCase()} · ${dateS}`;
  } else {                                             // в заголовке город, остальное — в строку даты
    const i = place.indexOf(',');
    const city = (i < 0 ? place : place.slice(0, i)).trim();
    const rest = (i < 0 ? '' : place.slice(i + 1)).trim();
    title = city || place;
    sub = rest ? `${rest.toUpperCase()} · ${dateS}` : dateS;
  }
  title = title.toUpperCase();
  let foot;
  if (bound) {
    const latS = `${Math.abs(o.lat).toFixed(4)}°${o.lat >= 0 ? 'N' : 'S'}`;
    const lonS = `${Math.abs(o.lon).toFixed(4)}°${o.lon >= 0 ? 'E' : 'W'}`;
    foot = `${latS} ${lonS} · RISING ${signOf(asc).toUpperCase()}`;
  } else {
    foot = 'RISING SIGN FOLLOWS YOUR BIRTHPLACE';
  }
  return { title, sub, foot,
           titleSize: fitSize(title, CORMORANT_500_ADV, TITLE_SIZE, TITLE_LS, TITLE_MIN),
           subSize: fitSize(sub, null, SUB_SIZE, SUB_LS, SUB_MIN) };
}

/* честный кадр = ровно то, что нарисует печать */
function honestFrame(o) {
  const key = THEME_TOKENS[o.theme] || 'copper-bloom';
  const c = chart(o.dateStr, o.timeStr, o.lat, o.lon, o.tz);
  return { key, H: canvasH(o.frameType, o.size), eps: c.obliquity,
           lst: pyMod(gmstDeg(c.jd) + o.lon, 360.0), lat: o.lat,
           bodies: c.bodies, asc: c.asc, text: textBlock(o, c.asc) };
}

/* defs листа: градиенты неба и лепестков, маска диска, свечение — одни на лист и на оба диска пары */
function defsFor(t, gid) {
  const defs = [`<radialGradient id="sky${gid}" cx="50%" cy="42%" r="62%">`
              + `<stop offset="0%" stop-color="${t.halo}"/><stop offset="100%" stop-color="${t.bg}"/></radialGradient>`,
                `<clipPath id="disc${gid}"><circle cx="${CX}" cy="${CY}" r="${RSKY}"/></clipPath>`];
  if (!t.elem) { defs.push(grad(gid, 'outer', t.outer)); defs.push(grad(gid, 'inner', t.inner)); }
  if (t.glow) defs.push(`<filter id="gl${gid}" x="-30%" y="-30%" width="160%" height="160%">`
                      + `<feGaussianBlur stdDeviation="7.5" result="b"/>`
                      + `<feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter>`);
  return defs;
}

/* аспекты кадра в порядке отрисовки и нормировка плотности (natal_poster._chart_parts) */
function frameAspects(F, A) {
  const bodies = A ? A.bodies : F.bodies;
  let asp = A ? A.asp.filter(x => x[3] > 0.001) : aspects(bodies).map(x => [x[0], x[1], x[2], 1]);
  /* нормировка плотности печати (26.08): заливку давим ~1/n, обводку мягче.
     В анимации n — сумма «проявленности», чтобы яркость не прыгала на входе нового лепестка. */
  const n = Math.max(A ? asp.reduce((acc, x) => acc + x[3], 0) : asp.length, 1);
  return { asp: sortBySep(asp, bodies), fillMul: Math.min(1.0, Math.pow(9.0 / n, 1.15)),
           opMul: Math.min(1.0, Math.pow(10.0 / n, 0.35)) };
}

/* диск в координатах канона (CX, CY, RSKY): небо, кольцо, лепестки, листья и глифы — natal_poster._disc */
function discElements(t, gid, F, A, fadeFaint) {
  const lst = A ? A.lst : F.lst, lat = A ? A.lat : F.lat;
  const bodies = A ? A.bodies : F.bodies, asc = A ? A.asc : F.asc;
  const { asp, fillMul, opMul } = frameAspects(F, A);
  return [
    `<circle cx="${CX}" cy="${CY}" r="${RSKY}" fill="url(#sky${gid})"/>`,
    `<g clip-path="url(#disc${gid})">${realSky(t, lst, lat, !!(A && A.lod), fadeFaint)}</g>`,
    `<circle cx="${CX}" cy="${CY}" r="${RSKY}" fill="none" stroke="${t.accent}" stroke-width="2" opacity=".6"/>`,
    t.glow ? `<g filter="url(#gl${gid})">` : '<g>',
    petals(t, gid, asc, bodies, asp, PETAL_R * 0.62, 0.42, 0.62 * fillMul, 0.75, 'inner', opMul),
    petals(t, gid, asc, bodies, asp, PETAL_R, 0.34, 1.0 * fillMul, 1.0, 'outer', opMul),
    '</g>',
    leavesAndPlanets(t, gid, asc, bodies, A ? A.ring : clusterRings(bodies)),
  ];
}

/* A (кадр анимации): {lst, lat, bodies, asc, asp:[[n1,n2,ang,alpha]…], ring, lod} или null */
function renderFrame(F, A, fadeFaint) {
  const t = PODACHI[F.key];
  const gid = F.key.replace(/-/g, '');
  const H = F.H;
  const defs = defsFor(t, gid);
  const tx = F.text;
  /* ⛔Заголовок заезжал на диск у 40×50 (18.09.2026): текст привязан к низу (H−210), диск — к
     верху; у 4:5 (H=1312) заглавные ложились на кольцо. Диск масштабируется, сохраняя канон 3:4:
     верхнее поле DISC_TOP и зазор TITLE_GAP до заголовка; у 3:4 и 5:7 s=1 — без обёртки.
     ⚠️Формула и формат чисел — как в natal_poster.py (render); сверка — check_preview_parity.py. */
  const sDisc = Math.min(1.0, (H - DISC_TOP - TITLE_GAP - 210.0) / (2 * RSKY));
  let disc = discElements(t, gid, F, A, fadeFaint);
  if (sDisc < 1.0) {
    const dy = DISC_TOP + RSKY * sDisc - CY;
    disc = [`<g transform="translate(0,${dy.toFixed(2)}) translate(${CX},${CY}) scale(${sDisc.toFixed(5)}) `
            + `translate(${-CX},${-CY})">`, ...disc, '</g>'];
  }
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">`,
    `<defs>${defs.join('')}</defs>`,
    `<rect width="${W}" height="${H}" fill="${t.bg}"/>`,
    ...disc,
    `<text x="${W / 2}" y="${H - 210}" text-anchor="middle" fill="${t.ink}" font-family="${TITLE_FONT}" `
      + `font-weight="500" font-size="${tx.titleSize}" letter-spacing=".05em">${esc(tx.title)}</text>`,
    `<text x="${W / 2}" y="${H - 155}" text-anchor="middle" fill="${t.dim}" font-family="${META_FONT}" `
      + `font-size="${tx.subSize}" letter-spacing=".2em">${esc(tx.sub)}</text>`,
    `<line x1="${W / 2 - 105}" y1="${H - 115}" x2="${W / 2 + 105}" y2="${H - 115}" stroke="${t.accent}" stroke-width="2" opacity=".9"/>`,
    `<text x="${W / 2}" y="${H - 70}" text-anchor="middle" fill="${t.dim}" font-family="${META_FONT}" `
      + `font-size="20" letter-spacing=".22em">${esc(tx.foot)}</text>`,
    '</svg>',
  ].join('');
}

function renderSvg(o) {
  const F = honestFrame(o);
  return { svg: renderFrame(F, null, false), frame: F };
}

/* ═══ Диптих пары (18.09.2026) — порт natal_poster.render_couple 1:1 ═══
   Два неба на горизонтальном листе 1400 × H; диски канона переносятся transform'ом (R=300 из 475),
   под каждым свой текстовый блок (кегли 0.72 от листа, ширина колонки 620), между ними «&».
   o = { theme, frameType, size, a: {dateStr, timeStr, lat, lon, tz, place, placeBound, name}, b: {…} } */
const CPL_W = 1400, CPL_R = 300.0, CPL_TOP = 100.0, CPL_DX = 340.0, CPL_TEXT_MAX = 620.0;
const CPL_TITLE = 48, CPL_TITLE_MIN = 17, CPL_SUB = 17, CPL_SUB_MIN = 9, CPL_FOOT = 14;

function canvasHCouple(frameType, size) {       // высота горизонтального листа из пикселей артикула
  const px = PRINT_PX[String(frameType || 'print').toUpperCase() + size] || PRINT_PX.PRINT3040;
  return pyRound(1400 * px[0] / px[1]);
}

function coupleCaptions(p, asc) {                // natal_poster._captions + _foot, кегли пары
  const [y, mo, d] = p.dateStr.split('-').map(x => parseInt(x, 10));
  const bound = p.placeBound !== false;
  const place = bound ? (p.place || '') : 'Your birthplace';
  const dateS = `${d} ${MONTHS[mo]} ${y} · ${p.timeStr}`;
  const name = (p.name || '').trim();
  let title, sub;
  if (name) { title = name; sub = `${place.toUpperCase()} · ${dateS}`; }
  else {
    const i = place.indexOf(',');
    const city = (i < 0 ? place : place.slice(0, i)).trim();
    const rest = (i < 0 ? '' : place.slice(i + 1)).trim();
    title = city || place;
    sub = rest ? `${rest.toUpperCase()} · ${dateS}` : dateS;
  }
  title = title.toUpperCase();
  const foot = bound
    ? `${Math.abs(p.lat).toFixed(4)}°${p.lat >= 0 ? 'N' : 'S'} ${Math.abs(p.lon).toFixed(4)}°${p.lon >= 0 ? 'E' : 'W'} · RISING ${signOf(asc).toUpperCase()}`
    : 'RISING SIGN FOLLOWS YOUR BIRTHPLACE';
  return { title, sub, foot,
           titleSize: fitSize(title, CORMORANT_500_ADV, CPL_TITLE, TITLE_LS, CPL_TITLE_MIN, CPL_TEXT_MAX),
           subSize: fitSize(sub, null, CPL_SUB, SUB_LS, CPL_SUB_MIN, CPL_TEXT_MAX) };
}

function renderCoupleSvg(o) {
  const key = THEME_TOKENS[o.theme] || 'copper-bloom';
  const t = PODACHI[key];
  const gid = key.replace(/-/g, '');
  const H = canvasHCouple(o.frameType, o.size);
  const cy = CPL_TOP + CPL_R;
  const sDisc = CPL_R / RSKY;
  const parts = [];
  const frames = [];
  [[o.a, CPL_W / 2 - CPL_DX], [o.b, CPL_W / 2 + CPL_DX]].forEach(([p, cx]) => {
    const F = honestFrame({ ...p, theme: o.theme, frameType: o.frameType, size: o.size });
    frames.push(F);
    const tx = cx - CX * sDisc, ty = cy - CY * sDisc;
    parts.push(`<g transform="translate(${tx.toFixed(2)},${ty.toFixed(2)}) scale(${sDisc.toFixed(5)})">`
               + discElements(t, gid, F, null, false).join('') + '</g>');
    const c = coupleCaptions(p, F.asc);
    parts.push(
      `<text x="${cx.toFixed(0)}" y="${H - 151}" text-anchor="middle" fill="${t.ink}" font-family="${TITLE_FONT}" `
        + `font-weight="500" font-size="${c.titleSize}" letter-spacing=".05em">${esc(c.title)}</text>`,
      `<text x="${cx.toFixed(0)}" y="${H - 112}" text-anchor="middle" fill="${t.dim}" font-family="${META_FONT}" `
        + `font-size="${c.subSize}" letter-spacing=".2em">${esc(c.sub)}</text>`,
      `<line x1="${(cx - 76).toFixed(0)}" y1="${H - 83}" x2="${(cx + 76).toFixed(0)}" y2="${H - 83}" `
        + `stroke="${t.accent}" stroke-width="2" opacity=".9"/>`,
      `<text x="${cx.toFixed(0)}" y="${H - 50}" text-anchor="middle" fill="${t.dim}" font-family="${META_FONT}" `
        + `font-size="${CPL_FOOT}" letter-spacing=".22em">${esc(c.foot)}</text>`);
  });
  const mid = CPL_W / 2;
  parts.push(
    `<line x1="${mid.toFixed(0)}" y1="${(CPL_TOP + 50).toFixed(0)}" x2="${mid.toFixed(0)}" y2="${(cy - 35).toFixed(0)}" stroke="${t.accent}" stroke-width="1" opacity=".35"/>`,
    `<line x1="${mid.toFixed(0)}" y1="${(cy + 35).toFixed(0)}" x2="${mid.toFixed(0)}" y2="${(cy + CPL_R).toFixed(0)}" stroke="${t.accent}" stroke-width="1" opacity=".35"/>`,
    `<text x="${mid.toFixed(0)}" y="${(cy + 15).toFixed(0)}" text-anchor="middle" fill="${t.accent}" font-family="${TITLE_FONT}" `
      + `font-style="italic" font-size="54" opacity=".9">&amp;</text>`);
  const svg = [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${CPL_W}" height="${H}" viewBox="0 0 ${CPL_W} ${H}">`,
    `<defs>${defsFor(t, gid).join('')}</defs>`,
    `<rect width="${CPL_W}" height="${H}" fill="${t.bg}"/>`,
    ...parts, '</svg>'].join('');
  return { svg, frames, H };
}

/* ═══════════════ превью на странице: показ, анимация, кроссфейд ═══════════════ */

const SKY_URL = '/assets/natal-sky.json?v=1';   // от корня: 404.html отдаётся и на вложенных адресах
const SKY_DUR = 2400;      // как у SKN
const TAU = 140;           // мс: сглаживание проявления лепестков и ступенек глифов
const ctl = { el: null, chip: null, shown: null, anim: null, xf: null, next: null, tick: 0, loading: false, waiting: null };
const ease = p => p < 0.5 ? 4 * p * p * p : 1 - Math.pow(-2 * p + 2, 3) / 2;

function paramsOf(F) {
  const asp = new Map();
  for (const [a, b, g] of aspects(F.bodies)) asp.set(a + '|' + b, { n1: a, n2: b, ang: g, al: 1 });
  return { lst: F.lst, lat: F.lat, asc: F.asc, bodies: Object.assign({}, F.bodies), asp, ring: clusterRings(F.bodies) };
}

function sameSky(a, b) {
  const near = (x, y) => Math.abs(arc(x - y)) < 1e-6;
  if (!near(a.lst, b.lst) || Math.abs(a.lat - b.lat) > 1e-6 || !near(a.asc, b.asc)) return false;
  return ORDER.every(nm => near(a.bodies[nm], b.bodies[nm]));
}

function stopAnim() {
  if (ctl.anim) { root.cancelAnimationFrame(ctl.anim.raf); ctl.anim = null; }
}
function finishXf() { if (ctl.xf) ctl.xf(); }

function drawHonest(F, fadeFaint) {
  ctl.el.innerHTML = renderFrame(F, null, fadeFaint);
  ctl.shown = { F, P: paramsOf(F) };
}

function crossfade(F) {
  finishXf();
  const el = ctl.el;
  const h0 = el.offsetHeight;
  const old = el.querySelector('svg');
  drawHonest(F, false);
  if (!old) return;
  const h1 = el.offsetHeight;
  const grow = Math.abs(h1 - h0) > 1;
  el.style.position = 'relative';
  if (grow) { el.style.overflow = 'hidden'; el.style.height = h0 + 'px'; }
  old.style.cssText = 'position:absolute;left:0;top:0;width:100%;height:auto;transition:opacity .5s ease';
  el.appendChild(old);
  void el.offsetWidth;
  if (grow) { el.style.transition = 'height .55s cubic-bezier(.3,.6,.2,1)'; el.style.height = h1 + 'px'; }
  old.style.opacity = '0';
  const done = () => {
    clearTimeout(tm); old.remove();
    for (const k of ['position', 'overflow', 'height', 'transition']) el.style.removeProperty(k);
    ctl.xf = null;
  };
  const tm = setTimeout(done, 660);
  ctl.xf = done;
}

function startAnim(F) {
  stopAnim();
  const P0 = ctl.shown.P;
  let dL = arc(F.lst - P0.lst);
  const dLat = F.lat - P0.lat;
  if (Math.abs(dLat) < 0.05 && Math.abs(dL) > 0.05 && Math.abs(dL) < 40) dL += dL < 0 ? -360 : 360;   // «сутки», как у SKN
  const dB = {};
  for (const nm of ORDER) dB[nm] = arc(F.bodies[nm] - P0.bodies[nm]);
  const asp = new Map([...P0.asp].map(([k, v]) => [k, Object.assign({}, v)]));
  const ring = Object.assign({}, P0.ring);
  const t0 = root.performance.now();
  let last = t0;
  const anim = { F, raf: 0 };
  const step = now => {
    const Fc = anim.F;                                   // по ходу мог смениться текст
    const p = Math.min(1, (now - t0) / SKY_DUR), e = ease(p);
    const k = 1 - Math.exp(-Math.min(64, now - last) / TAU);
    last = now;
    const lst = P0.lst + dL * e, lat = P0.lat + dLat * e;
    const bodies = {};
    for (const nm of ORDER) bodies[nm] = pyMod(P0.bodies[nm] + dB[nm] * e, 360.0);
    const asc = p < 1 ? ascFromRamc(lst, lat, Fc.eps) : Fc.asc;
    const want = new Map();
    for (const [a, b, g] of aspects(bodies)) want.set(a + '|' + b, g);
    for (const [key, g] of want) {
      const cur = asp.get(key);
      if (cur) cur.ang = g; else { const [a, b] = key.split('|'); asp.set(key, { n1: a, n2: b, ang: g, al: 0 }); }
    }
    let settled = true;
    for (const [key, v] of asp) {
      const target = want.has(key) ? 1 : 0;
      v.al += (target - v.al) * k;
      if (Math.abs(target - v.al) < 0.02) v.al = target; else settled = false;
      if (v.al === 0 && target === 0) asp.delete(key);
    }
    const ringT = clusterRings(bodies);
    for (const nm of ORDER) {
      const tg = ringT[nm] || 0, cur = ring[nm] || 0;
      ring[nm] = cur + (tg - cur) * k;
      if (Math.abs(tg - ring[nm]) < 0.5) ring[nm] = tg; else settled = false;
    }
    ctl.shown.P = { lst, lat, asc, bodies, asp: new Map([...asp].map(([kk, v]) => [kk, Object.assign({}, v)])), ring: Object.assign({}, ring) };
    if (p < 1 || !settled) {
      ctl.el.innerHTML = renderFrame(Fc, {
        lst, lat, bodies, asc, ring: Object.assign({}, ring), lod: true,
        asp: [...asp.values()].map(v => [v.n1, v.n2, v.ang, v.al]),
      }, false);
      anim.raf = root.requestAnimationFrame(step);
    } else {
      ctl.anim = null;
      drawHonest(Fc, true);                              // финал — честный рендер, слабые звёзды проявляются
    }
  };
  ctl.anim = anim;
  anim.raf = root.requestAnimationFrame(step);
}

function updateChip(F, o) {
  if (!ctl.chip) return;
  const sun = signOf(F.bodies.Sun), moon = signOf(F.bodies.Moon);
  ctl.chip.textContent = o.placeBound === false
    ? `Sun in ${sun} · Moon in ${moon}`                     // знак асцендента — только с местом
    : `Sun in ${sun} · Moon in ${moon} · ${signOf(F.asc)} rising`;
}

function loadSky() {
  if (ctl.loading) return;
  ctl.loading = true;
  root.fetch(SKY_URL).then(r => r.json()).then(d => {
    SKY = d; ctl.loading = false;
    const w = ctl.waiting; ctl.waiting = null;
    if (w) apply(w);
  }).catch(() => { ctl.loading = false; });
}

function apply(o) {
  if (!ctl.el) {
    ctl.el = root.document.getElementById('np-preview');
    ctl.chip = root.document.getElementById('np-chip');
    if (!ctl.el) return;
    watchSticky();
  }
  if (!(isFinite(o.lat) && isFinite(o.lon))) return;
  if (!SKY) { ctl.waiting = o; loadSky(); return; }
  const F = honestFrame(o);
  updateChip(F, o);
  const reduced = root.matchMedia && root.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const cur = ctl.shown;
  if (!cur || reduced) { stopAnim(); finishXf(); drawHonest(F, false); return; }
  if (cur.F.key !== F.key || cur.F.H !== F.H) { stopAnim(); crossfade(F); return; }   // тема/размер
  if (ctl.anim) {
    if (sameSky(ctl.anim.F, F)) { ctl.anim.F = F; return; }   // сменился только текст — едем дальше
    startAnim(F); return;                                       // новая цель — от текущего кадра
  }
  if (sameSky(cur.F, F)) { drawHonest(F, false); return; }     // имя, место без сдвига координат
  startAnim(F);
}

/* телефон: превью прилипает к верху и сжимается, пока листаешь форму — механика SKN
   (site/assets/starmap.js, watchStickyPreview). Проверка по прокрутке, а не IntersectionObserver:
   у SKN наблюдатель молчал при прыжках прокрутки. Порог с зоной нечувствительности — сжатие
   меняет высоту блока и само сдвигает его верх, без зазора состояние мигало бы. */
function watchSticky() {
  const col = root.document.querySelector('.np-col');
  if (!col || ctl.sticky) return;
  ctl.sticky = true;
  let last = null, ticking = false;
  const evaluate = () => {
    const top = col.getBoundingClientRect().top;
    const stuck = root.innerWidth <= 980 && (last ? top <= 24 : top <= 0.5);
    if (stuck === last) return;
    last = stuck;
    col.classList.toggle('is-stuck', stuck);
  };
  root.addEventListener('scroll', () => {
    if (ticking) return;
    ticking = true;
    root.requestAnimationFrame(() => { ticking = false; evaluate(); });
  }, { passive: true });
  root.addEventListener('resize', evaluate);
  evaluate();
}

/* страница пары: статичный показ (анимация листа — только у одной карты). Небо грузится тем же путём;
   вызовы с формы склеиваются в один кадр, как у show(). Чип — по человеку: Солнце и асцендент. */
function applyCouple(o) {
  const el = root.document.getElementById('np-preview');
  if (!el) return;
  if (!(isFinite(o.a.lat) && isFinite(o.a.lon) && isFinite(o.b.lat) && isFinite(o.b.lon))) return;
  if (!SKY) { ctl.waitingCouple = o; if (!ctl.loading) {
    ctl.loading = true;
    root.fetch(SKY_URL).then(r => r.json()).then(d => { SKY = d; ctl.loading = false; const w = ctl.waitingCouple; ctl.waitingCouple = null; if (w) applyCouple(w); })
      .catch(() => { ctl.loading = false; });
  } return; }
  const r = renderCoupleSvg(o);
  el.innerHTML = r.svg;
  const chip = root.document.getElementById('np-chip');
  if (chip) chip.textContent = [['a', r.frames[0]], ['b', r.frames[1]]].map(([w, F]) => {
    const p = o[w];
    const who = (p.name || '').trim() || (w === 'a' ? 'First' : 'Second');
    return `${who}: Sun in ${signOf(F.bodies.Sun)}` + (p.placeBound === false ? '' : ` · ${signOf(F.asc)} rising`);
  }).join('   ✦   ');
  if (!ctl.sticky) watchSticky();
  return r;
}
function showCouple(o) {
  ctl.nextCouple = o;
  if (ctl.tickCouple) return;
  ctl.tickCouple = root.requestAnimationFrame(() => { ctl.tickCouple = 0; applyCouple(ctl.nextCouple); });
}

/* вызовы с формы склеиваются в один кадр: ввод имени не рендерит лист на каждую букву дважды */
function show(o) {
  ctl.next = o;
  if (ctl.tick) return;
  ctl.tick = root.requestAnimationFrame(() => {
    ctl.tick = 0;
    const n = ctl.next; ctl.next = null;
    if (n) apply(n);
  });
}

const api = { setSky, chart, aspects, drawOrder, canvasH, renderSvg, signOf, show, renderCoupleSvg, canvasHCouple, showCouple,
  fitTitle: s => fitSize(s, CORMORANT_500_ADV, TITLE_SIZE, TITLE_LS, TITLE_MIN),
  fitSub: s => fitSize(s, null, SUB_SIZE, SUB_LS, SUB_MIN),
  advTable: CORMORANT_500_ADV, advFallback: ADV_FALLBACK };
if (typeof module !== 'undefined' && module.exports) module.exports = api;
else root.OrtusNatal = api;
})(typeof window !== 'undefined' ? window : globalThis);
