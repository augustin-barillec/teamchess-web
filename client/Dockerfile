# /home/augustin/VSCode/teamchess/client/Dockerfile
# ---- Build Stage ----
FROM node:22-alpine AS build
WORKDIR /usr/src/app

# Copy all package manifests from the root context
COPY package*.json ./
COPY shared/package.json ./shared/
COPY server/package.json ./server/
COPY client/package.json ./client/

# Install dependencies
RUN npm install

# Copy all source code
COPY . .

# Build all workspaces
RUN npm run build


# ---- Production Stage ----
FROM nginx:stable-alpine

# Copy the built static files from the build stage to the Nginx server directory
COPY --from=build /usr/src/app/client/dist /usr/share/nginx/html

# Copy the custom Nginx configuration
COPY client/nginx.conf /etc/nginx/conf.d/default.conf

# Expose port 80 (standard HTTP)
EXPOSE 80

# Start Nginx in the foreground
CMD ["nginx", "-g", "daemon off;"]