# Calculator Integrations Design

Calculator issues generic, user-managed integration credentials for Atlas and future clients. It owns identity, scopes, expiry, revocation, audit, and bearer validation; Atlas is only a client. Existing administrative, engine, connector, and Signal service secrets are never accepted as integration credentials.

Tokens are named connection records with owner, team/project scope, capabilities, expiry, revocation and last-used metadata. Recovery tokens are displayed once and only a hash/prefix is stored. The first capability is `intelligence.analyze`; expiry defaults to 30 days and is required.

The versioned bearer contract is `/api/integrations/v1`: `GET /capabilities` returns non-secret connection status and `POST /analyze` accepts bounded read-only Atlas context. Browser-session management creates, lists and revokes records, but browser cookies never authenticate integration APIs. Atlas calls only this contract, keeps its environment variables as a temporary migration fallback, and remains functional while Calculator is unavailable.
