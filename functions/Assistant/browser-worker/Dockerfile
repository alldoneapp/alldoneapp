# Build context is `functions/` (see cloudbuild.yaml), not this directory: the worker reuses the
# token verification and the allowlist matcher from `Assistant/browser/` rather than carrying its
# own copies. A worker with its own idea of what the allowlist means is a worker that eventually
# disagrees with the policy that minted its token.
#
# The image tag and the `playwright` dependency in package.json MUST be bumped together — the
# Playwright image ships the browser binaries for exactly its own version, and a mismatch fails at
# launch with "Executable doesn't exist".
FROM mcr.microsoft.com/playwright:v1.49.1-jammy

WORKDIR /app

COPY Assistant/browser-worker/package.json ./package.json
RUN npm install --omit=dev --no-audit --no-fund

COPY Assistant/browser-worker/*.js ./
COPY Assistant/browser/browserWorkerClient.js Assistant/browser/browserAllowlist.js Assistant/browser/browserToolContract.js ./shared/

ENV NODE_ENV=production
ENV PORT=8080

# Runs as the image's non-root `pwuser`; the browser needs no elevated rights and the container has
# nothing to write outside /tmp.
USER pwuser

CMD ["node", "server.js"]
