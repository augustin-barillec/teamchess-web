# Use a current Long-Term Support (LTS) version of Node.js
FROM node:22-bookworm

# Set environment variables. Using ARG for DEBIAN_FRONTEND is a common practice.
ARG DEBIAN_FRONTEND=noninteractive
ENV APP_FOLDER=/app/ \
    WORKSPACE=/app/workspace

# Install essential tools, create the node user's home directory, and set permissions
RUN apt-get update && \
    apt-get -y install --no-install-recommends \
    git \
    wget \
    iputils-ping \
    curl \
    gnupg2 \
    sudo && \
    # Give the node user passwordless sudo privileges
    echo "node ALL=(ALL) NOPASSWD: ALL" > /etc/sudoers.d/node-nopasswd && \
    # Create the workspace directory and give the node user ownership.
    # This prevents permission errors before the volume is mounted.
    mkdir -p ${WORKSPACE} && \
    chown -R node:node ${APP_FOLDER} && \
    # Clean up to reduce image size
    apt-get clean && \
    rm -rf /var/lib/apt/lists/*

# Set the working directory
WORKDIR ${WORKSPACE}

# Switch to the non-root user for better security
USER node

# Keep the container running so you can attach to it
CMD [ "sleep", "infinity" ]
