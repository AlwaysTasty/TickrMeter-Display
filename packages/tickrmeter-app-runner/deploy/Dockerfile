ARG NODE_IMAGE=node:22-bookworm-slim
FROM ${NODE_IMAGE}
ENV NODE_ENV=production
WORKDIR /opt/tickrmeter
# Build from the project containing the two extracted, version-checked bundles.
# Customer code/configuration and secrets are mounted at runtime, never baked in.
COPY packages/tickrmeter-display-sdk/index.js packages/tickrmeter-display-sdk/constants.js packages/tickrmeter-display-sdk/package.json ./packages/tickrmeter-display-sdk/
COPY packages/tickrmeter-display-sdk/lib ./packages/tickrmeter-display-sdk/lib
COPY packages/tickrmeter-display-sdk/schemas ./packages/tickrmeter-display-sdk/schemas
COPY packages/tickrmeter-app-runner/index.js packages/tickrmeter-app-runner/package.json ./packages/tickrmeter-app-runner/
COPY packages/tickrmeter-app-runner/bin ./packages/tickrmeter-app-runner/bin
COPY packages/tickrmeter-app-runner/lib ./packages/tickrmeter-app-runner/lib
COPY packages/tickrmeter-app-runner/templates ./packages/tickrmeter-app-runner/templates
COPY packages/tickrmeter-app-runner/schemas ./packages/tickrmeter-app-runner/schemas
USER node
WORKDIR /work
ENTRYPOINT ["node", "/opt/tickrmeter/packages/tickrmeter-app-runner/bin/tickrmeter-app-runner.js"]
CMD ["start", "/work/runner.json"]
