# SkillSwap deployment

SkillSwap is a Node.js web service with a persistent MySQL database. It can run in Docker, but Docker is only the app packaging; it does not provide durable database storage by itself.

## Required production settings

Set these as secrets/environment variables in the host (do not commit `.env`):

- `NODE_ENV=production`
- `LOCAL_DEMO=false`
- `PORT` to the port supplied by the host
- `PUBLIC_ORIGIN=https://your-domain.example`
- `MYSQL_HOST`, `MYSQL_PORT`, `MYSQL_DATABASE`, `MYSQL_USER`, `MYSQL_PASSWORD`
- `MYSQL_SSL=true` for a remote database; provide `MYSQL_SSL_CA` if the provider requires a custom CA
- `SESSION_SECRET` with at least 32 random characters
- `OWNER_EMAIL` for the admin account
- `BREVO_API_KEY`, `BREVO_SENDER_EMAIL`, `RECAPTCHA_SITE_KEY`, `RECAPTCHA_SECRET_KEY`
- `HUB_ONLY=true` only when requests arrive through the verified PunithHub bridge; configure `HUB_ORIGIN` and `HUB_BRIDGE_SECRET` then

The database must be reachable from the app host. Back it up before migrations. Apply schema migrations with `npm run db:migrate` using the same production DB settings before starting the new app image. Do not use local demo seeding on production.

The server listens on `0.0.0.0` outside local demo mode and reads the host's `PORT`. `/health` checks MySQL connectivity. Use that endpoint as the host health check.

## Docker

Build with `docker build -t skillswap .`. Run with the required variables supplied by a secret manager, or use a private env file locally with `docker run --env-file .env -p 8790:8790 skillswap`. Never bake credentials into the image. The image contains the app only; connect it to a managed/persistent MySQL service.

## Before opening to users

Create an encrypted database backup and test restoring it. Confirm the owner email is correct and has admin role, production OTP email and CAPTCHA work, and the public URL uses HTTPS. Verify profile uploads and challenge videos fit the database/provider limits. Review QA demo accounts before importing any fixtures.

Free app hosts may sleep or have small resource allowances. Free database storage/retention is provider-specific; verify current limits and backup/restore options before using real accounts.
