# TeamChess

TeamChess is a real-time, multiplayer chess application where teams vote on moves. This document outlines local development and production deployment on Google Cloud Platform (GCP).

## 1. Architecture

The application consists of three main services containerized with Docker:

- **`client`**: A React single-page application (SPA) that serves as the user interface.

- **`master-server`**: A stateless Node.js API that acts as a service registry for game servers.

- **`game-server`**: A stateful Node.js/Socket.IO server that manages all real-time game logic.

---

## 2. Local Development

### Prerequisites

- Node.js (v22 or later)
- Docker and Docker Compose

### Running Locally

The entire stack, consisting of a client, a master server, and two game servers, can be launched with a single command from the project root.

1.  **Launch Services:**
    ```bash
    docker compose up --build
    ```
2.  **Access:**
    - **Client**: `http://localhost`
    - **Master Server API**: `http://localhost:4000`
    - **Game Server Alpha**: `ws://localhost:3001`
    - **Game Server Bravo**: `ws://localhost:3002`

---

## 3. Production Deployment on GCP

This guide provides a condensed workflow for deploying the application to GCP.

### Prerequisites

- A GCP project with billing enabled.

- The `gcloud` CLI installed and authenticated (`gcloud auth login`).

- A custom domain name for secure WebSocket (`wss://`) connections.

- The following APIs enabled: `run`, `compute`, `artifactregistry`, `storage`, `dns`.

### Step 1: Build and Push Images

Store your Docker images in Google Artifact Registry.

1.  **Create Repository:**
    ```bash
    gcloud artifacts repositories create teamchess-repo --repository-format=docker --location=europe-west1
    ```
2.  **Authenticate Docker:**
    ```bash
    gcloud auth configure-docker europe-west1-docker.pkg.dev
    ```
3.  **Build and Push:**

    ```bash
    # Set variables
    export REGION=europe-west1
    export PROJECT_ID=$(gcloud config get-value project)
    export MASTER_SERVER_IMAGE=$REGION-docker.pkg.dev/$PROJECT_ID/teamchess-repo/master-server:latest
    export GAME_SERVER_IMAGE=$REGION-docker.pkg.dev/$PROJECT_ID/teamchess-repo/game-server:latest

    # Build and push images
    docker build -t $MASTER_SERVER_IMAGE -f master-server/Dockerfile . && docker push $MASTER_SERVER_IMAGE
    docker build -t $GAME_SERVER_IMAGE -f server/Dockerfile . && docker push $GAME_SERVER_IMAGE
    ```

---

### Step 2: Deploy Backend

1.  **Deploy Master Server:**
    Deploy the stateless master server to Cloud Run.

    ```bash
    gcloud run deploy teamchess-master-server \
      --image=$MASTER_SERVER_IMAGE \
      --platform=managed \
      --port=4000 \
      --region=$REGION \
      --allow-unauthenticated
    ```

    **Save the output URL** for the next step.

2.  **Deploy Game Servers:**
    Deploy stateful game servers on Compute Engine VMs with automated SSL via Caddy.
    For each server (e.g., `game-server-1`):
    - **Reserve a static IP** and point a subdomain (e.g., `server1.your-domain.com`) to it.

    - **Create a firewall rule** allowing TCP traffic on ports 80 and 443.

    - **Deploy the VM:**
      ```bash
      # Create VM with a startup script that installs Docker/Compose
      gcloud compute instances create game-server-1 \
        --zone=europe-west1-b \
        --image-family=debian-11 --image-project=debian-cloud \
        --address=YOUR_STATIC_IP \
        --tags=game-server \
        --metadata startup-script='#! /bin/bash
          apt-get update && apt-get install -y curl gnupg && curl -fsSL [https://download.docker.com/linux/debian/gpg](https://download.docker.com/linux/debian/gpg) | gpg --dearmor -o /usr/share/keyrings/docker-archive-keyring.gpg && echo "deb [arch=amd64 signed-by=/usr/share/keyrings/docker-archive-keyring.gpg] [https://download.docker.com/linux/debian](https://download.docker.com/linux/debian) $(lsb_release -cs) stable" | tee /etc/apt/sources.list.d/docker.list > /dev/null && apt-get update && apt-get install -y docker-ce docker-ce-cli containerd.io && curl -L "[https://github.com/docker/compose/releases/download/1.29.2/docker-compose-$(uname](https://github.com/docker/compose/releases/download/1.29.2/docker-compose-$(uname) -s)-$(uname -m)" -o /usr/local/bin/docker-compose && chmod +x /usr/local/bin/docker-compose && gcloud auth configure-docker europe-west1-docker.pkg.dev -q'

      # Wait, then copy files and start services
      sleep 90
      gcloud compute scp ./docker-compose.yml ./Caddyfile_server1 game-server-1:~/ --zone=europe-west1-b
      gcloud compute ssh game-server-1 --zone=europe-west1-b -- "mv ~/Caddyfile_server1 ~/Caddyfile && \
      cat <<EOF > ~/.env
      MASTER_SERVER_URL=PASTE_MASTER_SERVER_URL_HERE
      PUBLIC_ADDRESS=wss://server1.your-domain.com
      SERVER_NAME=GCP Server Alpha
      PORT=3001
      EOF
      sudo /usr/local/bin/docker-compose up -d"
      ```

---

### Step 3: Deploy Frontend

Host the static client on Cloud Storage.

1.  **Build for Production:**
    Create a `client/.env.production` file with the `VITE_MASTER_SERVER_URL` pointing to your Cloud Run service, then run:

    ```bash
    npm run build --workspace=client
    ```

2.  **Upload to Bucket:**

    ```bash
    gsutil mb gs://${PROJECT_ID}-client-assets
    gsutil rsync -d -R client/dist gs://${PROJECT_ID}-client-assets
    gsutil iam ch allUsers:objectViewer gs://${PROJECT_ID}-client-assets
    ```

    Your app is live at `https://storage.googleapis.com/${PROJECT_ID}-client-assets/index.html`.

---

## 4. Development Workflow

To add a feature, develop and test it locally first using `docker compose up --build`.
Once verified, deploy only the changed services.

- **Frontend Change:** Rebuild the client and run `gsutil rsync`.

- **Backend Change:** Rebuild and push the relevant Docker image (`master-server` or `game-server`).

- For the `master-server`, run `gcloud run deploy`.
  - For a `game-server`, update the VM without recreating it:
    ```bash
    gcloud compute ssh [SERVER_NAME] --zone=europe-west1-b -- "sudo /usr/local/bin/docker-compose pull && sudo /usr/local/bin/docker-compose up -d"
    ```
