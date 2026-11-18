let products = [];
const cart = new Map();
let activeCategory = "All";
let discount = 0;
let taxRate = 0.0825;
let toastTimer;
let customerName = "";
let saleNote = "";
let orders = [];
let currentOrderRequestId = "";
let submittingPayment = false;
let saleSubmissionUncertain = false;

const money = (value) => `$${value.toFixed(2)}`;
const grid = document.querySelector("#product-grid");
const cartItems = document.querySelector("#cart-items");
const emptyCart = document.querySelector("#empty-cart");
const searchInput = document.querySelector("#product-search");
const toast = document.querySelector("#toast");
const modal = document.querySelector("#modal-backdrop");

async function api(path, options = {}) {
  const response = await fetch(path, {
    ...options,
    credentials: "same-origin",
    headers: { "Content-Type": "application/json", ...options.headers },
  });
  if (response.status === 204) return null;
  const result = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(result.error || "The POS service could not complete the request.");
    error.status = response.status;
    throw error;
  }
  return result;
}

function showLoginError(message) {
  const error = document.querySelector("#login-error");
  error.textContent = message;
  error.hidden = false;
}

async function loadRegister() {
  const [productData, orderData] = await Promise.all([
    api("/api/products"),
    api("/api/orders?limit=200"),
  ]);
  products = productData.products;
  orders = orderData.orders;
  renderProducts();
  renderCart();
  renderStats();
  renderOrders();
  renderInventory();
  document.querySelector("#order-number").textContent = `#${orders.length ? orders[0].orderNumber + 1 : 1048}`;
  document.body.classList.add("authenticated");
}

function renderProducts() {
  const query = searchInput.value.trim().toLowerCase();
  const visible = products.filter((product) => {
    const matchesCategory = activeCategory === "All" || product.category === activeCategory;
    return matchesCategory && `${product.name} ${product.category}`.toLowerCase().includes(query);
  });

  grid.innerHTML = visible.length
    ? visible.map((product) => `
      <article class="product-card" data-product-id="${product.id}" tabindex="0" aria-label="Add ${product.name}, ${money(product.price)}">
        <div class="product-art" style="background:${product.color}">
          ${product.tag ? `<span class="product-tag">${product.tag}</span>` : ""}
          <i class="stock-dot ${product.stock > 0 ? "" : "out-of-stock"}" aria-label="${product.stock > 0 ? `${product.stock} in stock` : "Out of stock"}"></i>
          <span class="product-emoji" aria-hidden="true">${product.emoji}</span>
        </div>
        <div class="product-info">
          <span class="product-name">${product.name}</span>
          <div class="product-meta"><span class="product-price">${money(product.price)}</span><button class="add-product" type="button" aria-label="Add ${product.name}" ${product.stock <= 0 || saleSubmissionUncertain ? "disabled" : ""}>+</button></div>
        </div>
      </article>`).join("")
    : '<div class="no-results">No products found. Try a different search.</div>';
  document.querySelector("#product-count").textContent = `Showing ${visible.length} of ${products.length} products`;
  document.querySelector('.category-tab[data-category="All"] span').textContent = products.length;
  document.querySelectorAll(".category-tab").forEach((tab) => {
    const isActive = tab.dataset.category === activeCategory;
    tab.classList.toggle("selected", isActive);
    tab.setAttribute("aria-selected", String(isActive));
  });
}

function addToCart(id) {
  const product = products.find((item) => item.id === id);
  if (!product) return;
  const item = cart.get(id);
  if ((item?.quantity || 0) >= product.stock) {
    showToast(`Only ${product.stock} ${product.name} in stock`);
    return;
  }
  if (item) item.quantity += 1;
  else cart.set(id, { ...product, quantity: 1 });
  renderCart();
  showToast(`${product.name} added to sale`);
}

