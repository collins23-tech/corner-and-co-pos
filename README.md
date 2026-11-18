# Corner & Co. POS

A lightweight point-of-sale app hosted as a static Netlify site with Netlify Functions and Netlify Blobs for server-side inventory and order storage.

## Local development

Requires Node.js 22.13 or newer.

```sh
npm install
Copy-Item .env.example .env
npm run dev
```

Set `STORE_PIN` to a private register PIN of at least 8 characters and `POS_SESSION_SECRET` to a separate random secret of at least 32 characters in `.env` for local development. Set the same variables in the Netlify site environment for production; never commit `.env`.

## What is persisted

- Products, prices, and stock levels are initialized with the sample catalog and stored in Netlify Blobs.
- Completed orders include their line items, tax, discounts, payment method, customer, and note. Stock is decremented in the same versioned write as the order.
- The order API validates prices and quantities on the server and uses an idempotency key to prevent a retried checkout from recording twice.
- PIN sessions use an HTTP-only, signed cookie. Incorrect attempts are rate-limited per IP.

Card, cash, and other selections record a payment method only. They do not process or charge payments. Connect a payment provider before accepting card payments through the app.
