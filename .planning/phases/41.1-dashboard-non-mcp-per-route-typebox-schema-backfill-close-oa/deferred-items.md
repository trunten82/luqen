
## Pre-existing failure surfaced during 41.1-05

**Test:** `packages/dashboard/tests/routes/oauth/register.test.ts` — "returns 201 with dcr_-prefixed client_id and null client_secret"
**Failure:** `expected '' to be null` — handler returns `{ client_secret: null }` but Fastify response serializer (using `ClientRegistrationResponseSchema` with `client_secret: Type.Optional(Type.String())`) coerces null to `""`.
**Pre-existing:** Confirmed by stashing all 41.1-05 changes and re-running — test fails identically on master HEAD (5381b44).
**Out of scope for 41.1-05:** OAPI-04 closure plan does not include fixing existing schema strictness bugs in `oauth/register.ts`. Logged here for a future plan.
**Suggested fix:** Either change handler to omit `client_secret` for public clients (cleaner per RFC 7591 §3.2.1) OR change schema to `Type.Union([Type.String(), Type.Null()])`.