function changeQuantity(id, amount) {
  const item = cart.get(id);
  if (!item) return;
  item.quantity += amount;
  if (item.quantity <= 0) cart.delete(id);
  renderCart();
}

function getTotals() {
  const subtotalCents = [...cart.values()].reduce((sum, item) => sum + Math.round(item.price * 100) * item.quantity, 0);
  const discountCents = Math.round(discount * 100);
  const taxableCents = Math.max(0, subtotalCents - discountCents);
  const taxCents = Math.round(taxableCents * taxRate);
  return { subtotal: subtotalCents / 100, tax: taxCents / 100, total: (taxableCents + taxCents) / 100 };
}

function renderCart() {
  const items = [...cart.values()];
  cartItems.innerHTML = items.map((item) => `
    <div class="cart-item">
      <div class="cart-thumb" style="background:${item.color}" aria-hidden="true">${item.emoji}</div>
      <div class="cart-item-main"><span class="cart-item-name">${item.name}</span><span class="cart-item-price">${money(item.price)} each</span></div>
      <div class="quantity-control"><button type="button" data-quantity="-1" data-id="${item.id}" aria-label="Remove one ${item.name}" ${saleSubmissionUncertain ? "disabled" : ""}>−</button><span>${item.quantity}</span><button type="button" data-quantity="1" data-id="${item.id}" aria-label="Add one ${item.name}" ${item.quantity >= item.stock || saleSubmissionUncertain ? "disabled" : ""}>+</button></div>
      <span class="line-total">${money(item.price * item.quantity)}</span>
    </div>`).join("");
  emptyCart.hidden = items.length > 0;
  cartItems.hidden = items.length === 0;
  document.querySelector(".discount-row").hidden = items.length === 0;
  const quantity = items.reduce((sum, item) => sum + item.quantity, 0);
  document.querySelector("#item-count").textContent = `${quantity} ${quantity === 1 ? "item" : "items"}`;
  const totals = getTotals();
  document.querySelector("#subtotal").textContent = money(totals.subtotal);
  document.querySelector("#discount-total-row").hidden = discount === 0;
  document.querySelector("#discount-total").textContent = `−${money(discount)}`;
  document.querySelector("#tax").textContent = money(totals.tax);
  document.querySelector("#total").textContent = money(totals.total);
  document.querySelector("#charge-total").textContent = money(totals.total);
  document.querySelector("#charge-button").disabled = items.length === 0 || saleSubmissionUncertain;
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  })[character]);
}

function renderStats() {
  const today = new Date().toLocaleDateString("en-CA");
  const todaysOrders = orders.filter((order) => new Date(order.createdAt).toLocaleDateString("en-CA") === today);
  const salesCents = todaysOrders.reduce((sum, order) => sum + order.totalCents, 0);
  document.querySelector("#stat-sales").textContent = money(salesCents / 100);
  document.querySelector("#stat-orders").textContent = String(todaysOrders.length);
  document.querySelector("#stat-average").textContent = money(todaysOrders.length ? salesCents / todaysOrders.length / 100 : 0);
  document.querySelector("#orders-count").textContent = String(orders.length);
}

function renderOrders() {
  const list = document.querySelector("#orders-list");
  if (!orders.length) {
    list.innerHTML = '<div class="orders-empty">No completed sales yet.</div>';
    return;
  }
  list.innerHTML = orders.map((order) => {
    const date = new Date(order.createdAt).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
    const customer = order.customer ? escapeHtml(order.customer) : "Walk-in customer";
    const units = order.items.reduce((sum, item) => sum + item.quantity, 0);
    return `<article class="order-history-item">
      <div class="order-history-main"><strong>Order #${order.orderNumber}</strong><span>${date} · ${customer}</span><span>${units} ${units === 1 ? "item" : "items"} · ${escapeHtml(order.paymentMethod)}</span></div>
      <span class="order-history-total">${money(order.totalCents / 100)}</span>
    </article>`;
  }).join("");
}

