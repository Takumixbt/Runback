# Security

## Reporting a vulnerability

Please report privately, not as a public issue.

Use [GitHub's private advisory form](https://github.com/Takumixbt/runback/security/advisories/new).
If that is unavailable, email **Takumixbt@gmail.com**.

Expect an acknowledgement within a few days. Please give a reasonable window for a fix
before disclosing publicly.

Include what you need to make it reproducible: the request, the response, and what the
impact is. A proof of concept is welcome. Please do not run load or denial-of-service tests
against the deployed site or against any venue's API through it.

## What is in scope

Runback holds no accounts, no keys, and no user data. There is no database, no session, no
login, and nothing is written anywhere. Everything on screen is derived from public
exchange APIs. So the realistic surface is small and specific:

- **`/api/x/{venue}`** (`src/app/api/x/[venue]/route.ts`) — the only server route that
  makes an outbound request. It takes a path, not a URL, and the host is chosen from an
  allowlist in `src/lib/http.ts`, redirects are refused, responses are capped and must be
  JSON. Anything that gets it to fetch a host that is not on that allowlist, follow a
  redirect, return a non-JSON body, or read a path it should not — that is a finding.
- **`/api/traders`** — a cached server-side read. Anything that makes it expensive to call
  or lets a caller control what it fetches.
- Response headers set in `next.config.ts`, and anything that defeats them.
- XSS through venue-supplied strings. Market symbols and wallet addresses come from third
  parties and are rendered; they are not trusted input.
- Server-side request forgery, path traversal, or resource exhaustion anywhere in the two
  routes above.

## What is not

- **Wrong numbers.** A PnL that disagrees with the exchange is a bug, and an important one,
  but report it as a normal issue. Please include `npm run check` output.
- **Rate limits and outages at a venue.** Runback reads Hyperliquid and friends from the
  visitor's own browser precisely so one visitor cannot spend everyone's quota. A venue
  being slow or throttling is not a vulnerability here.
- **Public data being public.** Wallet addresses, fills and positions on these books are
  published by the exchanges. Surfacing them is the entire premise of the project.
- Findings from automated scanners with no demonstrated impact.
