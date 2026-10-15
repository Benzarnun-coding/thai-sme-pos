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
