---
id: email-delivery
title: Email delivery problems
url: https://docs.ledgerly.example/troubleshooting/email-delivery
category: troubleshooting
updated: 2026-08-30
---

# Email delivery problems

## My client didn't receive the invoice

1. Open the invoice and check the activity timeline. It shows **Delivered**, **Opened**, or **Bounced**.
2. If it **bounced**, check the client's email address for typos, fix it, and resend.
3. If it was **delivered** but the client can't find it, ask them to check spam and to allow
   `invoices@ledgerly.example`.
4. You can always copy the invoice link (**More → Copy link**) and send it yourself.

## Send from your own domain

On Growth and Scale, invoice emails can be sent from your own domain. Add the SPF and DKIM records shown under
**Settings → Email** and click **Verify**. DNS changes can take up to 48 hours.

## Suppressed addresses

If an address hard-bounced or marked our email as spam, it's added to a suppression list and we stop sending to
it. Remove it from the suppression list under **Settings → Email → Suppressed** once the client confirms the
address works.
