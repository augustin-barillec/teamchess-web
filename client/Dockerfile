# ---- Build Stage ----
# This stage installs dependencies and builds the React application.
FROM node:22-alpine AS build
WORKDIR /usr/src/app

# 1. Copy manifests and install all dependencies
# This layer is cached as long as package files don't change.
# We only copy manifests relevant to the client.
COPY package.json package-lock.json ./
COPY shared/package.json ./shared/
COPY client/package.json ./client/
RUN npm ci

# 2. Copy source code and build the application
# This layer is cached as long as client/shared source files don't change.
COPY tsconfig.json .
COPY shared ./shared
COPY client ./client
RUN npm run build --workspace=shared --workspace=client

# ---- Production Stage ----
# This stage serves the built static files using Nginx.
FROM nginx:stable-alpine

# Copy the built static files from the build stage to the Nginx server directory
COPY --from=build /usr/src/app/client/dist /usr/share/nginx/html

# Copy the custom Nginx configuration to enable SPA routing and proxying
COPY client/nginx.conf /etc/nginx/conf.d/default.conf

# Expose port 80 (standard HTTP)
EXPOSE 80

# Start Nginx in the foreground
CMD ["nginx", "-g", "daemon off;"]