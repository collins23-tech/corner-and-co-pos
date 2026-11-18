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

## Android and Google Play

The site includes a web app manifest, Android-sized icons, and a public privacy policy so it can be installed as a web app. A Google Play release still needs an Android Trusted Web Activity package signed with an upload key, a Digital Asset Links statement containing the final Play signing certificate, a Play Console developer account, and the store owner's completed listing and privacy disclosures. Do not publish until the app's public support contact and reviewer access instructions are configured.

The POS requires an internet connection to authenticate and read or save store data. It does not process payments.

## What is persisted

- Products, prices, and stock levels are initialized with the sample catalog and stored in Netlify Blobs.
- Completed orders include their line items, tax, discounts, payment method, customer, and note. Stock is decremented in the same versioned write as the order.
- The order API validates prices and quantities on the server and uses an idempotency key to prevent a retried checkout from recording twice.
- PIN sessions use an HTTP-only, signed cookie. Incorrect attempts are rate-limited per IP.

Card, cash, and other selections record a payment method only. They do not process or charge payments. Connect a payment provider before accepting card payments through the app.
