# BetGenius PR #225 — visual preview

The preview uses the PR branch `design/teal-premium-ui-2026-11`; merging to master is **not** part of this workflow.

## Isolation

- Separate Docker Compose project `betgenius-preview` with its own app container, PostgreSQL volume and network
- Database contents are copied once via `pg_dump` into the isolated preview database; no preview queries reach production PostgreSQL
- No prediction-generation jobs, payment secrets, provider API secrets or production analytics keys are configured
- Caddy blocks **all methods except GET/HEAD** and restricts /api, /admin, /dashboard, /login, /register and payment routes
- HTTP Basic authentication is mandatory for public review; the password is not stored in the GitHub repository or CI logs in plaintext
- Caddy sends `X-Robots-Tag: noindex, nofollow, noarchive` and disallows caching
- The production `/opt/school-kit/sites/betgenius.caddy`, production containers and production volumes are not modified
- The existing homepage slider and site SEO metadata are not rewritten

## Access

Desired URL: **https://preview.betgenius.ng**.

GitHub Actions run: `betgenius-preview-deploy` on the design branch. A successful run also uploads mobile and desktop screenshots under the artifact `betgenius-preview-mobile-desktop`.

The `preview` DNS record is not yet configured as of the first capacity check. In the domain's DNS dashboard, create an **A** record with name `preview` and value equal to the **origin IPv4 address of the same VPS that serves www.betgenius.ng**. Do not copy Cloudflare's public proxy address returned by a DNS lookup of www; use the origin IP already configured in your DNS control panel. Leave other records untouched. The preview site's Caddy certificate will become available once DNS points at the VPS. When using Cloudflare, start with DNS-only until the certificate can be issued, then enable proxying if desired.

User name: `reviewer`. Password: generated privately on the VPS and shared with the owner through an encrypted handoff; it is intentionally not in this document.

## Review checklist

1. Homepage desktop/mobile, including the **existing** prediction slider and real published data
2. Today, Genius, Featured and Banker feeds: date scroller, compact rows, expanded cards
3. VIP/Premium: correct locked previews without showing paid selections
4. Match page and crests; browser widths 320–1440px
5. Original logo, teal identity, light/dark modes, navigation and tap targets
6. No production traffic, payments, background jobs or metadata changes

For repeat deployments, the workflow keeps the same preview password and refreshes the isolated DB snapshot. Remove preview manually after approval to stop the containers and remove the temporary site and DB snapshot.
