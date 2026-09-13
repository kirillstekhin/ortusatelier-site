/**
 * Ortus — сохранение дизайна и выдача ID для оплаты. Cloudflare Pages Function.
 * Проект: platform/DESIGN_STORE_SPEC.md · пара на чтение: tools/design_store.py
 *
 * ЗАЧЕМ. Покупатель вводил место, имя и всю семью ВТОРОЙ раз на странице оплаты: Payment
 * Links не умеют предзаполнять custom fields из URL, а в client_reference_id персонализация
 * не влезает (шесть коротких латинских имён — 214 байт при лимите 200; кириллицей 331).
 * Здесь форма сохраняет дизайн, получает короткий непрозрачный ID и ссылку оплаты.
 *
 * ⛔ТОЛЬКО ЗАПИСЬ. Чтения нет ни по какому адресу: в записи имя, место рождения и ДАТЫ
 *   РОЖДЕНИЯ ДЕТЕЙ. Читает только фулфилмент, с сервера, отдельным ключом.
 * ⛔ССЫЛКА — ТОЛЬКО ПОСЛЕ УСПЕШНОЙ ЗАПИСИ. Ошибка или таймаут R2 = 503 и НИКАКОЙ ссылки:
 *   иначе покупатель заплатит за дизайн, которого в хранилище нет.
 *
 * ═══ ПОЧЕМУ CHECKOUT SESSION, А НЕ PAYMENT LINK (пересмотр 13.09.2026) ═══
 * Payment Link ВЕЧЕН: сохранённая покупателем ссылка создаёт новую сессию когда угодно,
 * в том числе для дизайна, который мы обязаны стереть. Ограничить срок оплаты КОНКРЕТНОГО
 * дизайна через него нельзя — значит автоудаление персональных данных заперто навсегда.
 * Поэтому сессию создаёт сервер: дизайн живёт 7 дней, сессия до 24 часов, это РАЗНЫЕ сроки.
 *
 * ⛔ТРИ УСЛОВИЯ ИДЕМПОТЕНТНОСТИ (требования юзера 13.09), каждое закрывает свой провал:
 * ①ПОПЫТКА ФИКСИРУЕТСЯ ДО ПЕРВОГО ЗАПРОСА. Клиент присылает `attempt` — свой id, который
 *   он держит неизменным при повторах и меняет ТОЛЬКО при изменении персонализации. Если
 *   бы каждый повтор создавал новый дизайн, ключ `design_<id>` не защитил бы ни от чего:
 *   у каждого дубля был бы свой ключ. Поэтому идемпотентность живёт на уровне ПОПЫТКИ.
 * ②ПОВТОР ШЛЁТ В STRIPE НЕИЗМЕННЫЕ ПАРАМЕТРЫ. Stripe требует того же тела при том же
 *   ключе. Параметры (включая `expires_at`!) пишутся в запись попытки ДО первого вызова
 *   и при повторе берутся оттуда. Пересчитать `expires_at` = получить конфликт.
 * ③ПОТЕРЯННЫЙ ОТВЕТ НЕ ТЕРЯЕТ СЕССИЮ. Если Stripe создал сессию, а запись результата
 *   упала, повтор с тем же ключом вернёт ТУ ЖЕ сессию, и связь восстановится. Пока связь
 *   не восстановлена, ссылку не отдаём — фулфилмент и GC по такой записи СТОЯТ.
 *   Через 24 часа мы ПРЕКРАЩАЕМ АВТОМАТИЧЕСКИЕ ПОВТОРЫ и отдаём 409 на ручную сверку.
 *   ⚠️Это НАШ консервативный предел, а не момент, когда Stripe удаляет ключ: точного
 *   момента мы не знаем и полагаться на него не имеем права. Смысл предела в другом —
 *   дальше повтор вслепую может создать ВТОРУЮ сессию, а этого допускать нельзя.
 * ④ПОПЫТКА ПРИВЯЗАНА К СОДЕРЖИМОМУ. В метке лежит отпечаток нормализованного заказа.
 *   Тот же `attempt` с другой персонализацией — отказ, даже если клиент обычно до этого
 *   не доводит: клиентская логика тут не защита, а удобство. Иначе подменённое тело
 *   получило бы ссылку на оплату уже созданной, другой сессии.
 *
 * ⑤УДАЛЁННЫЙ ДИЗАЙН НЕ ВОСКРЕШАЕТСЯ. Когда GC стирает просроченную запись, он оставляет
 *   вместо метки НАДГРОБИЕ. Повтор по такой попытке получает 410 `design_expired`: ни
 *   ссылки на удалённое, ни новой оплаты под старой попыткой. Обе крайности плохи — метка
 *   без надгробия увела бы на оплату несуществующего дизайна, а удаление метки превратило
 *   бы повтор в новую оплату. Срок и порядок уборки — в `tools/design_gc.py`.
 *
 * ⚠️СТАРЫЕ ОПЛАТЫ ПО PAYMENT LINK продолжают проверяться прежним путём — проверка по
 *   `payment_link` не заменяется глобально, а дополняется.
 * ⛔ЦЕНУ И ССЫЛКУ ВЫБИРАЕТ СЕРВЕР. Сумма от браузера не принимается — её в теле нет вовсе.
 * ⛔В ЛОГИ НЕ ПИСАТЬ ПЕРСОНАЛЬНОЕ. Ни места, ни имён, ни дат рождения — только id и код ошибки.
 * ⚠️ВАЛИДАЦИЯ ОБЯЗАНА СОВПАДАТЬ С PYTHON. Общие примеры: platform/design_store_cases.json,
 *   их гоняют оба проверяющих. Разъедутся — заказ примут здесь и остановят там.
 *
 * Привязки (wrangler / Pages): R2 bucket `DESIGNS` — ОТДЕЛЬНЫЙ ПРИВАТНЫЙ, не тот, где
 * печатные файлы: оттуда наружу уходят presigned-ссылки.
 */

