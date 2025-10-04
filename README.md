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

[cite\_start]This command will use npm Workspaces to install dependencies for all packages (`client`, `server`, `master-server`, and `shared`).

```bash
npm install
```

### 3\. Run the Local Environment

[cite\_start]This command uses the `development/docker-compose.yaml` file to build and run all the necessary services.

```bash
docker compose -f development/docker-compose.yaml up --build
```

This will start the following containers:

- [cite\_start]**Client**: The React app, available at `http://localhost`.
- [cite\_start]**Master Server**: The service discovery API, available at `http://localhost:4000`.
- [cite\_start]**Game Server 1 ("Alpha")**: A game server instance at `ws://localhost:3001`.
- [cite\_start]**Game Server 2 ("Bravo")**: A second game server instance at `ws://localhost:3002`.

### 4\. Access the Application

Once the containers are running, open your browser and navigate to:

- **➡️ http://localhost**

---

## Production Deployment on GCP: Complete Guide

This guide provides a complete, step-by-step workflow for deploying the entire application to Google Cloud Platform, including connecting the frontend to `www.yokyok.ninja`.

### Prerequisites

- [cite\_start]A GCP project with billing enabled.
- [cite\_start]The `gcloud` CLI installed and authenticated (`gcloud auth login`).
- [cite\_start]Your custom domain name (`yokyok.ninja`) ready.
- [cite\_start]Docker installed locally.

### Step 1: GCP Project Setup

Configure your local environment with your project details and enable the necessary GCP APIs.

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

We will store the application's Docker images in Google Artifact Registry.

#### A. Create an Artifact Registry Repository

This only needs to be done once per project.

```bash
gcloud artifacts repositories create teamchess-repo \
  --repository-format=docker \
  --location=$REGION
```

#### B. Authenticate Docker with the Registry

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

The stateless master server is a perfect candidate for Cloud Run.

```bash
gcloud run deploy teamchess-master-server \
  --image=$MASTER_SERVER_IMAGE \
  --platform=managed \
  --port=4000 \
  --region=$REGION \
  --allow-unauthenticated
```

**✅ Important**: After this command finishes, **copy the Service URL** it provides (e.g., `https://teamchess-master-server-....a.run.app`). You will need this for the next steps.

#### B. Deploy the Game Server VM (`server1.yokyok.ninja`)

Game servers are stateful and are deployed on Compute Engine VMs.

**1. Set Server-Specific Variables:**

```bash
# --- CONFIGURE THESE VARIABLES FOR YOUR SERVER ---
export SERVER_NAME=game-server-1
export SUBDOMAIN=server1.yokyok.ninja
export MASTER_SERVER_URL="PASTE_THE_CLOUDRUN_URL_HERE" # Paste the URL from Step 3A
# --- END CONFIGURATION ---

export STATIC_IP_NAME=${SERVER_NAME}-ip
export PORT_NUMBER=3001
```

**2. Reserve a Static IP Address:**

```bash
gcloud compute addresses create $STATIC_IP_NAME --region=$REGION
```

Get the IP address you just reserved. It should match the one in your DNS settings (`35.189.228.0`).

```bash
gcloud compute addresses describe $STATIC_IP_NAME --region=$REGION --format='value(address)'
```

Now, ensure an **A record** exists in your DNS provider pointing `server1.yokyok.ninja` to this IP.

**3. Create a Firewall Rule:**

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

**4. Create and Configure the VM:**
This command creates the VM instance and runs a startup script to install Docker.

```bash
export STATIC_IP_VALUE=$(gcloud compute addresses describe $STATIC_IP_NAME --region=$REGION --format='value(address)')

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

**5. Start the Game Server:**
Copy the production configuration files to the VM and start the services.

```bash
gcloud compute scp ./server/deploy/docker-compose.yml ${SERVER_NAME}:~/docker-compose.yml --zone=${REGION}-b
gcloud compute scp ./server/deploy/Caddyfile ${SERVER_NAME}:~/Caddyfile --zone=${REGION}-b
gcloud compute scp ./server/deploy/.env ${SERVER_NAME}:~/.env --zone=${REGION}-b

gcloud compute ssh $SERVER_NAME --zone=${REGION}-b -- "
sudo /usr/local/bin/docker-compose up -d
"
```

### Step 4: Deploy Frontend to `www.yokyok.ninja`

We will host the static React client on a Cloud Storage bucket and serve it securely via a global Load Balancer.

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
export BUCKET_NAME=www.yokyok.ninja

gsutil mb -l $REGION gs://${BUCKET_NAME}
gsutil rsync -d -R client/dist gs://${BUCKET_NAME}
gsutil iam ch allUsers:objectViewer gs://${BUCKET_NAME}
gsutil web set -m index.html -e index.html gs://${BUCKET_NAME}
```

#### D. Set Up the HTTPS Load Balancer

**1. Reserve a Global Static IP for the Frontend:**

```bash
gcloud compute addresses create teamchess-lb-ip --global
```

View the IP address. This should match the IP in your DNS for `www`.

```bash
gcloud compute addresses describe teamchess-lb-ip --global --format="value(address)"
```

Ensure an **A record** exists in your DNS provider pointing `www.yokyok.ninja` to this IP.

**2. Create the Load Balancer Components:**

```bash
# Create a managed SSL certificate for your domain
gcloud compute ssl-certificates create teamchess-ssl-cert \
    --domains=www.yokyok.ninja --global

# Create a backend that points to your GCS bucket
gcloud compute backend-buckets create teamchess-client-bucket-backend \
    --gcs-bucket-name=www.yokyok.ninja --enable-cdn

# Create a URL map to route all incoming requests to your backend
gcloud compute url-maps create teamchess-lb-url-map \
    --default-backend-bucket=teamchess-client-bucket-backend

# Create an HTTPS proxy to route requests to the URL map
gcloud compute target-https-proxies create teamchess-https-proxy \
    --url-map=teamchess-lb-url-map --ssl-certificates=teamchess-ssl-cert --global

# Create the final forwarding rule to handle incoming traffic
gcloud compute forwarding-rules create teamchess-forwarding-rule \
    --address=teamchess-lb-ip --target-https-proxy=teamchess-https-proxy \
    --ports=443 --global
```

Your application is now fully deployed\!

### Step 5: Updating a Deployed Game Server

To update an existing game server with the latest code, follow these two steps:

**1. Rebuild and push the game server image:**

```bash
docker build -t $GAME_SERVER_IMAGE -f server/Dockerfile .
docker push $GAME_SERVER_IMAGE
```

**2. SSH into the server, pull the new image, and restart:**

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
