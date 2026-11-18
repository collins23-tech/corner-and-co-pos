import {
  calculateOrder,
  errorResponse,
  hasValidSession,
  jsonResponse,
  readJson,
  readState,
  updateState,
} from "./_shared/pos.mjs";

export default async (request) => {
  if (!hasValidSession(request)) return errorResponse("PIN required.", 401);

  if (request.method === "GET") {
    try {
      const state = await readState();
      const requestedLimit = Number(new URL(request.url).searchParams.get("limit")) || 50;
      const limit = Math.max(1, Math.min(200, Math.floor(requestedLimit)));
      return jsonResponse({ orders: state.orders.slice(-limit).reverse() });
    } catch (error) {
      console.error("Could not load order history.", error);
      return errorResponse("Could not load orders. Please try again.", 500);
    }
  }

  if (request.method !== "POST") {
    return errorResponse("Method not allowed.", 405, { Allow: "GET, POST" });
  }

  try {
    const body = await readJson(request);
    if (!body || typeof body !== "object" || Array.isArray(body) ||
        typeof body.idempotencyKey !== "string" || !/^[\w-]{16,80}$/.test(body.idempotencyKey)) {
      return errorResponse("A valid sale request ID is required.", 400);
    }
    const outcome = await updateState((state) => {
      const previous = state.orders.find((order) => order.idempotencyKey === body.idempotencyKey);
      if (previous) return { state, result: { order: previous, duplicate: true } };

      const order = calculateOrder(state, body);
      for (const sold of order.items) {
        const product = state.products.find((item) => item.id === sold.productId);
        product.stock -= sold.quantity;
      }
      state.orders.push(order);
      state.nextOrderNumber += 1;
      return { state, result: { order, duplicate: false } };
    });

    return jsonResponse({ order: outcome.order }, outcome.duplicate ? 200 : 201);
  } catch (error) {
    if (error.status === 409) return errorResponse(error.message, 409);
    if (error instanceof SyntaxError || error.message === "Send a JSON request." || error.message === "Request is too large." || error.message === "Request body must be valid JSON.") {
      return errorResponse(error.message, 400);
    }
    if (error.message === "The register is busy. Please retry the sale.") {
      return errorResponse(error.message, 503, { "Retry-After": "1" });
    }
    if (error.message?.includes("required") || error.message?.includes("invalid") || error.message?.includes("include") || error.message?.includes("exceed")) {
      return errorResponse(error.message, 400);
    }
    console.error("Could not record the sale.", error);
    return errorResponse("Could not record the sale. Please try again.", 500);
  }
};