export const SCHEMA_VERSION = 2;   // +mode: запись знает, в каком режиме создана
export const MAX_BODY = 4096;
export const LIMITS = { member_name: 24, place: 80, dedication: 60 };
export const MEMBERS_RANGE = [2, 6];
const RATE_WINDOW_S = 60;
const RATE_MAX = 10;

export const CODE_RE =
  /^(SM2|MN2|NT2|FC2)-(\d{8})-(\d{4})-([NS])(\d+)-([EW])(\d+)-Z(-?\d+)-([A-Z]+)-([A-Z0-9]+)-([A-Z]+)$/;

/* ⛔ДОВЕРЕННАЯ СЕТКА — ПО РЕЖИМАМ. Объекты Stripe в test и live РАЗНЫЕ: price из боевого
   режима в тестовом не существует, и наоборот. Одна общая таблица означала бы, что
   тестовый прогон либо не работает, либо (хуже) работает по боевым объектам.
   ⛔Режим объявляется КОНФИГУРАЦИЕЙ (`STRIPE_MODE`), а не угадывается. Ключ обязан ему
   соответствовать, таблица берётся по нему же, созданная сессия проверяется по
   `livemode`. Любое расхождение — отказ БЕЗ ссылки: см. `modeOf`.
   ⛔Сумма продукты НЕ различает — Natal и Family стоят одинаково; различает Price.
   `link` — СТАРЫЕ Payment Links, по ним сверяются оплаты, сделанные до перехода; проверка
   по `payment_link` не заменяется глобально, а дополняется проверкой Price. В тестовом
   режиме их нет вовсе: старых оплат в нём не бывает. */
export const ORTUS = {
  live: {
    "natal/PRINT3040": { pence: 3499, price: "price_1UBh9oK6RIyYA8uFXGYYHVXj", link: "https://buy.stripe.com/14AbJ24AKfyJan1dW07g40i" },
    "natal/PRINT4050": { pence: 3999, price: "price_1UBh9qK6RIyYA8uF3HNEytG3", link: "https://buy.stripe.com/28E9AU5EO72d8eTdW07g40j" },
    "natal/PRINT5070": { pence: 4499, price: "price_1UBh9sK6RIyYA8uF3W7cdAcg", link: "https://buy.stripe.com/eVqdRaaZ84U59iX6ty7g40k" },
    "natal/CLASSIC3040": { pence: 6999, price: "price_1UBh9uK6RIyYA8uFs65mZoEV", link: "https://buy.stripe.com/aFa14ogjs86hgLpdW07g40l" },
    "natal/CLASSIC4050": { pence: 7999, price: "price_1UBh9vK6RIyYA8uFvVwNM2ZM", link: "https://buy.stripe.com/00wbJ27MWaep0Mr2di7g40m" },
    "natal/CLASSIC5070": { pence: 8999, price: "price_1UBh9yK6RIyYA8uFpf2MkEA5", link: "https://buy.stripe.com/3cI00kc3cbit3YDf047g40n" },
    "family/PRINT3040": { pence: 3499, price: "price_1UCHa2K6RIyYA8uFMsMHA1zk", link: "https://buy.stripe.com/14A6oI5EO3Q13YD4lq7g40o" },
    "family/PRINT4050": { pence: 3999, price: "price_1UCHa3K6RIyYA8uFeQhH1uH4", link: "https://buy.stripe.com/9B600k0kudqB2Uz7xC7g40p" },
    "family/PRINT5070": { pence: 4499, price: "price_1UCHa5K6RIyYA8uF573zueJC", link: "https://buy.stripe.com/aFa9AUd7gfyJ1Qvg487g40q" },
    "family/CLASSIC3040": { pence: 6999, price: "price_1UCHa6K6RIyYA8uFs8rawXDZ", link: "https://buy.stripe.com/eVq6oI6IS72d9iXdW07g40r" },
    "family/CLASSIC4050": { pence: 7999, price: "price_1UCHa8K6RIyYA8uFikCWUZrN", link: "https://buy.stripe.com/14A4gA0ku72dfHl5pu7g40s" },
    "family/CLASSIC5070": { pence: 8999, price: "price_1UCHa9K6RIyYA8uFtgwaWX6T", link: "https://buy.stripe.com/aFa14ogjs72dgLp19e7g40t" },
  },
  /* ⚠️Заполняется `tools/stripe_test_catalog.py` — он же переиспользует уже созданные
     объекты, чтобы повторные прогоны не плодили товары в тестовом режиме. */
  test: {
    "natal/PRINT3040": { pence: 3499, price: "price_1UFINmK6RIyYA8uFMj8zFZ5W" },
    "natal/PRINT4050": { pence: 3999, price: "price_1UFINoK6RIyYA8uFqbnkcNEM" },
    "natal/PRINT5070": { pence: 4499, price: "price_1UFINqK6RIyYA8uFoi6JMVa0" },
    "natal/CLASSIC3040": { pence: 6999, price: "price_1UFINrK6RIyYA8uFJOsLX5IF" },
    "natal/CLASSIC4050": { pence: 7999, price: "price_1UFINtK6RIyYA8uFh8YHGP7H" },
    "natal/CLASSIC5070": { pence: 8999, price: "price_1UFINvK6RIyYA8uF8WujYVyn" },
    "family/PRINT3040": { pence: 3499, price: "price_1UFINxK6RIyYA8uF11aDSykp" },
    "family/PRINT4050": { pence: 3999, price: "price_1UFINzK6RIyYA8uFtZy3MBWX" },
    "family/PRINT5070": { pence: 4499, price: "price_1UFIO1K6RIyYA8uFsPcEaCWC" },
    "family/CLASSIC3040": { pence: 6999, price: "price_1UFIO4K6RIyYA8uFWyE0rTg2" },
    "family/CLASSIC4050": { pence: 7999, price: "price_1UFIO6K6RIyYA8uFlEyzC4j2" },
    "family/CLASSIC5070": { pence: 8999, price: "price_1UFIO7K6RIyYA8uFeC4VgQ9I" },
  },
};

