# Vercel production setup for Lee Tech

This project is prepared to run as a single Express application on Vercel. The storefront, user dashboard, public username sites, wallet, Paystack endpoints, Resend mail flow, and existing admin features all use the same deployment.

## 1. Add the project domain

In the Vercel project, open **Settings → Domains** and add:

```text
post.leetec.online
```

At the DNS provider for `leetec.online`, create the CNAME record that Vercel displays for this project. Vercel provides the project-specific CNAME value in the domain panel; do not substitute a guessed value. The application expects the base URL to be `https://post.leetec.online`.

## 2. Add production environment variables

Add these variables to the Vercel **Production** environment. Add the same non-secret URL/currency values to Preview only if preview testing is needed.

| Variable | Value |
|---|---|
| `NODE_ENV` | `production` |
| `APP_URL` | `https://post.leetec.online` |
| `PUBLIC_SITE_BASE_URL` | `https://post.leetec.online` |
| `MONGODB_URI` | MongoDB Atlas connection string for the production database |
| `JWT_SECRET` | Unique random value of at least 32 characters |
| `NOTE_ENCRYPTION_KEY` | Different unique random value of at least 32 characters |
| `ADMIN_USERNAME` | Existing admin username |
| `ADMIN_PASSWORD_HASH` | Optional preferred admin hash in `salt:hash` format; otherwise use `ADMIN_PASSWORD` temporarily |
| `ADMIN_PASSWORD` | Existing admin password, only if `ADMIN_PASSWORD_HASH` is not configured |
| `CORS_ORIGINS` | `https://post.leetec.online` |
| `PAYSTACK_SECRET_KEY` | Paystack secret key stored as a Vercel secret variable |
| `PAYSTACK_PUBLIC_KEY` | Paystack public key, if the browser checkout is later expanded to use it directly |
| `PAYSTACK_WEBHOOK_SECRET` | Keep documented; webhook signatures are verified with the Paystack secret key in this implementation |
| `PAYSTACK_CURRENCY` | `KES` |
| `PAYSTACK_CHANNELS` | Leave empty to let Paystack Checkout show the enabled account channels |
| `POST_PRICE_KES` | Initial price, for example `0` during setup; adjust later in the admin dashboard |
| `RESEND_API_KEY` | Resend API key stored as a Vercel secret variable |
| `RESEND_FROM_EMAIL` | For example, `Lee Tech <noreply@updates.leetec.online>` |
| `WHATSAPP_NUMBER` | Existing WhatsApp number in international format |
| `WHATSAPP_GROUP_LINK` | Existing WhatsApp group invite URL |

Never commit `.env`, paste secret keys into source control, or expose `PAYSTACK_SECRET_KEY`, `RESEND_API_KEY`, `JWT_SECRET`, or `NOTE_ENCRYPTION_KEY` to browser code.

## 3. Configure the Paystack webhook

In the Paystack dashboard, set the webhook URL to:

```text
https://post.leetec.online/api/paystack/webhook
```

The endpoint accepts Paystack’s JSON payload, validates the `x-paystack-signature` HMAC, verifies the expected reference, amount, and currency, and credits the wallet exactly once. The browser callback also calls the Paystack verification endpoint, so the ledger remains correct if the user returns before the webhook arrives.

Use Paystack Checkout rather than collecting card details in this application. With `PAYSTACK_CURRENCY=KES` and an empty `PAYSTACK_CHANNELS`, the checkout can show the payment channels enabled for the merchant account, including the Kenya-supported options available to that account. The application never sends the secret key to the browser.

## 4. Configure Resend

In Resend, add the sending domain or recommended sending subdomain, for example:

```text
updates.leetec.online
```

Copy the exact DKIM and SPF records Resend generates into the DNS provider for `leetec.online`. After the domain verifies, configure:

```text
RESEND_FROM_EMAIL=Lee Tech <noreply@updates.leetec.online>
```

The application uses Resend for account verification, password-reset, account-ready, and wallet top-up confirmation messages. If Resend variables are absent, the application logs a server-side warning and still allows local development; production should include them before enabling real account onboarding.

## 5. Deploy and verify

From the repository root:

```bash
npm ci
npm run check
npm test
vercel --prod
```

After deployment, verify these URLs:

```text
https://post.leetec.online/
https://post.leetec.online/api/health
https://post.leetec.online/api/config
https://post.leetec.online/<a-verified-username>
```

`/api/health` should report a connected database. Register a test account, verify the email, create a draft, confirm the public username URL, initialize a Paystack test top-up, and confirm that the balance changes only after Paystack verification/webhook processing. Before enabling live payments, test duplicate webhook delivery and an amount-mismatch payload.

## 6. Generated share images

The existing share buttons now add a generated Lee Tech preview image to the share modal and encode the shared title and summary into the URL. Public pages return dynamic Open Graph and Twitter metadata for crawlers, including a real PNG image at:

```text
https://post.leetec.online/share-card.png?title=Your%20title&subtitle=Your%20summary
```

A shared post or username site can use query parameters such as `shareTitle` and `shareText`; the server uses them to generate the page title, description, and `og:image`. The share-card route is cached for short periods, so updated titles may take a few minutes to appear in a platform’s cached preview.
