---
id: payment-methods
title: Payment methods and fees
url: https://docs.ledgerly.example/payments/payment-methods
category: payments
updated: 2026-09-02
---

# Payment methods and fees

| Method                        | Regions       | Fee                      | Settles in      |
| ----------------------------- | ------------- | ------------------------ | --------------- |
| Card (Visa, Mastercard, Amex) | All supported | 2.9% + $0.30 per payment | 2 business days |
| ACH bank transfer             | US            | 0.8%, capped at $5       | 4 business days |
| SEPA Direct Debit             | EU            | 0.8%, capped at €5       | 5 business days |
| BACS Direct Debit             | UK            | 1%, capped at £4         | 4 business days |

International cards add 1%. Currency conversion adds 1%.

The Scale plan has discounted card fees of **2.5% + $0.30**.

## Who pays the fee?

By default you pay the processing fee. On Growth and Scale you can pass card fees on to clients as a
surcharge, where local law allows it.

## Disputes (chargebacks)

If a client disputes a card payment, the disputed amount plus a **$15 dispute fee** is held. If you win the
dispute, the amount and the fee are returned.
