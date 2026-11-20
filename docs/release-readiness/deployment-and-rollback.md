# Deployment and rollback review

This PR changes client navigation/copy/measurement and test coverage. It adds no database migration, dependency, provider, price, entitlement rule, selection policy, environment variable or schedule. **No deployment or merge was performed.**

The existing workflow builds an image tagged with the commit SHA. The existing deployment script applies runtime settings, checks application/database health (up to 40 attempts, three seconds apart), and switches back to the previous image when health fails. The latest visible master workflow succeeded; that is evidence of those steps at that time, not proof of the current served SHA or continued health. The deployment depends on the existing edge network/Caddy and database configuration.

Before an authorized release, record the current image and rollback image tags, confirm backup/restore evidence and the expected runtime configuration, and review the independent status of #193. Use the normal deployment workflow only after owner approval. If rollback is required, restore the recorded previous image through the existing procedure and verify health, login, pricing, paid access and callback handling. No schema rollback is required for this PR. Configuration and rollback execution were not exercised against production.

Cron review: the existing wrapper makes an authenticated internal request with a 330-second timeout, logs response status, and does not retry. This sprint did not invoke scheduled publishing, settlement or webhook routes. Required operational evidence is enumerated in [production-evidence.md](production-evidence.md).
