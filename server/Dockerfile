# ---- Builder Stage ----
# This stage installs dependencies, including devDependencies,
# and builds the TypeScript source into JavaScript.
FROM node:22-alpine AS builder
WORKDIR /usr/src/app

# 1. Copy only package manifests
# This layer is cached and only re-runs if dependency versions change.
COPY package.json package-lock.json ./
COPY shared/package.json ./shared/
COPY server/package.json ./server/

# 2. Install all dependencies. This will create the nested
# server/node_modules/stockfish directory as it exists in your project.
RUN npm ci

# 3. Copy source code and build
# This layer is cached and only re-runs if the source code changes.
COPY tsconfig.json .
COPY shared ./shared
COPY server ./server
RUN npm run build --workspace=shared --workspace=server

# 4. Prune development dependencies from the entire workspace,
# including the nested node_modules.
RUN npm prune --omit=dev --workspaces


# ---- Production Stage ----
# This stage creates the final, minimal image for deployment.
FROM node:22-alpine
WORKDIR /usr/src/app

# Copy necessary package manifests for running the start script
COPY package.json ./
COPY server/package.json ./server/

# Copy the pruned production dependencies from the root
COPY --from=builder /usr/src/app/node_modules ./node_modules

# Copy the entire built server directory from the builder.
# This is the key change: it brings over everything the server needs in one go,
# including its compiled code (`dist`), the `.cjs` helper, and its own
# pruned `node_modules` directory, preserving the exact structure.
COPY --from=builder /usr/src/app/server ./server

# Copy the built shared library, which is a dependency of the server
COPY --from=builder /usr/src/app/shared/dist ./shared/dist

# Expose the port the server listens on
EXPOSE 3001

# Command to run the server application
CMD ["npm", "--workspace=server", "run", "start"]