# ---- Builder Stage ----
# This stage installs dependencies, including devDependencies,
# and builds the TypeScript source into JavaScript.
FROM node:22-alpine AS builder
WORKDIR /usr/src/app

# 1. Copy only package manifests
# This layer is cached and only re-runs if dependency versions change.
COPY package.json package-lock.json ./
COPY shared/package.json ./shared/
COPY game-server/package.json ./game-server/

# 2. Install all dependencies. This will create the nested
# game-server/node_modules/stockfish directory as it exists in your project.
RUN npm ci

# 3. Copy source code and build
# This layer is cached and only re-runs if the source code changes.
COPY tsconfig.json .
COPY shared ./shared
COPY game-server ./game-server
RUN npm run build --workspace=shared --workspace=game-server

# 4. Prune development dependencies from the entire workspace,
# including the nested node_modules.
RUN npm prune --omit=dev --workspaces


# ---- Production Stage ----
# This stage creates the final, minimal image for deployment.
FROM node:22-alpine
WORKDIR /usr/src/app

# Copy necessary package manifests for running the start script
COPY package.json ./
COPY game-server/package.json ./game-server/

# Copy the pruned production dependencies from the root
COPY --from=builder /usr/src/app/node_modules ./node_modules

# Copy the entire built game-server directory from the builder.
COPY --from=builder /usr/src/app/game-server ./game-server

# Correctly place the built `shared` package into the root node_modules.
# This ensures that `require('@teamchess/shared')` resolves correctly.
RUN mkdir -p ./node_modules/@teamchess
COPY --from=builder /usr/src/app/shared ./node_modules/@teamchess/shared

# Expose the port the game-server listens on
EXPOSE 3001

# Command to run the game-server application
CMD ["npm", "--workspace=game-server", "run", "start"]