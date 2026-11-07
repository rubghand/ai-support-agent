---
id: failed-payments
title: Failed payments
url: https://docs.ledgerly.example/payments/failed-payments
category: payments
updated: 2026-08-08
---

# Failed payments

This page is about payments **from your clients** that fail. For problems paying your own Ledgerly
subscription, see [Plans and pricing](https://docs.ledgerly.example/billing/plans-and-pricing).

## Common reasons

- **Card declined**: insufficient funds, expired card, or the bank blocked the charge. The client sees the
  decline reason and can try another card.
- **ACH or SEPA return**: the bank account was closed or had insufficient funds. Bank returns can arrive up to
  5 business days after the payment looked successful.
- **Authentication required**: some European cards require 3D Secure. The client must complete the bank's
  verification step.

## Autopay retries

When an autopay charge fails, Ledgerly retries it **3 times over 7 days** (days 1, 3, and 7). The client gets an
email after each failure with a link to update their payment method. After the last retry the invoice stays
open and normal reminders continue.

## What you should do

Nothing is required — the invoice remains unpaid until the client pays. You can see every attempt on the
invoice's activity timeline.
