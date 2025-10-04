# TeamChess ♟️

TeamChess is a real-time, collaborative multiplayer chess application where teams of players vote on the best move for their side. This project is a full-stack monorepo featuring a React frontend, a Node.js/Socket.IO game server, and a master server for service discovery. It's designed for easy local development and scalable deployment on Google Cloud Platform.

## Features

- **Server Browser**: Automatically discover and connect to available game servers.
- **Real-time Multiplayer**: Play chess with multiple people on each team in a single game.
- **Move by Committee**: Players propose moves, and the team's most popular or engine-verified best move is played.
- **Spectator Mode**: Join games to watch the action unfold without participating.
- **In-Game Chat**: Communicate with other players and spectators in the game room.
- **Game Visibility**: Control game privacy with **Public**, **Private**, or **Closed** settings.

---

## Tech Stack

- **Frontend**: React, TypeScript, Vite, Socket.IO Client, `react-chessboard`
- **Backend (Game Server)**: Node.js, TypeScript, Express, Socket.IO, `chess.js`, Stockfish Engine
- **Backend (Master Server)**: Node.js, TypeScript, Express for service discovery.
- **Monorepo Management**: npm Workspaces for managing shared code and dependencies.
- **Deployment**: Docker, Caddy (for HTTPS), Google Cloud Platform (GCP).

---

## Repository Structure

The project is a monorepo organized into several key packages:

- `shared/`: Contains shared types and constants used across the client and servers.
- `client/`: The React frontend application.
- `server/`: The core game server (Socket.IO, chess logic).
  - `server/deploy/`: Contains the production `Caddyfile` and `docker-compose.yml` templates for game server VMs.
- `master-server/`: A simple service for game servers to register themselves and for clients to discover them.
- `development/`: Contains the `docker-compose.yaml` file for the local development environment.

---

## Getting Started (Local Development)

To run the entire stack locally for development, you need **Docker** and **Node.js v22+** installed.

### 1. Clone the Repository

```bash
git clone <your-repo-url>
cd teamchess
```

### 2\. Install Dependencies

This command will use npm Workspaces to install dependencies for all packages (`client`, `server`, `master-server`, and `shared`).

```bash
npm install
```

### 3\. Run the Local Environment

This command uses the `development/docker-compose.yaml` file to build and run all the necessary services for a complete local testing environment.

```bash
docker compose -f development/docker-compose.yaml up --build
```

This will start the following containers:

- **Client**: The React app, available at `http://localhost`.
- **Master Server**: The service discovery API, available at `http://localhost:4000`.
- **Game Server 1 ("Alpha")**: A game server instance accessible via WebSocket at `ws://localhost:3001`.
- **Game Server 2 ("Bravo")**: A second game server instance accessible via WebSocket at `ws://localhost:3002`.

### 4\. Access the Application

Once the containers are running, open your browser and navigate to:

- **➡️ http://localhost**

You should see the server browser, which has discovered the two local game servers from the master server.

---

## Production Deployment on GCP

This guide provides a complete, step-by-step workflow for deploying the application to Google Cloud Platform. The instructions are designed to be executed from the root of the project repository.

### Prerequisites

- A GCP project with billing enabled.
- The `gcloud` CLI installed and authenticated (`gcloud auth login`).
- A custom domain name (e.g., `your-domain.com`).
- Docker installed locally.

### Step 1: GCP Project Setup

First, configure your local environment with your project details and enable the necessary GCP APIs.

```bash
# Set your project ID and a region for deployment
export PROJECT_ID=$(gcloud config get-value project)
export REGION=europe-west1

# Set the project for future gcloud commands
gcloud config set project $PROJECT_ID

# Enable all required APIs for the deployment
gcloud services enable \
  run.googleapis.com \
  compute.googleapis.com \
  artifactregistry.googleapis.com \
  storage.googleapis.com
```

### Step 2: Build and Push Docker Images

We will store the application's Docker images in Google Artifact Registry, a private container registry.

#### A. Create an Artifact Registry Repository