/* Ключи сетки одни и те же в обоих режимах — этим проверяется, что тестовый каталог
   действительно повторяет боевой, а не «примерно похож». */
const GRID_KEYS = Object.keys(ORTUS.live);
const MODE_KEY_RE = { test: /^(sk|rk)_test_/, live: /^(sk|rk)_live_/ };

/* ⛔Куда возвращать при отмене оплаты — по продукту. Общий `/` терял контекст
   семейного заказа: покупатель Family оказывался на натальной странице. */
const CANCEL_PATH = { natal: "/", family: "/family.html" };

/** Режим + его таблица, либо код отказа. ⛔Ничего не угадываем и ничего не чиним сами:
    любое расхождение конфигурации — отказ, а не «возьмём что есть». */
export function modeOf(env) {
  const m = env && env.STRIPE_MODE;
  if (!MODE_KEY_RE[m]) return { error: "mode_unset" };          // режим не объявлен
  if (!env.STRIPE_KEY) return { error: "key_unset" };
  if (!MODE_KEY_RE[m].test(env.STRIPE_KEY)) return { error: "mode_key_mismatch" };
  const grid = ORTUS[m];
  // Таблица режима обязана совпасть с боевой по составу И суммам: разойдутся — прогон
  // проверит не то, что поедет в бой.
  for (const k of GRID_KEYS) {
    if (!grid[k] || !grid[k].price || grid[k].price === "TBD") return { error: "mode_table_incomplete" };
    if (grid[k].pence !== ORTUS.live[k].pence) return { error: "mode_table_diverged" };
  }
  return { mode: m, grid };
}

const DASHES = ["—", "-", "?", "–"];

