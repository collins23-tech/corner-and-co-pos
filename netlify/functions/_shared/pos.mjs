import { createHash, createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import { getStore } from "@netlify/blobs";

const SESSION_COOKIE = "pos_session";
const SESSION_SECONDS = 12 * 60 * 60;
const MIN_PIN_LENGTH = 8;
const LOGIN_WINDOW_MS = 15 * 60 * 1000;
const MAX_LOGIN_FAILURES = 5;
const STATE_KEY = "store";
const products = [
  { id: 1, name: "Sourdough Loaf", category: "Grocery", price: 8.5, emoji: "🍞", color: "#f4eadb", tag: "Best seller", stock: 50 },
  { id: 2, name: "Oat Milk", category: "Drinks", price: 5.25, emoji: "🥛", color: "#e9f0e5", tag: "Organic", stock: 50 },
  { id: 3, name: "Ceramic Mug", category: "Home", price: 18, emoji: "☕", color: "#eee9e2", tag: "Handmade", stock: 50 },
  { id: 4, name: "Wildflower Honey", category: "Grocery", price: 12, emoji: "🍯", color: "#f7edd5", tag: "", stock: 50 },
  { id: 5, name: "House Blend Coffee", category: "Drinks", price: 16, emoji: "🫘", color: "#efe7df", tag: "Local", stock: 50 },
  { id: 6, name: "Olive Oil", category: "Grocery", price: 14.5, emoji: "🫒", color: "#edf0df", tag: "", stock: 50 },
  { id: 7, name: "Linen Tote Bag", category: "Home", price: 22, emoji: "👜", color: "#f0e9dd", tag: "Popular", stock: 50 },
  { id: 8, name: "Lavender Soap", category: "Personal care", price: 7, emoji: "🧼", color: "#eeeaf3", tag: "", stock: 50 },
  { id: 9, name: "Sparkling Water", category: "Drinks", price: 3.5, emoji: "🫧", color: "#e6f1f3", tag: "", stock: 50 },
  { id: 10, name: "Fresh Tulips", category: "Home", price: 15, emoji: "🌷", color: "#f5e8e7", tag: "Fresh", stock: 50 },
  { id: 11, name: "Dark Chocolate", category: "Grocery", price: 6.5, emoji: "🍫", color: "#f0e8e2", tag: "", stock: 50 },
  { id: 12, name: "Hand Cream", category: "Personal care", price: 11, emoji: "🧴", color: "#f1eddf", tag: "", stock: 50 },
];

const stateStore = getStore({ name: "corner-co-pos", consistency: "strong" });
const loginStore = getStore({ name: "corner-co-pos-security", consistency: "strong" });

export function jsonResponse(body, status = 200, headers = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
      ...headers,
    },
  });
}

export function errorResponse(message, status = 400, headers = {}) {
  return jsonResponse({ error: message }, status, headers);
}

export async function readJson(request, maxBytes = 16_384) {
  const contentType = request.headers.get("content-type") || "";
  if (!contentType.toLowerCase().includes("application/json")) {
    throw new Error("Send a JSON request.");
  }
  const body = await request.text();
  if (body.length > maxBytes) throw new Error("Request is too large.");
  try {
    return JSON.parse(body);
  } catch {
    throw new Error("Request body must be valid JSON.");
  }
}

function initialState() {
  return {
    products: products.map((product) => ({ ...product })),
    orders: [],
    nextOrderNumber: 1048,
  };
}

export async function readState() {
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const entry = await stateStore.getWithMetadata(STATE_KEY, { type: "json" });
    if (entry) return entry.data;
    const seed = initialState();
    const result = await stateStore.setJSON(STATE_KEY, seed, { onlyIfNew: true });
    if (result.modified) return seed;
  }
  throw new Error("Could not initialize the POS data store.");
}

export async function updateState(update) {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const entry = await stateStore.getWithMetadata(STATE_KEY, { type: "json" });
    const current = entry?.data || initialState();
    const { state, result } = update(structuredClone(current));
    const write = entry
      ? await stateStore.setJSON(STATE_KEY, state, { onlyIfMatch: entry.etag })
      : await stateStore.setJSON(STATE_KEY, state, { onlyIfNew: true });
    if (write.modified) return result;
  }
  throw new Error("The register is busy. Please retry the sale.");
}

function safeEqual(first, second) {
  const firstHash = createHash("sha256").update(first).digest();
  const secondHash = createHash("sha256").update(second).digest();
  return timingSafeEqual(firstHash, secondHash);
}

function getCookie(request, name) {
  const cookies = request.headers.get("cookie") || "";
  const value = cookies.split(";").map((part) => part.trim()).find((part) => part.startsWith(`${name}=`));
  return value ? value.slice(name.length + 1) : "";
}

function sessionSignature(expiresAt, secret) {
  return createHmac("sha256", secret).update(`${SESSION_COOKIE}:${expiresAt}`).digest("hex");
}

export function hasValidSession(request) {
  const pin = process.env.STORE_PIN;
  const secret = process.env.POS_SESSION_SECRET;
  if (!pin || pin.length < MIN_PIN_LENGTH || !secret || secret.length < 32) return false;
  const [expiresAtText, signature] = getCookie(request, SESSION_COOKIE).split(".");
  const expiresAt = Number(expiresAtText);
  if (!Number.isSafeInteger(expiresAt) || expiresAt <= Date.now() || expiresAt > Date.now() + SESSION_SECONDS * 1000 + 60_000) {
    return false;
  }
  return safeEqual(signature || "", sessionSignature(expiresAt, secret));
}

