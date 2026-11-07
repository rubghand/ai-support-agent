---
id: api-authentication
title: API authentication
url: https://docs.ledgerly.example/api/authentication
category: api
updated: 2026-07-07
---

# API authentication

The Ledgerly REST API is available on the **Growth plan and above**. Base URL: `https://api.ledgerly.example/v2`.

## API keys

Create keys under **Settings → API → Create key**. Keys are shown once; store them securely. Each key has a scope:

- `read`: read invoices, clients, and payments
- `write`: everything in `read`, plus create and update
- `admin`: everything, including webhooks and team settings

Send the key as a bearer token:

```
Authorization: Bearer lk_live_xxxxxxxxxxxx
```

Test keys start with `lk_test_` and only work against the sandbox at `https://sandbox.api.ledgerly.example/v2`.

## Rotating keys

Create a new key, update your integration, then revoke the old key. Revoked keys stop working immediately.
Keys that haven't been used in 12 months are revoked automatically, with an email warning 14 days before.

## OAuth

Partners building public integrations should use OAuth 2.0 instead of API keys. Contact partners@ledgerly.example.
