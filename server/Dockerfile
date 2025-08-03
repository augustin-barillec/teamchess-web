FROM node:22-alpine

# Set the working directory in the container
WORKDIR /usr/src/app

# Copy all package manifests from the root context to leverage Docker layer caching
COPY package*.json ./
COPY shared/package.json ./shared/
COPY server/package.json ./server/
COPY client/package.json ./client/

# Install all dependencies needed for the build
RUN npm install

# Copy the entire monorepo source code
COPY . .

# Build all workspaces (shared, server, client)
RUN npm run build

# Remove development dependencies to reduce image size
RUN npm prune --omit=dev

# Expose the port the server listens on
EXPOSE 3001

# Command to run the server application
CMD ["npm", "--workspace=server", "run", "start"]