export function sessionCookie() {
  const secret = process.env.POS_SESSION_SECRET;
  const expiresAt = Date.now() + SESSION_SECONDS * 1000;
  const value = `${expiresAt}.${sessionSignature(expiresAt, secret)}`;
  return `${SESSION_COOKIE}=${value}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=${SESSION_SECONDS}`;
}

export const clearSessionCookie = `${SESSION_COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=0`;

function loginAttemptKey(ip) {
  return `login:${createHash("sha256").update(ip || "unknown").digest("hex")}`;
}

export async function checkLoginLock(ip) {
  const record = await loginStore.get(loginAttemptKey(ip), { type: "json" });
  if (record?.lockedUntil > Date.now()) {
    return Math.ceil((record.lockedUntil - Date.now()) / 1000);
  }
  return 0;
}

export async function recordLoginFailure(ip) {
  const key = loginAttemptKey(ip);
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const entry = await loginStore.getWithMetadata(key, { type: "json" });
    const now = Date.now();
    const previous = entry?.data;
    const record = previous && previous.windowStartedAt + LOGIN_WINDOW_MS > now
      ? previous
      : { windowStartedAt: now, failures: 0, lockedUntil: 0 };
    const failures = record.failures + 1;
    const next = {
      windowStartedAt: record.windowStartedAt,
      failures,
      lockedUntil: failures >= MAX_LOGIN_FAILURES ? now + LOGIN_WINDOW_MS : 0,
    };
    const write = entry
      ? await loginStore.setJSON(key, next, { onlyIfMatch: entry.etag })
      : await loginStore.setJSON(key, next, { onlyIfNew: true });
    if (write.modified) return Math.ceil(next.lockedUntil > now ? LOGIN_WINDOW_MS / 1000 : 0);
  }
  return 60;
}

export async function clearLoginFailures(ip) {
  await loginStore.delete(loginAttemptKey(ip));
}

export async function parseLoginPin(request) {
  if (!process.env.STORE_PIN || process.env.STORE_PIN.length < MIN_PIN_LENGTH ||
      !process.env.POS_SESSION_SECRET || process.env.POS_SESSION_SECRET.length < 32) {
    return { error: "The store has not finished configuring secure access.", status: 503 };
  }
  let body;
  try {
    body = await readJson(request, 1024);
  } catch (error) {
    return { error: error.message, status: 400 };
  }
  if (!body || typeof body !== "object" || typeof body.pin !== "string" || body.pin.length > 128 ||
      !safeEqual(body.pin, process.env.STORE_PIN)) {
    return { error: "Incorrect PIN.", status: 401 };
  }
  return { valid: true };
}

export function calculateOrder(state, body) {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw new Error("The sale request is invalid.");
  }
  if (!Array.isArray(body.items) || body.items.length < 1 || body.items.length > 100) {
    throw new Error("A sale must include between 1 and 100 products.");
  }
  if (typeof body.idempotencyKey !== "string" || !/^[\w-]{16,80}$/.test(body.idempotencyKey)) {
    throw new Error("A valid sale request ID is required.");
  }
  if (!["Cash", "Card", "Other"].includes(body.paymentMethod)) {
    throw new Error("Choose a valid payment method.");
  }
  const discountCents = Number(body.discountCents ?? 0);
  const taxRate = Number(body.taxRate ?? 0.0825);
  if (!Number.isSafeInteger(discountCents) || discountCents < 0 || !Number.isFinite(taxRate) || taxRate < 0 || taxRate > 1) {
    throw new Error("The discount or tax rate is invalid.");
  }
  const customer = typeof body.customer === "string" ? body.customer.trim().slice(0, 120) : "";
  const note = typeof body.note === "string" ? body.note.trim().slice(0, 500) : "";
  const items = [];
  const quantities = new Map();
  for (const requested of body.items) {
    if (!requested || typeof requested !== "object" || Array.isArray(requested)) {
      throw new Error("A product or quantity in this sale is invalid.");
    }
    const productId = Number(requested.productId);
    const quantity = Number(requested.quantity);
    if (!Number.isSafeInteger(quantity) || quantity < 1 || quantity > 999) {
      throw new Error("A product or quantity in this sale is invalid.");
    }
    quantities.set(productId, (quantities.get(productId) || 0) + quantity);
  }
  let subtotalCents = 0;
  for (const [productId, quantity] of quantities) {
    const product = state.products.find((item) => item.id === productId);
    if (!product || !Number.isSafeInteger(quantity)) {
      throw new Error("A product or quantity in this sale is invalid.");
    }
    if (quantity > product.stock) {
      const error = new Error(`${product.name} has only ${product.stock} remaining.`);
      error.status = 409;
      throw error;
    }
    const unitPriceCents = Math.round(product.price * 100);
    subtotalCents += unitPriceCents * quantity;
    items.push({ productId: product.id, name: product.name, quantity, unitPriceCents });
  }
  if (!Number.isSafeInteger(subtotalCents) || discountCents > subtotalCents) {
    throw new Error("The discount cannot exceed the subtotal.");
  }
  const taxCents = Math.round((subtotalCents - discountCents) * taxRate);
  return {
    id: randomUUID(),
    idempotencyKey: body.idempotencyKey,
    orderNumber: state.nextOrderNumber,
    createdAt: new Date().toISOString(),
    customer,
    note,
    paymentMethod: body.paymentMethod,
    items,
    subtotalCents,
    discountCents,
    taxRate,
    taxCents,
    totalCents: subtotalCents - discountCents + taxCents,
  };
}
