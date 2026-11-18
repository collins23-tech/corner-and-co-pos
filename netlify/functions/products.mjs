import { errorResponse, hasValidSession, jsonResponse, readJson, readState, updateState } from "./_shared/pos.mjs";

export default async (request) => {
  if (!hasValidSession(request)) return errorResponse("PIN required.", 401);

  if (request.method === "PATCH") {
    try {
      const body = await readJson(request);
      if (!body || typeof body !== "object" || Array.isArray(body)) {
        return errorResponse("The product update is invalid.", 400);
      }
      const productId = Number(body.productId);
      const stock = Number(body.stock);
      const price = Number(body.price);
      if (!Number.isSafeInteger(productId) || !Number.isSafeInteger(stock) || stock < 0 || stock > 1_000_000 ||
          !Number.isFinite(price) || price < 0.01 || price > 100_000) {
        return errorResponse("Enter a valid product, price, and stock quantity.", 400);
      }
      const product = await updateState((state) => {
        const found = state.products.find((item) => item.id === productId);
        if (!found) return { state, result: null };
        found.stock = stock;
        found.price = Math.round(price * 100) / 100;
        return { state, result: found };
      });
      if (!product) return errorResponse("Product not found.", 404);
      return jsonResponse({ product });
    } catch (error) {
      if (error.message?.includes("JSON") || error.message === "Send a JSON request." || error.message === "Request is too large.") {
        return errorResponse(error.message, 400);
      }
      console.error("Could not update product inventory.", error);
      return error.message === "The register is busy. Please retry the sale."
        ? errorResponse(error.message, 503)
        : errorResponse("Could not update the product. Please try again.", 500);
    }
  }

  if (request.method !== "GET") {
    return errorResponse("Method not allowed.", 405, { Allow: "GET, PATCH" });
  }
  try {
    const state = await readState();
    return jsonResponse({ products: state.products });
  } catch (error) {
    console.error("Could not read the product catalog.", error);
    return errorResponse("Could not load products. Please try again.", 500);
  }
};