function renderInventory() {
  document.querySelector("#inventory-list").innerHTML = products.map((product) => `
    <div class="inventory-row" data-inventory-id="${product.id}">
      <span class="inventory-product" title="${escapeHtml(product.name)}">${escapeHtml(product.name)}</span>
      <label class="inventory-field">Price<input data-field="price" type="number" min="0.01" max="100000" step="0.01" value="${product.price.toFixed(2)}" /></label>
      <label class="inventory-field">In stock<input data-field="stock" type="number" min="0" max="1000000" step="1" value="${product.stock}" /></label>
      <button class="inventory-save" type="button" data-save-product="${product.id}">Save</button>
    </div>`).join("");
}

function showToast(message) {
  toast.textContent = message;
  toast.classList.add("visible");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove("visible"), 2300);
}

function showPayment() {
  if (!cart.size) return;
  if (!currentOrderRequestId) currentOrderRequestId = crypto.randomUUID();
  document.querySelector("#payment-total").textContent = money(getTotals().total);
  document.querySelector("#modal-eyebrow").textContent = "COMPLETE SALE";
  document.querySelector("#modal-title").textContent = "Choose a payment method";
  document.querySelector("#modal-description").textContent = "Record the payment after taking it using your usual method.";
  document.querySelector(".payment-methods").hidden = false;
  document.querySelector("#modal-symbol").textContent = "↗";
  modal.classList.remove("success");
  modal.hidden = false;
  document.querySelector("#modal-close").focus();
}

async function completePayment(paymentMethod) {
  if (submittingPayment || !cart.size) return;
  submittingPayment = true;
  const paymentButtons = [...document.querySelectorAll(".payment-option")];
  paymentButtons.forEach((button) => { button.disabled = true; });
  try {
    const { order } = await api("/api/orders", {
      method: "POST",
      body: JSON.stringify({
        idempotencyKey: currentOrderRequestId,
        paymentMethod,
        customer: customerName,
        note: saleNote,
        discountCents: Math.round(discount * 100),
        taxRate,
        items: [...cart.values()].map((item) => ({ productId: item.id, quantity: item.quantity })),
      }),
    });
    document.querySelector("#modal-eyebrow").textContent = "SALE SAVED";
    document.querySelector("#modal-title").textContent = "Sale recorded";
    document.querySelector("#modal-description").textContent = `${order.paymentMethod} marked as paid for order #${order.orderNumber}. No charge was processed.`;
    document.querySelector("#modal-symbol").textContent = "✓";
    modal.classList.add("success");
    document.querySelector(".payment-methods").hidden = true;
    for (const sold of order.items) {
      const product = products.find((item) => item.id === sold.productId);
      if (product) product.stock = Math.max(0, product.stock - sold.quantity);
    }
    orders = [order, ...orders.filter((item) => item.id !== order.id)].slice(0, 200);
    cart.clear();
    discount = 0;
    customerName = "";
    saleNote = "";
    document.querySelector("#customer-label").textContent = "Add a customer";
    renderCart();
    renderProducts();
    renderOrders();
    renderStats();
    currentOrderRequestId = "";
    saleSubmissionUncertain = false;
    document.querySelector("#modal-close").disabled = false;
    document.querySelector("#new-order").disabled = false;
    showToast("Sale saved to order history");
  } catch (error) {
    showToast(error.message);
    if (!error.status || error.status >= 500) {
      saleSubmissionUncertain = true;
      document.querySelector("#modal-close").disabled = true;
      document.querySelector("#new-order").disabled = true;
      document.querySelector("#modal-description").textContent = "The result is not confirmed. Retry a payment option to safely check this same sale.";
      renderCart();
      renderProducts();
    }
    if (error.status === 401) {
      modal.hidden = true;
      document.body.classList.remove("authenticated");
    }
  } finally {
    submittingPayment = false;
    paymentButtons.forEach((button) => { button.disabled = false; });
  }
}

