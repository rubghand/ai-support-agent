---
id: create-edit-invoices
title: Create, edit, and void invoices
url: https://docs.ledgerly.example/invoices/create-edit-invoices
category: invoices
updated: 2026-09-10
---

# Create, edit, and void invoices

## Invoice statuses

- **Draft**: not sent yet. You can edit anything.
- **Sent**: delivered to the client. You can edit it; the client sees the updated version and gets an
  "invoice updated" email.
- **Partially paid**: some payment received. Line items are locked; you can only change notes and due date.
- **Paid**: fully paid. Locked.
- **Void**: cancelled. Voided invoices stay in your records for audit purposes and keep their number.

## Editing a paid invoice

Paid invoices cannot be edited. To correct a paid invoice, issue a
[credit note](https://docs.ledgerly.example/invoices/credit-notes) and create a new invoice.

## Deleting vs voiding

Only **Draft** invoices can be deleted. Any invoice that was sent must be voided instead. To void, open the
invoice and choose **More → Void invoice**. If the invoice has payments, refund them first.

## Attachments

You can attach up to 5 files (PDF, PNG, JPG; max 10 MB each) to an invoice. Attachments are included as
links in the invoice email.
