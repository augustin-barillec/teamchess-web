# ---- Builder Stage ----
# This stage installs dependencies and builds the TypeScript source code.
FROM node:22-alpine AS builder
WORKDIR /usr/src/app

# 1. Copy package manifests for the entire workspace
# This layer is cached and only re-runs if dependency versions change.
COPY package.json package-lock.json ./
COPY shared/package.json ./shared/
COPY master-server/package.json ./master-server/

# 2. Install all dependencies from the lockfile for all workspaces
RUN npm ci

# 3. Copy source code and build the necessary workspaces
# This layer is cached and only re-runs if the source code changes.
COPY tsconfig.json .
COPY shared ./shared
COPY master-server ./master-server
RUN npm run build --workspace=shared --workspace=master-server

# 4. Prune development dependencies from the entire workspace
RUN npm prune --omit=dev --workspaces


# ---- Production Stage ----
# This stage creates the final, minimal image for deployment.
FROM node:22-alpine
WORKDIR /usr/src/app

# Copy necessary package manifests for running the start script
COPY package.json ./
COPY master-server/package.json ./master-server/

# Copy the pruned production dependencies from the builder stage
COPY --from=builder /usr/src/app/node_modules ./node_modules

# Copy the entire built master-server directory from the builder
COPY --from=builder /usr/src/app/master-server ./master-server

# Correctly place the built `shared` package so that module resolution works
RUN mkdir -p ./node_modules/@teamchess
COPY --from=builder /usr/src/app/shared ./node_modules/@teamchess/shared

# Expose the port the master server listens on
EXPOSE 4000

# Command to run the master server application
CMD ["npm", "--workspace=master-server", "run", "start"]