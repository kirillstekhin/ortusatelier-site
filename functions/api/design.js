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
 * ⛔ЦЕНУ И ССЫЛКУ ВЫБИРАЕТ СЕРВЕР. Сумма от браузера не принимается — её в теле нет вовсе.
 * ⛔В ЛОГИ НЕ ПИСАТЬ ПЕРСОНАЛЬНОЕ. Ни места, ни имён, ни дат рождения — только id и код ошибки.
 * ⚠️ВАЛИДАЦИЯ ОБЯЗАНА СОВПАДАТЬ С PYTHON. Общие примеры: platform/design_store_cases.json,
 *   их гоняют оба проверяющих. Разъедутся — заказ примут здесь и остановят там.
 *
 * Привязки (wrangler / Pages): R2 bucket `DESIGNS` — ОТДЕЛЬНЫЙ ПРИВАТНЫЙ, не тот, где
 * печатные файлы: оттуда наружу уходят presigned-ссылки.
 */

export const SCHEMA_VERSION = 1;
export const MAX_BODY = 4096;
export const LIMITS = { member_name: 24, place: 80, dedication: 60 };
export const MEMBERS_RANGE = [2, 6];
const RATE_WINDOW_S = 60;
const RATE_MAX = 10;

export const CODE_RE =
  /^(SM2|MN2|NT2|FC2)-(\d{8})-(\d{4})-([NS])(\d+)-([EW])(\d+)-Z(-?\d+)-([A-Z]+)-([A-Z0-9]+)-([A-Z]+)$/;

/* Доверенная сетка: продукт+формат → цена и ссылка. Снято из Stripe 13.09.2026.
   ⛔Сумма продукты НЕ различает — Natal и Family стоят одинаково. Различает ссылка. */
export const ORTUS = {
  "natal/PRINT3040":   { pence: 3499, link: "https://buy.stripe.com/14AbJ24AKfyJan1dW07g40i" },
  "natal/PRINT4050":   { pence: 3999, link: "https://buy.stripe.com/28E9AU5EO72d8eTdW07g40j" },
  "natal/PRINT5070":   { pence: 4499, link: "https://buy.stripe.com/eVqdRaaZ84U59iX6ty7g40k" },
  "natal/CLASSIC3040": { pence: 6999, link: "https://buy.stripe.com/aFa14ogjs86hgLpdW07g40l" },
  "natal/CLASSIC4050": { pence: 7999, link: "https://buy.stripe.com/00wbJ27MWaep0Mr2di7g40m" },
  "natal/CLASSIC5070": { pence: 8999, link: "https://buy.stripe.com/3cI00kc3cbit3YDf047g40n" },
  "family/PRINT3040":   { pence: 3499, link: "https://buy.stripe.com/14A6oI5EO3Q13YD4lq7g40o" },
  "family/PRINT4050":   { pence: 3999, link: "https://buy.stripe.com/9B600k0kudqB2Uz7xC7g40p" },
  "family/PRINT5070":   { pence: 4499, link: "https://buy.stripe.com/aFa9AUd7gfyJ1Qvg487g40q" },
  "family/CLASSIC3040": { pence: 6999, link: "https://buy.stripe.com/eVq6oI6IS72d9iXdW07g40r" },
  "family/CLASSIC4050": { pence: 7999, link: "https://buy.stripe.com/14A4gA0ku72dfHl5pu7g40s" },
  "family/CLASSIC5070": { pence: 8999, link: "https://buy.stripe.com/aFa14ogjs72dgLp19e7g40t" },
};

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
  if (!(key in ORTUS)) bad.push(`format=${JSON.stringify(fmt)} не из сетки Ortus`);
  else if (m && m[10] !== fmt) bad.push(`format=${JSON.stringify(fmt)} не совпадает с форматом в design_code (${m[10]})`);

  const place = (((rec && rec.place) || {}).name || "").trim();
  if (product === "natal") {
    if (!place || DASHES.includes(place)) bad.push("натальной нужно настоящее название места, а не прочерк");
    // ⚠️[...] — по кодовым ТОЧКАМ: .length в JS считает единицы UTF-16 и на суррогатных
    //   парах разошёлся бы с len() в Python. Пределы обязаны совпадать в обоих.
    else if ([...place].length > LIMITS.place) bad.push(`место длиннее ${LIMITS.place} символов`);
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

/** d_ + 26 символов base32 = 128 бит. Charset совместим с client_reference_id. */
export function newId() {
  const raw = crypto.getRandomValues(new Uint8Array(16));
  const A = "abcdefghijklmnopqrstuvwxyz234567";
  let bits = 0, acc = 0, out = "";
  for (const b of raw) {
    acc = (acc << 8) | b; bits += 8;
    while (bits >= 5) { out += A[(acc >>> (bits - 5)) & 31]; bits -= 5; }
  }
  if (bits > 0) out += A[(acc << (5 - bits)) & 31];
  return "d_" + out.slice(0, 26);
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

  const problems = validate(body);
  if (problems.length) return json({ error: "invalid", problems }, 400);   // ⚠️problems без перс.данных

  const key = `${body.product}/${body.format}`;
  const grid = ORTUS[key];

  const rec = {
    schema_version: SCHEMA_VERSION,
    id: newId(),
    created: new Date().toISOString().replace(/\.\d+Z$/, "Z"),
    product: body.product,
    design_code: body.design_code.trim(),
    format: body.format,
    expected_pence: grid.pence,
    dedication: ((body.dedication || "").trim()) || null,
  };
  if (body.place) rec.place = {
    name: (body.place.name || "").trim(), lat: body.place.lat, lon: body.place.lon,
  };
  if (Array.isArray(body.members)) rec.members = body.members.map((x) => ({
    name: (x.name || "").trim(), date: x.date,
  }));

  const payload = new TextEncoder().encode(JSON.stringify(rec));
  if (payload.length > MAX_BODY) return json({ error: "too_large", limit: MAX_BODY }, 413);

  // ⛔ЗАПИСЬ ПЕРВОЙ. Ссылку отдаём только если дизайн реально лёг в хранилище.
  try {
    await env.DESIGNS.put(`designs/${rec.id}.json`, payload, {
      httpMetadata: { contentType: "application/json" },
      onlyIf: { etagDoesNotMatch: "*" },        // ⛔перезапись существующего ID запрещена
    });
  } catch (e) {
    console.log("design store write failed", rec.id, e && e.name);   // ⚠️без перс.данных
    return json({ error: "storage_unavailable" }, 503);
  }

  return json({ id: rec.id, payment_link: grid.link });
}

/* ⛔ЧТЕНИЯ НЕТ НАМЕРЕННО: экспортирован только onRequestPost, и Pages сам отвечает 405 на
   остальные методы. Свой onRequest здесь был бы ошибкой — он перехватывает ВСЕ методы,
   и возврат undefined сломал бы сам POST. */
