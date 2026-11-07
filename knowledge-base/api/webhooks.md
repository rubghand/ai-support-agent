---
id: api-webhooks
title: Webhooks
url: https://docs.ledgerly.example/api/webhooks
category: api
updated: 2026-07-07
---

# Webhooks

Webhooks send an HTTP POST to your server when something happens in Ledgerly. Configure endpoints under
**Settings → API → Webhooks** (requires an `admin` API key or the Owner/Admin role).

## Events

`invoice.created`, `invoice.sent`, `invoice.paid`, `invoice.overdue`, `invoice.voided`, `payment.succeeded`,
`payment.failed`, `client.created`, `payout.paid`.

## Verifying signatures

Each request includes a `Ledgerly-Signature` header: an HMAC-SHA256 of the raw request body using your endpoint's
signing secret. Compare it with a constant-time comparison and reject requests older than 5 minutes (use the
`Ledgerly-Timestamp` header).

## Retries

Respond with a 2xx status within 10 seconds. Otherwise we retry with exponential backoff for up to **3 days**
(about 15 attempts). After 3 days of failures the endpoint is disabled and the Owner gets an email.

## Ordering

Events may arrive out of order or more than once. Use the event `id` to deduplicate.