This only needs to be done once per project.

```bash
gcloud artifacts repositories create teamchess-repo \
  --repository-format=docker \
  --location=$REGION
```

#### B. Authenticate Docker with the Registry

This command configures your local Docker client to push images to your new GCP registry.

```bash
gcloud auth configure-docker ${REGION}-docker.pkg.dev
```

#### C. Build and Push All Images

Build both the `master-server` and `game-server` images and push them to your Artifact Registry.

```bash
# Define image names
export MASTER_SERVER_IMAGE=$REGION-docker.pkg.dev/$PROJECT_ID/teamchess-repo/master-server:latest
export GAME_SERVER_IMAGE=$REGION-docker.pkg.dev/$PROJECT_ID/teamchess-repo/game-server:latest

# Build and push the master server image
docker build -t $MASTER_SERVER_IMAGE -f master-server/Dockerfile .
docker push $MASTER_SERVER_IMAGE

# Build and push the game server image
docker build -t $GAME_SERVER_IMAGE -f server/Dockerfile .
docker push $GAME_SERVER_IMAGE
```

### Step 3: Deploy Backend Services

#### A. Deploy the Master Server to Cloud Run

The master server is a stateless API, making it a perfect candidate for Cloud Run, a serverless platform.

```bash
gcloud run deploy teamchess-master-server \
  --image=$MASTER_SERVER_IMAGE \
  --platform=managed \
  --port=4000 \
  --region=$REGION \
  --allow-unauthenticated
```

**✅ Important**: After this command finishes, **copy the Service URL** it provides (it will look like `https://teamchess-master-server-....a.run.app`). You will need this URL for the next steps.

#### B. Deploy a Game Server VM

Game servers maintain stateful WebSocket connections, so we deploy them on dedicated Compute Engine VMs. The following steps must be repeated for each game server you wish to deploy (e.g., `game-server-1`, `game-server-2`).

**1. Set Server-Specific Variables:**

```bash
# --- CONFIGURE THESE VARIABLES FOR YOUR SERVER ---
export SERVER_NAME=game-server-1
export SUBDOMAIN=server1.your-domain.com  # Change to your desired subdomain
export MASTER_SERVER_URL_VAR="PASTE_THE_CLOUDRUN_URL_HERE" # Paste the URL from Step 3A
# --- END CONFIGURATION ---

export STATIC_IP_NAME=${SERVER_NAME}-ip
export PORT_NUMBER=3001
```

**2. Reserve a Static IP Address:**

```bash
gcloud compute addresses create $STATIC_IP_NAME --region=$REGION
```

**3. Configure DNS:**
Get the IP address you just reserved:

```bash
gcloud compute addresses describe $STATIC_IP_NAME --region=$REGION --format='value(address)'
```

Now, go to your DNS provider's dashboard and create an **A record** pointing your subdomain (e.g., `server1.your-domain.com`) to the reserved IP address. **Caddy will not be able to get an SSL certificate until DNS has propagated.**

**4. Create a Firewall Rule:**
This rule allows Caddy to obtain an SSL certificate via HTTP/HTTPS and allows WebSocket traffic to reach your server.

```bash
gcloud compute firewall-rules create allow-teamchess-game-server \
  --direction=INGRESS \
  --priority=1000 \
  --network=default \
  --action=ALLOW \
  --rules=tcp:80,tcp:443,tcp:${PORT_NUMBER} \
  --source-ranges=0.0.0.0/0 \
  --target-tags=game-server
```

**5. Create and Configure the VM:**
This command block will create the VM, install Docker, copy the necessary configuration files, create an environment file, and start the game server.

