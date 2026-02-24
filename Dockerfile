# ── Stage 1: Builder ─────────────────────────────────────────────────────────
# Full Debian image with build tools. Nothing from this stage ships to prod
# unless explicitly COPY'd into the runtime stage below.
FROM node:22-bookworm AS builder

RUN curl -fsSL https://bun.sh/install | bash
ENV PATH="/root/.bun/bin:${PATH}"

RUN corepack enable

WORKDIR /app

ARG OPENCLAW_DOCKER_APT_PACKAGES=""
RUN if [ -n "$OPENCLAW_DOCKER_APT_PACKAGES" ]; then \
      apt-get update && \
      DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends $OPENCLAW_DOCKER_APT_PACKAGES && \
      apt-get clean && \
      rm -rf /var/lib/apt/lists/* /var/cache/apt/archives/*; \
    fi

COPY package.json pnpm-workspace.yaml .npmrc ./
COPY ui/package.json ./ui/package.json
COPY patches ./patches
COPY scripts ./scripts

RUN pnpm install --no-frozen-lockfile

# Optionally install Chromium and Xvfb for browser automation.
# Build with: docker build --build-arg OPENCLAW_INSTALL_BROWSER=1 ...
# Adds ~300MB but eliminates the 60-90s Playwright install on every container start.
# Must run after pnpm install so playwright-core is available in node_modules.
ARG OPENCLAW_INSTALL_BROWSER=""
RUN if [ -n "$OPENCLAW_INSTALL_BROWSER" ]; then \
      apt-get update && \
      DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends xvfb && \
      node /app/node_modules/playwright-core/cli.js install --with-deps chromium && \
      apt-get clean && \
      rm -rf /var/lib/apt/lists/* /var/cache/apt/archives/*; \
    fi

COPY . .
RUN pnpm build

# LanceDB has native bindings that may not be hoisted by pnpm in all configurations.
# CI=true avoids ERR_PNPM_ABORTED_REMOVE_MODULES_DIR_NO_TTY in non-interactive builds.
RUN CI=true pnpm install --filter @openclaw/memory-lancedb --prod --no-frozen-lockfile || true

ENV OPENCLAW_PREFER_PNPM=1
RUN pnpm ui:build

# Ensure playwright cache dir exists so the COPY in the runtime stage never fails.
RUN mkdir -p /root/.cache/ms-playwright

# ── Stage 2: Runtime ─────────────────────────────────────────────────────────
# Slim Debian — no compilers, no build headers, no Bun, no dev toolchain.
# ~200 MB base vs ~1.1 GB for full bookworm.
FROM node:22-bookworm-slim AS runtime

RUN corepack enable

WORKDIR /app
ENV NODE_ENV=production

# --chown on COPY sets ownership in a single layer, avoiding the expensive
# `chown -R` that used to duplicate ~500 MB of node_modules data.
COPY --from=builder --chown=node:node /app/package.json /app/pnpm-workspace.yaml /app/.npmrc /app/openclaw.mjs ./
COPY --from=builder --chown=node:node /app/dist ./dist
COPY --from=builder --chown=node:node /app/node_modules ./node_modules
COPY --from=builder --chown=node:node /app/extensions ./extensions
COPY --from=builder --chown=node:node /app/docs/reference/templates ./docs/reference/templates
COPY --from=builder --chown=node:node /app/scripts ./scripts

# Centris init script — runs before the gateway starts.
RUN mkdir -p /openclaw-init.d
COPY --chown=node:node scripts/centris-init.sh /openclaw-init.d/centris-init.sh
RUN chmod +x /openclaw-init.d/centris-init.sh

# If Chromium was installed in the builder, copy browser binaries + runtime libs.
ARG OPENCLAW_INSTALL_BROWSER=""
RUN if [ -n "$OPENCLAW_INSTALL_BROWSER" ]; then \
      apt-get update && \
      DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends xvfb \
        libnss3 libatk-bridge2.0-0 libdrm2 libxkbcommon0 libgbm1 \
        libasound2 libatspi2.0-0 libxshmfence1 && \
      apt-get clean && \
      rm -rf /var/lib/apt/lists/* /var/cache/apt/archives/*; \
    fi
COPY --from=builder --chown=node:node /root/.cache/ms-playwright /home/node/.cache/ms-playwright

USER node

ENTRYPOINT ["/app/scripts/docker-entrypoint.sh"]

CMD ["node", "openclaw.mjs", "gateway", "--allow-unconfigured"]
