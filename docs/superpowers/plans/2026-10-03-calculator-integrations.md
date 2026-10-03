# Calculator Integrations Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship Calculator-owned scoped integration credentials and make Atlas use the versioned API.

**Architecture:** Calculator provides the token store and bearer API. Atlas calls the versioned paths, with temporary environment configuration retained only for migration.

**Tech Stack:** Node ESM, Node test runner, Atlas TypeScript/Fastify, Vitest.

**Spec:** `docs/superpowers/specs/2026-10-03-calculator-integrations.md`

## Global Constraints

- Credentials are generic Calculator integrations; do not reuse deployment secrets.
- Store only token hashes, reveal recovery tokens once, and require expiry and capability.
- Use `/api/integrations/v1`; browser session authentication is never bearer authentication.

## Review Focus

- Revoked and expired credentials fail without analysis.
- Browser cookies cannot authenticate integration APIs.
- No token or hash is returned or logged.
- Atlas stays usable if Calculator is unavailable.

---

### Task 1: Calculator integration credential domain

**Files:** `web/auth/integration-tokens.mjs`, `web/tests/integration-tokens.test.mjs`

- [ ] Red: test one-time issuance, hash-only storage, expiry, scope and revocation.
- [ ] Green: implement `createIntegrationTokenStore({file, now, randomBytes})` with `issue`, `authenticate`, `list`, `revoke`.
- [ ] Verify: `node --test web/tests/integration-tokens.test.mjs`.

### Task 2: Calculator integration gateway

**Files:** `web/auth/signol-gateway.mjs`, `web/tests/integration-api-gateway.test.mjs`

- [ ] Red: test bearer-only `/api/integrations/v1/capabilities` and rejected expiry/revocation.
- [ ] Green: add management/capability routes using the token store.
- [ ] Verify focused Node tests.

### Task 3: Atlas integration client

**Files:** `src/intelligence/service.ts`, `test/intelligence/service.test.ts`

- [ ] Red: assert versioned paths and bearer header.
- [ ] Green: change provider paths and retain recoverable unavailable state.
- [ ] Verify focused Vitest test and build.

### Task 4: Documentation and validation

- [ ] Document the setup and environment fallback.
- [ ] Verify Calculator focused tests and Atlas build.