```bash
# Get the static IP address value
export STATIC_IP_VALUE=$(gcloud compute addresses describe $STATIC_IP_NAME --region=$REGION --format='value(address)')

# Create the VM instance and run startup script
gcloud compute instances create $SERVER_NAME \
  --zone=${REGION}-b \
  --image-family=debian-11 --image-project=debian-cloud \
  --address=$STATIC_IP_VALUE \
  --tags=game-server \
  --metadata startup-script='#! /bin/bash
    # Update package lists and install prerequisites
    apt-get update && apt-get install -y curl gnupg

    # Add Docker GPG key
    curl -fsSL https://download.docker.com/linux/debian/gpg | gpg --dearmor -o /usr/share/keyrings/docker-archive-keyring.gpg

    # Add Docker repository
    echo "deb [arch=amd64 signed-by=/usr/share/keyrings/docker-archive-keyring.gpg] https://download.docker.com/linux/debian $(lsb_release -cs) stable" | tee /etc/apt/sources.list.d/docker.list > /dev/null

    # Install Docker Engine
    apt-get update && apt-get install -y docker-ce docker-ce-cli containerd.io

    # Install Docker Compose standalone binary
    curl -L "https://github.com/docker/compose/releases/download/v2.20.2/docker-compose-$(uname -s)-$(uname -m)" -o /usr/local/bin/docker-compose

    # Make the binary executable
    chmod +x /usr/local/bin/docker-compose

    gcloud auth configure-docker europe-west1-docker.pkg.dev'
```

# Copy the production configuration files to the VM

```bash
gcloud compute scp ./server/deploy/docker-compose.yml ${SERVER_NAME}:~/docker-compose.yml --zone=${REGION}-b
gcloud compute scp ./server/deploy/Caddyfile ${SERVER_NAME}:~/Caddyfile --zone=${REGION}-b
gcloud compute scp ./server/deploy/.env ${SERVER_NAME}:~/.env --zone=${REGION}-b
```

```bash
gcloud compute ssh game-server-1 --zone=${REGION}-b -- "
sudo /usr/local/bin/docker-compose up -d
"
```

Repeat the steps in **Section B** for any additional game servers, ensuring you update the variables in **B.1** each time.

### Step 4: Deploy Frontend

We will host the static React client on a Cloud Storage bucket for simple, scalable, and cost-effective delivery.

#### A. Create a Production Environment File

Create a file at `client/.env.production` and add your Master Server URL from Step 3A.

```bash
echo "VITE_MASTER_SERVER_URL=PASTE_THE_CLOUDRUN_URL_HERE" > client/.env.production
```

#### B. Build the Client for Production

```bash
npm run build --workspace=client
```

#### C. Create a Cloud Storage Bucket and Upload

```bash
# Use a globally unique bucket name, like your domain name
export BUCKET_NAME=www.your-domain.com

# Create the bucket
gsutil mb -l $REGION gs://${BUCKET_NAME}

# Upload the built client files from the 'client/dist' directory
gsutil rsync -d -R client/dist gs://${BUCKET_NAME}

# Make the bucket contents publicly readable
gsutil iam ch allUsers:objectViewer gs://${BUCKET_NAME}

# Configure the bucket to serve a static website
gsutil web set -m index.html -e index.html gs://${BUCKET_NAME}
```

Your client is now live\! It can be accessed at `https://${BUCKET_NAME}.storage.googleapis.com/`.

### Step 5: Updating a Deployed Game Server

To update an existing game server with the latest code, follow these two steps:

**1. Rebuild and push the game server image:**

```bash
# Define the image name again if needed
export GAME_SERVER_IMAGE=$REGION-docker.pkg.dev/$PROJECT_ID/teamchess-repo/game-server:latest

# Build and push the updated image
docker build -t $GAME_SERVER_IMAGE -f server/Dockerfile .
docker push $GAME_SERVER_IMAGE
```

**2. SSH into the server, pull the new image, and restart:**
Replace `game-server-1` with the name of the VM you want to update.

```bash
gcloud compute ssh game-server-1 --zone=${REGION}-b -- "
echo '🚀 Pulling latest Docker images...'
sudo /usr/local/bin/docker-compose pull

echo '♻️ Restarting services with new images...'
sudo /usr/local/bin/docker-compose up -d --remove-orphans

echo '🧹 Cleaning up old images...'
sudo docker image prune -af
"
```
