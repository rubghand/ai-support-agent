---
id: api-rate-limits
title: API rate limits
url: https://docs.ledgerly.example/api/rate-limits
category: api
updated: 2026-07-07
---

# API rate limits

| Plan   | Requests per minute | Requests per day |
| ------ | ------------------- | ---------------- |
| Growth | 120                 | 50,000           |
| Scale  | 600                 | 500,000          |

Limits apply per account, across all API keys.

## Headers

Every response includes:

- `X-RateLimit-Limit`: your per-minute limit
- `X-RateLimit-Remaining`: requests left in the current window
- `X-RateLimit-Reset`: Unix time when the window resets

## Exceeding the limit

Requests over the limit return **HTTP 429 Too Many Requests** with a `Retry-After` header in seconds. Back off
and retry after that time; we recommend exponential backoff with jitter.

## Bulk endpoints

Use bulk endpoints (`POST /invoices/bulk`, up to 100 invoices per request) to reduce request counts. A bulk
request counts as one request toward the per-minute limit.