/** Возможна ли дата в формате ГГГГ-ММ-ДД (без «32 марта»). */
export function validDate(s) {
  if (typeof s !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const [y, m, d] = s.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}

/** Полная проверка записи. → массив проблем; пустой = годно. Зеркало design_store.validate. */
export function validate(rec) {
  const bad = [];
  const product = rec && rec.product;
  if (product !== "natal" && product !== "family") bad.push(`product=${JSON.stringify(product)}: жду natal или family`);

  const code = ((rec && rec.design_code) || "").trim();
  const m = CODE_RE.exec(code);
  if (!m) bad.push("design_code не соответствует формату");
  else {
    const want = { natal: "NT2", family: "FC2" }[product];
    if (want && !code.startsWith(want)) bad.push(`design_code начинается не с ${want} — код и продукт разошлись`);
  }

  const fmt = rec && rec.format;
  const key = `${product}/${fmt}`;
  if (!GRID_KEYS.includes(key)) bad.push(`format=${JSON.stringify(fmt)} не из сетки Ortus`);
  else if (m && m[10] !== fmt) bad.push(`format=${JSON.stringify(fmt)} не совпадает с форматом в design_code (${m[10]})`);

  const pl = (rec && rec.place) || null;
  const place = ((pl && pl.name) || "").trim();
  if (product === "natal") {
    if (!place || DASHES.includes(place)) bad.push("натальной нужно настоящее название места, а не прочерк");
    // ⚠️[...] — по кодовым ТОЧКАМ: .length в JS считает единицы UTF-16 и на суррогатных
    //   парах разошёлся бы с len() в Python. Пределы обязаны совпадать в обоих.
    else if ([...place].length > LIMITS.place) bad.push(`место длиннее ${LIMITS.place} символов`);
  }
  /* ⛔НЕПУСТАЯ СТРОКА — ЕЩЁ НЕ СОГЛАСОВАННОСТЬ. Координаты записи обязаны совпасть с теми,
     что зашиты в design-код: иначе на макете подпись одного города, а звёзды другого.
     ⚠️Сверка НАЗВАНИЯ с координатами (геокодер) здесь не делается намеренно — это сетевой
     вызов в пути записи; её делает fulfil.place_mismatch перед печатью. */
  if (m && pl) {
    const lat = pl.lat, lon = pl.lon;
    if (lat === undefined || lat === null || lon === undefined || lon === null) bad.push("у места нет координат");
    else {
      const wantLat = Number(m[5]) * (m[4] === "N" ? 1 : -1);
      const wantLon = Number(m[7]) * (m[6] === "E" ? 1 : -1);
      const gotLat = Math.round(lat * 10000), gotLon = Math.round(lon * 10000);
      if (gotLat !== wantLat || gotLon !== wantLon)
        bad.push(`координаты места ${lat},${lon} не совпадают с design-кодом (${wantLat / 10000},${wantLon / 10000})`);
    }
  }

  const ded = ((rec && rec.dedication) || "").trim();
  if ([...ded].length > LIMITS.dedication) bad.push(`посвящение длиннее ${LIMITS.dedication} символов`);

  if (product === "family") {
    const mem = rec && rec.members;
    if (!Array.isArray(mem)) bad.push("members должен быть списком");
    else if (mem.length < MEMBERS_RANGE[0] || mem.length > MEMBERS_RANGE[1])
      bad.push(`членов семьи ${mem.length}, жду ${MEMBERS_RANGE[0]}–${MEMBERS_RANGE[1]}`);
    else mem.forEach((x, i) => {
      const nm = ((x && x.name) || "").trim();
      const dt = (x && x.date) || "";
      if (!nm) bad.push(`участник ${i + 1}: пустое имя`);
      else if ([...nm].length > LIMITS.member_name) bad.push(`участник ${i + 1}: имя длиннее ${LIMITS.member_name}`);
      if (!validDate(dt)) bad.push(`участник ${i + 1}: дата ${JSON.stringify(dt)} не ГГГГ-ММ-ДД или невозможна`);
    });
  }
  return bad;
}

/** ⛔ID ДИЗАЙНА ВЫЧИСЛЯЕТСЯ, А НЕ РОЗЫГРЫВАЕТСЯ (правка 13.09.2026 после аудита юзера).
    Случайный id означал, что два ОДНОВРЕМЕННЫХ запроса с одной попыткой получают разные
    id, разные ключи идемпотентности — и создают ДВЕ оплаты. Теперь id = отпечаток пары
    «попытка + содержимое»: у близнецов он совпадает, и они сходятся на одном объекте.
    ⚠️Непредсказуемость сохраняется: в попытке 20 случайных символов, наружу id не утекает.
    `d_` + 26 символов base32, charset совместим с client_reference_id. */
export async function designIdFor(attempt, fp) {
  const h = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`${attempt}|${fp}`));
  return "d_" + b32(new Uint8Array(h)).slice(0, 26);
}

function b32(raw) {
  const A = "abcdefghijklmnopqrstuvwxyz234567";
  let bits = 0, acc = 0, out = "";
  for (const b of raw) {
    acc = ((acc << 8) | b) & 0xfff; bits += 8;
    while (bits >= 5) { out += A[(acc >>> (bits - 5)) & 31]; bits -= 5; }
  }
  if (bits > 0) out += A[(acc << (5 - bits)) & 31];
  return out;
}

/* ⚠️Ограничитель частоты — ПЕРВАЯ линия, а не гарантия: Cache API живёт в пределах одного
   дата-центра, из разных колó счётчики независимы. Жёсткий предел ставится правилом Rate
   Limiting в Cloudflare при развёртывании; здесь — дешёвый отсев очевидного перебора. */
