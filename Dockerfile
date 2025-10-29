# ---- 1. Builder Stage ----
# This stage installs all dependencies and builds both client and server
FROM node:22-alpine AS builder
WORKDIR /usr/src/app

# Copy package.json first to cache dependencies
COPY package.json .

# Install ALL dependencies (for client + server build)
RUN npm install

# Copy the rest of the source code
COPY . .

# Build the React client (output to client/dist)
RUN npm run build:client

# Build the Node server (output to dist/)
RUN npm run build:server

# Prune development dependencies
RUN npm prune --omit=dev


# ---- 2. Production Stage ----
# This is the final, slim image
FROM node:22-alpine
WORKDIR /usr/src/app

# Copy the pruned production node_modules from the builder stage
COPY --from=builder /usr/src/app/node_modules ./node_modules

# Copy the built server code
COPY --from=builder /usr/src/app/dist ./dist

# Copy the built client code into a 'public' directory for Express to serve
COPY --from=builder /usr/src/app/client/dist ./public

# Copy the stockfish loader
COPY --from=builder /usr/src/app/server/load_engine.cjs ./dist/load_engine.cjs

# Expose the port the server will run on
EXPOSE 3001

# The command to start the server
CMD ["node", "dist/index.js"]