grid.addEventListener("click", (event) => {
  const card = event.target.closest("[data-product-id]");
  if (card) addToCart(Number(card.dataset.productId));
});
grid.addEventListener("keydown", (event) => {
  const card = event.target.closest("[data-product-id]");
  if (card && (event.key === "Enter" || event.key === " ")) {
    event.preventDefault();
    addToCart(Number(card.dataset.productId));
  }
});
cartItems.addEventListener("click", (event) => {
  const button = event.target.closest("[data-quantity]");
  if (button) changeQuantity(Number(button.dataset.id), Number(button.dataset.quantity));
});
searchInput.addEventListener("input", renderProducts);
document.querySelector(".category-tabs").addEventListener("click", (event) => {
  const tab = event.target.closest("[data-category]");
  if (!tab) return;
  activeCategory = tab.dataset.category;
  renderProducts();
});
document.querySelector("#show-all").addEventListener("click", () => {
  activeCategory = "All";
  searchInput.value = "";
  renderProducts();
});
document.querySelector("#new-order").addEventListener("click", () => {
  if (saleSubmissionUncertain) return;
  if (cart.size && !window.confirm("Start a new sale? The current items will be cleared.")) return;
  cart.clear();
  discount = 0;
  customerName = "";
  saleNote = "";
  currentOrderRequestId = "";
  saleSubmissionUncertain = false;
  document.querySelector("#order-number").textContent = `#${orders.length ? orders[0].orderNumber + 1 : 1048}`;
  document.querySelector("#customer-label").textContent = "Add a customer";
  document.querySelector("#order-time").textContent = "Just now";
  renderCart();
  showToast("New sale started");
});
document.querySelector("#charge-button").addEventListener("click", showPayment);
document.querySelector("#modal-close").addEventListener("click", () => { if (!saleSubmissionUncertain) modal.hidden = true; });
modal.addEventListener("click", (event) => { if (event.target === modal && !saleSubmissionUncertain) modal.hidden = true; });
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && !saleSubmissionUncertain) modal.hidden = true;
  if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
    event.preventDefault();
    searchInput.focus();
  }
});
document.querySelector(".payment-methods").addEventListener("click", async (event) => {
  const option = event.target.closest("[data-payment]");
  if (!option) return;
  await completePayment(option.dataset.payment);
});
document.querySelector("#customer-select").addEventListener("click", () => {
  const name = window.prompt("Enter the customer's name:");
  if (name === null) return;
  customerName = name.trim();
  document.querySelector("#customer-label").textContent = customerName || "Add a customer";
  if (customerName) showToast(`${customerName} added to sale`);
});
document.querySelector("#discount-button").addEventListener("click", () => {
  const input = window.prompt("Enter a discount amount in dollars:", discount ? discount.toFixed(2) : "");
  if (input === null) return;
  const amount = Number(input);
  if (!Number.isFinite(amount) || amount < 0 || amount > getTotals().subtotal) {
    showToast("Enter a valid discount up to the subtotal");
    return;
  }
  discount = amount;
  renderCart();
  showToast(amount ? `${money(amount)} discount applied` : "Discount removed");
});
document.querySelector("#note-button").addEventListener("click", () => {
  const note = window.prompt("Add a note for this sale:");
  if (note !== null) {
    saleNote = note.trim().slice(0, 500);
    showToast(saleNote ? "Sale note saved" : "Sale note cleared");
  }
});
document.querySelector("#tax-rate").addEventListener("click", () => {
  const input = window.prompt("Enter tax rate as a percentage:", (taxRate * 100).toFixed(2));
  if (input === null) return;
  const rate = Number(input);
  if (!Number.isFinite(rate) || rate < 0 || rate > 100) {
    showToast("Enter a tax rate between 0 and 100");
    return;
  }
  taxRate = rate / 100;
  document.querySelector("#tax-rate").textContent = `${rate}% ⌄`;
  renderCart();
});
document.querySelector("#filter-button").addEventListener("click", () => showToast("Showing in-stock products"));
document.querySelector("#manage-products").addEventListener("click", () => {
  renderInventory();
  document.querySelector("#products-backdrop").hidden = false;
  document.querySelector("#products-close").focus();
});
document.querySelector("#sale-menu").addEventListener("click", () => showToast("Sale options: start a new sale or add a note"));

