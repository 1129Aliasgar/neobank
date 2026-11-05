# Live-integration evidence

Screenshots captured from the deployed NeoBank stack and provider sandboxes.
No card PAN/CVV, API keys, webhook secrets or personal data are included.

| File | Provider | What it proves |
| --- | --- | --- |
| `didit-webhook.png` | Didit Sandbox | Webhook destination configured to the deployed API |
| `didit-webhook-overview.png` | Didit Sandbox | Delivery overview for the KYB workflow |
| `didit-webhook-event1.png` | Didit Sandbox | A delivered webhook event |
| `didit-webhook-event2.png` | Didit Sandbox | A delivered webhook event |
| `lithic-card-issuing.png` | Lithic Sandbox | Virtual card created/issued by NeoBank against Sandbox |
| `frontend.png` | NeoBank | Deployed frontend |
| `schema.svg` | NeoBank | Data model for the ledger, cards, team and payments |

## Scope

- **Didit:** the screenshots show real webhook delivery to the deployed API for
  the Sandbox KYB workflow.
- **Lithic:** the evidence is card creation/issuing against Lithic Sandbox. Live
  Lithic webhook delivery is **not** configured — `GET /v1/event_subscriptions`
  returns an empty list and `LITHIC_WEBHOOK_SECRET` is a placeholder. The demo
  simulator calls Lithic's Sandbox authorization endpoint and then delivers an
  HMAC-signed local event through the same ingestion path a real event uses.
  This folder does not claim live Lithic event delivery.
- **Payments:** outbound payments are a labelled simulator, not ACH or wire.
