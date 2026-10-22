# Working on this repo from Claude Code cloud sessions (claude.ai/code)

The repo is public on GitHub (`Benzarnun-coding/thai-sme-pos`); work happens on branch `ads-web`.

## What the repo already does

`.claude/settings.json` has a SessionStart hook: in a cloud session (`CLAUDE_CODE_REMOTE=true`) it runs `npm ci` in
`ads-web/`, so `npm test`, `npm run typecheck` and `npx vite build` work right away. On a local machine it does nothing.

## Set up once (Benz, on claude.ai/code)

1. Sign in to claude.ai/code with GitHub. To push, install the Claude GitHub App on the `Benzarnun-coding` account.
2. Create an environment, e.g. "pkjeans", personal (not shared):
   - **Setup script** (Node 24; the cloud image has Node 22, and the tests run `.ts` files directly):
     ```bash
     #!/bin/bash
     set -e
     V=v24.14.0
     curl -fsSL https://nodejs.org/dist/$V/node-$V-linux-x64.tar.xz | tar -xJ -C /opt
     ln -sf /opt/node-$V-linux-x64/bin/node /opt/node-$V-linux-x64/bin/npm /opt/node-$V-linux-x64/bin/npx /usr/local/bin/
     ```
   - **Network access**: Custom, "Also include default list", plus `api.cloudflare.com` (deploy, D1). Add
     `docs.google.com` only if a session must read the sheets itself.
   - **Deploying from the cloud** (optional): env vars `CLOUDFLARE_API_TOKEN` (a token limited to this account with
     Workers Scripts Edit + D1 Edit) and `CLOUDFLARE_ACCOUNT_ID`. Env vars are readable by anything run in the
     session, so keep the environment personal. Without them, deploy from a local machine as before.
3. Start a session: Desktop app → Cloud, or claude.ai/code → repo `Benzarnun-coding/thai-sme-pos`, branch `ads-web`,
   environment "pkjeans".

## Not available in the cloud

- Gitignored files: `ads-web/.dev.vars` (Meta token, auth bypass), `ads-engine/.env`, the local D1 copy, `Gosell/`.
  So `npm run dev` with real data and `ads-engine` runs don't work there; tests, typecheck, build and deploy do.
- User-level things: `~/.claude` memory (sheet ids live in the dashboard's settings anyway) and the `meta-ads` MCP.
- Never put the Meta token in a cloud environment: anything run there could change live campaigns.

The working rules in `CLAUDE.md` apply unchanged (a cloud session is already its own clean copy).

## Deploying from a cloud session (2026-10-21)

The cloud network layer drops the `Authorization` header to `api.cloudflare.com`, so `wrangler` can't log in even
with `CLOUDFLARE_API_TOKEN` set. Deploy through GitHub Actions instead (`.github/workflows/ads-web-deploy.yml`, uses
the repo secret `CLOUDFLARE_API_TOKEN`): push the commit to `ads-web` first, then

```bash
git push origin origin/ads-web:refs/heads/claude/deploy/ads-web
```

It checks the commit is exactly `ads-web`'s head, runs tests + typecheck, applies pending D1 migrations, deploys and
deletes the trigger branch. Worker secrets are not set there; a person sets those with `wrangler secret put`.

## Looking at production from a cloud session (read only, Benz 2026-10-22)

A Cloudflare Access **service token** lets a session read the live site without a person's login. The Worker turns
it into the principal `service:<client id>` (`worker/auth.ts`) and refuses every non-GET request from it
(`worker/index.ts`), so it can read every `/api` GET and run one SELECT at a time:

```bash
curl -s -H "CF-Access-Client-Id: $CF_ACCESS_CLIENT_ID" -H "CF-Access-Client-Secret: $CF_ACCESS_CLIENT_SECRET" \
  --get --data-urlencode "q=SELECT count(*) n FROM meta_posts" https://pkjeans-ads.ads-web.workers.dev/api/debug/sql
```

`/api/debug/sql` takes SELECT/WITH only (no write keywords, one statement, ≤ 500 rows, BLOBs shown as their size);
owners may call it too. Set up once (Benz):

1. Zero Trust → Access → Service Auth → Service Tokens → Create, name `claude-readonly` (duration: e.g. 1 year).
   Copy the Client ID and Client Secret (the secret is shown once).
2. Access → Applications → the pkjeans-ads application → Policies → Add a policy: Action **Service Auth**,
   Include → Service Token → `claude-readonly`. Not on the GoSell or webhook applications.
3. claude.ai/code → the environment → environment variables `CF_ACCESS_CLIENT_ID` and `CF_ACCESS_CLIENT_SECRET`;
   new sessions pick them up.

Revoke: delete the token in step 1. The token reads everything the dashboard shows, including redacted chat text,
so keep the environment personal.