document.querySelector("#login-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const input = document.querySelector("#store-pin");
  const submit = document.querySelector(".login-submit");
  const error = document.querySelector("#login-error");
  error.hidden = true;
  submit.disabled = true;
  try {
    await api("/api/auth", { method: "POST", body: JSON.stringify({ pin: input.value }) });
    input.value = "";
    await loadRegister();
  } catch (loginError) {
    showLoginError(loginError.status === 503
      ? "Register access hasn't been configured yet. Ask the site owner to finish setup."
      : loginError.message);
  } finally {
    submit.disabled = false;
  }
});

document.querySelector("#logout-button").addEventListener("click", async () => {
  try {
    await api("/api/auth", { method: "DELETE" });
    cart.clear();
    products = [];
    orders = [];
    document.body.classList.remove("authenticated");
    document.querySelector("#store-pin").focus();
  } catch (error) {
    showToast(error.message);
  }
});

document.querySelector("#orders-link").addEventListener("click", (event) => {
  event.preventDefault();
  document.querySelector("#orders-backdrop").hidden = false;
  document.querySelector("#orders-close").focus();
});
document.querySelector("#orders-close").addEventListener("click", () => {
  document.querySelector("#orders-backdrop").hidden = true;
});
document.querySelector("#orders-backdrop").addEventListener("click", (event) => {
  if (event.target.id === "orders-backdrop") event.currentTarget.hidden = true;
});
document.querySelector("#products-close").addEventListener("click", () => {
  document.querySelector("#products-backdrop").hidden = true;
});
document.querySelector("#products-backdrop").addEventListener("click", (event) => {
  if (event.target.id === "products-backdrop") event.currentTarget.hidden = true;
});
document.querySelector("#inventory-list").addEventListener("click", async (event) => {
  const button = event.target.closest("[data-save-product]");
  if (!button) return;
  const row = button.closest("[data-inventory-id]");
  const productId = Number(button.dataset.saveProduct);
  const price = Number(row.querySelector('[data-field="price"]').value);
  const stock = Number(row.querySelector('[data-field="stock"]').value);
  button.disabled = true;
  try {
    const result = await api("/api/products", {
      method: "PATCH",
      body: JSON.stringify({ productId, price, stock }),
    });
    products = products.map((product) => product.id === productId ? result.product : product);
    const cartItem = cart.get(productId);
    if (cartItem) {
      cartItem.price = result.product.price;
      cartItem.stock = result.product.stock;
      renderCart();
    }
    renderProducts();
    showToast(`${result.product.name} updated`);
  } catch (error) {
    showToast(error.message);
  } finally {
    button.disabled = false;
  }
});
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && !saleSubmissionUncertain) {
    modal.hidden = true;
    document.querySelector("#orders-backdrop").hidden = true;
    document.querySelector("#products-backdrop").hidden = true;
  }
});

const today = new Date();
document.querySelector("#current-date").textContent = today.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
document.querySelector("#intro-date").textContent = today.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", year: "numeric" }).toUpperCase();

api("/api/auth").then(loadRegister).catch((error) => {
  document.body.classList.remove("authenticated");
  if (error.status === 401) {
    document.querySelector("#store-pin").focus();
    return;
  }
  showLoginError(error.status === 503
    ? "Register access hasn't been configured yet. Ask the site owner to finish setup."
    : "Cannot reach the POS service. Open the hosted register or try again later.");
});
