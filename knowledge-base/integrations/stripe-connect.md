---
id: stripe-connect
title: Use your own Stripe account
url: https://docs.ledgerly.example/integrations/stripe-connect
category: integrations
updated: 2026-04-28
---

# Use your own Stripe account

If Ledgerly Payments isn't available in your country, or you already process payments with Stripe, you can
connect your own Stripe account instead.

## Connect

Go to **Settings → Payments → Use my Stripe account** and sign in to Stripe. You can't use Ledgerly Payments and
your own Stripe account at the same time.

## Differences from Ledgerly Payments

- Stripe's fees apply instead of Ledgerly's; Ledgerly adds no extra fee.
- Payouts, disputes, and refunds are managed in your Stripe dashboard.
- ACH and SEPA availability depends on your Stripe account settings.

## Disconnecting

If you disconnect Stripe, open invoices lose their pay button until you connect a payment provider again.
Autopay mandates stored in Stripe can't be moved to Ledgerly Payments; clients must re-enter their payment
details.