async function rateLimited(ip) {
  try {
    const k = new Request(`https://rl.invalid/design/${encodeURIComponent(ip)}`);
    const cache = caches.default;
    const hit = await cache.match(k);
    const n = hit ? Number(await hit.text()) || 0 : 0;
    if (n >= RATE_MAX) return true;
    await cache.put(k, new Response(String(n + 1), {
      headers: { "Cache-Control": `max-age=${RATE_WINDOW_S}` },
    }));
    return false;
  } catch { return false; }
}

/* ⛔СРОК ПОПЫТКИ ЗАШИТ В САМ ИДЕНТИФИКАТОР, и это принципиально: проверять его надо и
   ТОГДА, КОГДА ЗАПИСИ ПОПЫТКИ УЖЕ НЕТ. Иначе старый запрос от давно открытой вкладки или
   от автоматического повтора выглядел бы новым заказом и создавал бы оплату, которую
   никто осознанно не подтверждал. Хранилище тут помочь не может — надгробие когда-нибудь
   снимут, а идентификатор у клиента останется.
   `a_` + 8 символов base36 (секунды эпохи) + 16–32 случайных.
   ⚠️Это НЕ подпись и не выдаётся за неё: подделать метку времени клиент может. Но подделка
   означает «оформить новый заказ», что и так разрешено, а защищаемся мы от ПРОТУХШЕГО
   ПОВТОРА — у него метка времени ровно та, старая. */
const ATTEMPT_RE = /^a_([0-9a-z]{8})([0-9a-z]{16,32})$/;
const ATTEMPT_TTL_S = 7 * 24 * 3600;      // столько же, сколько живёт сам дизайн
const CLOCK_SKEW_S = 3600;                // часы клиента могут врать — час прощаем

/** Возраст попытки в секундах, либо null если идентификатор не разобрать. */
function attemptAge(attempt) {
  const m = ATTEMPT_RE.exec(attempt || "");
  if (!m) return null;
  const ts = parseInt(m[1], 36);
  if (!Number.isFinite(ts) || ts <= 0) return null;
  return Math.floor(Date.now() / 1000) - ts;
}
const SESSION_TTL_S = 23 * 3600;          // <24ч: Stripe не принимает больше суток
/* ⚠️НЕ «срок жизни ключа у Stripe», а НАШ предел автоматических повторов: после него
   повторяем не вслепую, а руками. Момент удаления ключа Stripe нам не объявляет. */
const AUTO_RETRY_WINDOW_MS = 24 * 3600 * 1000;

/** Тело для Stripe в form-encoded. Порядок ключей значения не имеет, состав — имеет. */
function stripeBody(params) {
  const u = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) u.append(k, String(v));
  return u;
}

async function stripe(env, path, params, idemKey) {
  const r = await fetch(`https://api.stripe.com/v1/${path}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.STRIPE_KEY}`,
      "Content-Type": "application/x-www-form-urlencoded",
      ...(idemKey ? { "Idempotency-Key": idemKey } : {}),
    },
    body: stripeBody(params),
  });
  const data = await r.json().catch(() => ({}));
  return { ok: r.ok, status: r.status, data };
}

async function readJson(bucket, key) {
  const o = await bucket.get(key);
  return o ? await o.json() : null;
}

/** Нормализованное содержимое заказа — ровно то, что уйдёт в печать. */
function contentOf(body) {
  return {
    product: body.product,
    design_code: body.design_code.trim(),
    format: body.format,
    dedication: ((body.dedication || "").trim()) || null,
    place: body.place ? { name: (body.place.name || "").trim(), lat: body.place.lat, lon: body.place.lon } : null,
    members: Array.isArray(body.members) ? body.members.map((x) => ({ name: (x.name || "").trim(), date: x.date })) : null,
  };
}

/** ④Отпечаток содержимого. ⚠️Строка собирается ЯВНО и по порядку: `JSON.stringify` объекта
    зависел бы от порядка ключей, пришедшего от браузера, и тот же заказ давал бы разные
    отпечатки. Сравниваем НОРМАЛИЗОВАННОЕ — лишний пробел не должен выглядеть подменой. */
async function fingerprint(c) {
  const canon = JSON.stringify([
    c.product, c.design_code, c.format, c.dedication,
    c.place ? [c.place.name, c.place.lat, c.place.lon] : null,
    (c.members || []).map((m) => [m.name, m.date]),
  ]);
  const h = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(canon));
  return [...new Uint8Array(h)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

const json = (obj, status = 200) =>
  new Response(JSON.stringify(obj), { status, headers: { "Content-Type": "application/json" } });

export async function onRequestPost({ request, env }) {
  const ip = request.headers.get("CF-Connecting-IP") || "unknown";
  if (await rateLimited(ip)) return json({ error: "too_many_requests" }, 429);

  const len = Number(request.headers.get("Content-Length") || 0);
  if (len > MAX_BODY) return json({ error: "too_large", limit: MAX_BODY }, 413);

  let body;
  try {
    const text = await request.text();
    if (new TextEncoder().encode(text).length > MAX_BODY) return json({ error: "too_large", limit: MAX_BODY }, 413);
    body = JSON.parse(text);
  } catch { return json({ error: "bad_json" }, 400); }

  // ①ПОПЫТКА. Клиент фиксирует её ДО первого запроса и держит неизменной при повторах.
  const attempt = (body && body.attempt) || "";
  const age = attemptAge(attempt);
  if (age === null || age < -CLOCK_SKEW_S) return json({ error: "bad_attempt" }, 400);
  if (age > ATTEMPT_TTL_S) {
    // ⛔ПРОТУХШАЯ ПОПЫТКА — ОТКАЗ, а не новый заказ. Работает и после снятия надгробия:
    //   срок лежит в самом идентификаторе. Новая попытка появится только после того, как
    //   покупатель подтвердит форму заново.
    console.log("attempt expired", attempt, `${(age / 86400).toFixed(1)}d`);
    return json({ error: "attempt_expired" }, 410);
  }

  // ⛔РЕЖИМ — ДО ВСЕГО ОСТАЛЬНОГО. Незачем класть в хранилище запись, оплатить которую
  //   всё равно нечем: без согласованного режима ссылки не будет.
  const cfg = modeOf(env);
  if (cfg.error) {
    console.log("stripe config refused:", cfg.error);
    return json({ error: "not_configured", detail: cfg.error }, 503);
  }

  const problems = validate(body);
  if (problems.length) return json({ error: "invalid", problems }, 400);   // ⚠️без перс.данных

  const item = cfg.grid[`${body.product}/${body.format}`];
  const content = contentOf(body);
  const fp = await fingerprint(content);
  const aKey = `attempts/${attempt}.json`;

  let att;
  try {
    att = await readJson(env.DESIGNS, aKey);
  } catch (e) {
    console.log("attempt read failed", attempt, e && e.name);
    return json({ error: "storage_unavailable" }, 503);
  }

  // ⛔НАДГРОБИЕ: дизайн этой попытки удалён по сроку хранения. Ни ссылки на него, ни новой
  //   оплаты по той же попытке — покупатель подтверждает заново, и это будет новый дизайн.
  //   ⚠️Проверка ДО отпечатка: у надгробия отпечатка нет, и без этой ветки клиент получил
  //   бы `attempt_content_changed` — сообщение не о том, что случилось.
  if (att && att.state === "deleted") {
    console.log("attempt tombstoned", attempt);
    return json({ error: "design_expired" }, 410);
  }

  // ④ТОТ ЖЕ `attempt` С ДРУГИМ СОДЕРЖИМЫМ — ОТКАЗ. Клиентская логика обычно до этого не
  //   доводит, но полагаться на неё нельзя: иначе подменённое тело получило бы ссылку на
  //   оплату уже созданной, ДРУГОЙ сессии. Отказ и здесь явный: старую ссылку не отдаём.
  //   ⚠️Метка без отпечатка (`att.fp === undefined`) тоже не проходит — так и надо.
  if (att && (att.fp !== fp || att.mode !== cfg.mode)) {
    const why = att.fp !== fp ? "attempt_content_changed" : "attempt_mode_changed";
    console.log("attempt rebound refused", attempt, why);
    return json({ error: why }, 409);
  }

  // ── ПОВТОР ПО ИЗВЕСТНОМУ РЕЗУЛЬТАТУ: та же сессия, ничего не создаём ──
  if (att && att.session_url) {
    // ⛔ЗАВЕДОМО ИСТЁКШУЮ ССЫЛКУ НЕ ОТДАЁМ. Срок сессии мы сами записали в параметры —
    //   спрашивать Stripe незачем. Покупателю нужна не «страница про истёкшую сессию», а
    //   понятное «подтвердите заново»: данные у него целы, но новую попытку заводит ОН.
    const exp = Number((att.params || {}).expires_at || 0);
    if (exp && Date.now() / 1000 >= exp) {
      console.log("checkout expired", attempt);
      return json({ error: "checkout_expired" }, 410);
    }
    return json({ id: att.design_id, payment_link: att.session_url, repeat: true });
  }

  // ── ПОВТОР С НЕИЗВЕСТНЫМ РЕЗУЛЬТАТОМ: тот же ключ, ТЕ ЖЕ параметры ──
  if (att) return await linkExisting(env, aKey, att, cfg, attempt);

  return await createAttempt(env, aKey, attempt, cfg, item, content, fp, request);
}

/** Доводит до конца попытку, у которой результат создания сессии неизвестен.
    ⚠️Вызывается ДВУМЯ путями: обычным повтором и запросом, ПРОИГРАВШИМ гонку за метку. */
async function linkExisting(env, aKey, att, cfg, attempt) {
  {
    if (Date.now() - att.started_ms > AUTO_RETRY_WINDOW_MS) {
      // ③прекращаем АВТОМАТИЧЕСКИЕ повторы: за этим пределом повтор рискует создать
      //   ВТОРУЮ сессию. Дальше — только ручная сверка.
      console.log("attempt past auto-retry window", attempt);
      return json({ error: "needs_reconciliation" }, 409);
    }
    const res = await stripe(env, "checkout/sessions", att.params, att.idem_key);
    if (!res.ok || !res.data.url) {
      console.log("stripe retry failed", attempt, res.status);
      return json({ error: "checkout_unavailable" }, 503);
    }
    if (res.data.livemode !== (cfg.mode === "live")) {
      console.log("session mode mismatch on retry", attempt, res.data.livemode);
      return json({ error: "not_configured", detail: "mode_session_mismatch" }, 503);
    }
    // ⭐СВЯЗЬ ЗАПИСЫВАЕМ В ЛЮБОМ СЛУЧАЕ, даже если ссылку отдавать уже нельзя: без неё
    //   фулфилмент и GC не знают, что это за сессия, и стоят на месте.
    const linked = { ...att, session_id: res.data.id, session_url: res.data.url };
    try {
      await env.DESIGNS.put(aKey, JSON.stringify(linked), { httpMetadata: { contentType: "application/json" } });
    } catch (e) {
      console.log("attempt link write failed", attempt, e && e.name);
      return json({ error: "storage_unavailable" }, 503);   // связь не восстановлена — фулфилмент и GC стоят
    }
    if (res.data.status === "expired") {
      console.log("recovered session already expired", attempt);
      return json({ error: "checkout_expired" }, 410);
    }
    if (res.data.status && res.data.status !== "open") {
      // Сессия завершена — скорее всего уже оплачена. Ни ссылки, ни новой оплаты:
      // такое разбирают руками, а покупателю честно говорим, что заказ уже принят.
      console.log("recovered session not open", attempt, res.data.status);
      return json({ error: "already_paid" }, 409);
    }
    return json({ id: att.design_id, payment_link: res.data.url, recovered: true });
  }
}

/** Создаёт попытку: дизайн → метка → сессия. ⛔Обе записи СОЗДАЮЩИЕ (onlyIf), потому что
    одновременных запросов с одной попыткой может быть несколько: двойной клик, две вкладки,
    повтор по таймауту. Проигравший гонку не создаёт вторую оплату, а идёт по метке
    победителя — тот же ключ, те же параметры, ТА ЖЕ сессия. */
async function createAttempt(env, aKey, attempt, cfg, item, content, fp, request) {
  const id = await designIdFor(attempt, fp);
  const rec = {
    schema_version: SCHEMA_VERSION,
    id,
    created: new Date().toISOString().replace(/\.\d+Z$/, "Z"),
    mode: cfg.mode,            // ⛔запись знает свой режим: тестовую оплату боевой
    product: content.product,  //   фулфилмент печатать не станет
    design_code: content.design_code,
    format: content.format,
    expected_pence: item.pence,
    dedication: content.dedication,
    attempt,
  };
  if (content.place) rec.place = content.place;
  if (content.members) rec.members = content.members;

  const payload = new TextEncoder().encode(JSON.stringify(rec));
  if (payload.length > MAX_BODY) return json({ error: "too_large", limit: MAX_BODY }, 413);

  // ⛔ЗАПИСЬ ДИЗАЙНА ПЕРВОЙ. Ссылку отдаём только если дизайн реально лёг в хранилище.
  const dKey = `designs/${id}.json`;
  let put;
  try {
    put = await env.DESIGNS.put(dKey, payload, {
      httpMetadata: { contentType: "application/json" },
      onlyIf: { etagDoesNotMatch: "*" },
    });
  } catch (e) {
    console.log("design store write failed", id, e && e.name);
    return json({ error: "storage_unavailable" }, 503);
  }
  // ⛔R2 при невыполненном onlyIf НЕ бросает, а возвращает null (поймано живой проверкой).
  //   Раньше это считалось аварией. С вычисляемым id объект по этому ключу может уже
  //   существовать ЗАКОННО: это наш же повтор или запрос-близнец с той же попыткой и тем же
  //   содержимым. Убеждаемся, что лежит именно наше, и идём дальше.
  if (!put) {
    let existing;
    try {
      existing = await readJson(env.DESIGNS, dKey);
    } catch (e) {
      console.log("existing design read failed", id, e && e.name);
      return json({ error: "storage_unavailable" }, 503);
    }
    if (!existing || existing.attempt !== attempt) {
      console.log("design id collision", id);
      return json({ error: "design_conflict" }, 409);
    }
  }

  // ②ПАРАМЕТРЫ ФИКСИРУЮТСЯ ЗДЕСЬ И БОЛЬШЕ НЕ ПЕРЕСЧИТЫВАЮТСЯ. expires_at особенно:
  //   пересчитать его при повторе = послать Stripe другое тело под тем же ключом = конфликт.
  const origin = new URL(request.url).origin;
  const params = {
    mode: "payment",
    "line_items[0][price]": item.price,
    "line_items[0][quantity]": 1,
    client_reference_id: id,
    expires_at: Math.floor(Date.now() / 1000) + SESSION_TTL_S,
    success_url: `${origin}/thank-you.html?session_id={CHECKOUT_SESSION_ID}`,
    // ⛔ОТМЕНА ВОЗВРАЩАЕТ ТУДА, ОТКУДА ПРИШЛИ. Общий `/` уводил покупателя Family на
    //   натальную страницу — заказ семьи просто терялся (найдено аудитом 13.09).
    cancel_url: `${origin}${CANCEL_PATH[content.product] || "/"}`,
    "shipping_address_collection[allowed_countries][0]": "GB",
    billing_address_collection: "required",
  };
  // ⛔КЛЮЧ ИДЕМПОТЕНТНОСТИ — ОТ ПОПЫТКИ, а не от id дизайна. Он обязан быть одинаковым у
  //   всех запросов одной попытки, включая одновременные.
  const idem_key = `att_${attempt}`;
  const marker = { attempt, mode: cfg.mode, fp, design_id: id, idem_key, params, started_ms: Date.now() };

  // ⛔МЕТКА ДО ВЫЗОВА STRIPE И ТОЛЬКО СОЗДАНИЕМ. Потеряется ответ — повтор найдёт метку,
  //   возьмёт ТЕ ЖЕ параметры и ТОТ ЖЕ ключ. Проиграем гонку — увидим null и пойдём по
  //   чужой метке вместо того, чтобы затереть её своей и создать вторую оплату.
  let mput;
  try {
    mput = await env.DESIGNS.put(aKey, JSON.stringify(marker), {
      httpMetadata: { contentType: "application/json" },
      onlyIf: { etagDoesNotMatch: "*" },
    });
  } catch (e) {
    console.log("attempt marker write failed", attempt, e && e.name);
    return json({ error: "storage_unavailable" }, 503);
  }
  if (!mput) {
    let winner;
    try {
      winner = await readJson(env.DESIGNS, aKey);
    } catch (e) {
      console.log("winner marker read failed", attempt, e && e.name);
      return json({ error: "storage_unavailable" }, 503);
    }
    if (!winner) return json({ error: "storage_unavailable" }, 503);
    console.log("attempt race lost, following winner", attempt);
    if (winner.session_url) {
      return json({ id: winner.design_id, payment_link: winner.session_url, repeat: true });
    }
    return await linkExisting(env, aKey, winner, cfg, attempt);
  }

  const res = await stripe(env, "checkout/sessions", params, idem_key);
  if (res.status === 409) {
    // ⚠️Stripe: по этому ключу уже идёт запрос. Второй такой же сейчас в полёте — ссылку
    //   не выдумываем, клиент повторит и получит ту же сессию.
    console.log("stripe idempotent request in flight", attempt);
    return json({ error: "checkout_busy" }, 503);
  }
  if (!res.ok || !res.data.url) {
    console.log("stripe create failed", id, res.status);
    return json({ error: "checkout_unavailable" }, 503);   // ссылки нет
  }
  // ⛔ТРЕТЬЯ СВЕРКА РЕЖИМА: объявленный ≠ режим СОЗДАННОЙ сессии — ссылку не отдаём.
  //   Ключ и таблица уже сошлись выше; это последнее место, где расхождение ещё видно.
  if (res.data.livemode !== (cfg.mode === "live")) {
    console.log("session mode mismatch", id, res.data.livemode);
    return json({ error: "not_configured", detail: "mode_session_mismatch" }, 503);
  }
  try {
    await env.DESIGNS.put(aKey, JSON.stringify({ ...marker, session_id: res.data.id, session_url: res.data.url }),
      { httpMetadata: { contentType: "application/json" } });
  } catch (e) {
    // ③сессия создана, связь не записана. Ссылку НЕ отдаём: покупатель заплатит, а мы
    //   не будем знать, за что. Повтор восстановит связь тем же ключом.
    console.log("session link write failed", id, e && e.name);
    return json({ error: "storage_unavailable" }, 503);
  }

  return json({ id, payment_link: res.data.url });
}

/* ⛔ЧТЕНИЯ НЕТ НАМЕРЕННО. PUT и DELETE Pages сам отбивает 405, а вот GET — НЕТ: проверено
   живыми запросами 13.09, `GET /api/design` возвращал 200 с главной страницей сайта, потому
   что у GET есть откат на статику. Утечки это не давало (в теле HTML, не запись), но
   отвечать «200 OK» на чтение эндпоинта, у которого чтения не существует, нельзя.
   ⚠️Именно этот случай показал, почему методы надо проверять запросами, а не по исходнику:
   по коду казалось, что 405 отдаётся сам. Свой `onRequest` здесь был бы ошибкой другого
   рода — он перехватывает ВСЕ методы, и возврат undefined сломал бы сам POST. */
export const onRequestGet = () => json({ error: "method_not_allowed" }, 405);
