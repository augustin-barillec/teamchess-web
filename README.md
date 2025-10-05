# TeamChess ♟️

TeamChess is a real-time, collaborative multiplayer chess application where teams of players vote on the best move for their side. This project is a full-stack monorepo featuring a React frontend and a scalable backend using Node.js game servers orchestrated by Agones on Google Kubernetes Engine.

## Features

- **On-Demand Game Servers**: Automatically allocates a dedicated server for each game session.
- **Real-time Multiplayer**: Play chess with multiple people on each team in a single game.
- **Move by Committee**: Players propose moves, and the team's most popular or engine-verified best move is played.
- **Spectator Mode**: Join games to watch the action unfold without participating.
- **In-Game Chat**: Communicate with other players and spectators in the game room.
- **Game Visibility**: Control game privacy with **Public**, **Private**, or **Closed** settings.

---

## Tech Stack

- **Frontend**: React, TypeScript, Vite, Socket.IO Client, `react-chessboard`.
- **Backend (Game Server)**: Node.js, TypeScript, Socket.IO, `chess.js`, orchestrated by **Agones**.
- **Backend (Allocator Service)**: Node.js, TypeScript, and Express, acting as a stateless service to allocate game servers via the Agones API.
- **Monorepo Management**: npm Workspaces for managing shared code and dependencies.
- **Deployment**: Docker, **Google Kubernetes Engine (GKE)**, **Agones**.

---

## Repository Structure

The project is a monorepo organized into several key packages:

- `shared/`: Contains shared types and constants used across the client and servers.
- `client/`: The React frontend application.
- `server/`: The core game server (Socket.IO, chess logic), now integrated with the Agones SDK.
- `master-server/`: The allocator service that handles requests for new game servers.
- `development/`: Contains Kubernetes manifests for the local development environment.

---

## Getting Started (Local Development)

To run the stack locally, you need **Docker**, **Node.js v22+**, **kubectl**, and a local Kubernetes cluster tool like **Minikube** or **Kind**.

### 1\. Clone the Repository

```bash
git clone <your-repo-url>
cd teamchess
```

### 2\. Install Dependencies

This command will use npm Workspaces to install dependencies for all packages.

```bash
npm install
```

### 3\. Start Local Kubernetes Cluster

Using Minikube as an example:

```bash
minikube start --driver=docker
```

### 4\. Install Agones

Follow the official Agones guide to install it on your local cluster.

```bash
kubectl create namespace agones-system
kubectl apply -f https://raw.githubusercontent.com/googleforgames/agones/release-1.38.0/install/yaml/install.yaml
```

Wait for all Agones pods in the `agones-system` namespace to be running.

### 5\. Build and Load Docker Images

Build the server and allocator images and load them into your Minikube cluster.

```bash
# Point your local Docker client to the Minikube's Docker daemon
eval $(minikube -p minikube docker-env)

# Build images (they are now available within Minikube)
docker build -t teamchess-server:local -f server/Dockerfile .
docker build -t teamchess-allocator:local -f master-server/Dockerfile .
```

### 6\. Deploy to Local Cluster

Apply the development Kubernetes manifests. (You will need to create these YAML files for the allocator deployment, service, and the Agones fleet).

```bash
# Example
kubectl apply -f development/allocator-deployment.yaml
kubectl apply -f development/fleet.yaml
```

### 7\. Run the Client

Start the Vite development server for the client.

```bash
npm run dev --workspace=client
```

The client will be available at `http://localhost:5173` (or another port specified by Vite). You will need to port-forward your allocator service to make it accessible to the client.

---

## Production Deployment on GKE: Complete Guide

This guide provides a step-by-step workflow for deploying the entire application to Google Cloud Platform using GKE and Agones.

### Prerequisites

- A GCP project with billing enabled.
- The `gcloud` CLI installed and authenticated (`gcloud auth login`).
- Your custom domain name ready.
- Docker installed locally.

### Step 1: GCP Project Setup

Configure your environment and enable the necessary GCP APIs.

```bash
export PROJECT_ID=$(gcloud config get-value project)
export REGION=europe-west1
gcloud config set project $PROJECT_ID

gcloud services enable \
  run.googleapis.com \
  compute.googleapis.com \
  artifactregistry.googleapis.com \
  container.googleapis.com \
  storage.googleapis.com
```

### Step 2: Build and Push Docker Images

Store the application's Docker images in Google Artifact Registry.

**A. Create an Artifact Registry Repository**

```bash
gcloud artifacts repositories create teamchess-repo \
  --repository-format=docker \
  --location=$REGION
```

**B. Authenticate Docker**

```bash
gcloud auth configure-docker ${REGION}-docker.pkg.dev
```

**C. Build and Push All Images**

```bash
export ALLOCATOR_IMAGE=$REGION-docker.pkg.dev/$PROJECT_ID/teamchess-repo/allocator-service:latest
export GAME_SERVER_IMAGE=$REGION-docker.pkg.dev/$PROJECT_ID/teamchess-repo/game-server:latest

# Build and push the allocator service image
docker build -t $ALLOCATOR_IMAGE -f master-server/Dockerfile .
docker push $ALLOCATOR_IMAGE

# Build and push the game server image
docker build -t $GAME_SERVER_IMAGE -f server/Dockerfile .
docker push $GAME_SERVER_IMAGE
```

### Step 3: Create GKE Cluster and Install Agones

**A. Create the GKE Cluster**

```bash
gcloud container clusters create teamchess-cluster \
  --region=$REGION \
  --machine-type=e2-standard-4 \
  --num-nodes=2 \
  --scopes "https://www.googleapis.com/auth/cloud-platform"
```

**B. Install Agones on the Cluster**

```bash
kubectl create namespace agones-system
kubectl apply -f https://raw.githubusercontent.com/googleforgames/agones/release-1.38.0/install/yaml/install.yaml
```

### Step 4: Deploy Backend Services

**A. Deploy the Allocator Service**
Create `allocator-deployment.yaml` to define the deployment and a LoadBalancer service to expose it publicly.

```yaml
# allocator-deployment.yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: allocator-service
spec:
  replicas: 2
  selector:
    matchLabels:
      app: allocator-service
  template:
    metadata:
      labels:
        app: allocator-service
    spec:
      containers:
        - name: allocator
          image: # PASTE YOUR ALLOCATOR_IMAGE URL HERE
          ports:
            - containerPort: 4000
---
apiVersion: v1
kind: Service
metadata:
  name: allocator-service-lb
spec:
  type: LoadBalancer
  selector:
    app: allocator-service
  ports:
    - protocol: TCP
      port: 80
      targetPort: 4000
```

Apply it: `kubectl apply -f allocator-deployment.yaml`. Get the external IP address: `kubectl get service allocator-service-lb`. **You will need this IP for the frontend.**

**B. Deploy the Game Server Fleet**
Create `fleet.yaml`:

```yaml
# fleet.yaml
apiVersion: 'agones.dev/v1'
kind: Fleet
metadata:
  name: teamchess-fleet
spec:
  replicas: 2 # Keep 2 servers warm
  strategy:
    type: RollingUpdate
    rollingUpdate:
      maxSurge: 1
      maxUnavailable: 1
  template:
    spec:
      ports:
        - name: default
          portPolicy: Dynamic
          containerPort: 3001
      template:
        spec:
          containers:
            - name: teamchess-server
              image: # PASTE YOUR GAME_SERVER_IMAGE URL HERE
```

Apply it: `kubectl apply -f fleet.yaml`.

### Step 5: Deploy Frontend to Cloud Storage

This process is still optimal for hosting a static React site [cite: 349-355].

**A. Create a Production Environment File**
Create `client/.env.production` and add the Allocator Service's external IP.

```bash
echo "VITE_ALLOCATOR_URL=http://YOUR_ALLOCATOR_LOAD_BALANCER_IP" > client/.env.production
```

**B. Build and Upload**

```bash
npm run build --workspace=client
export BUCKET_NAME=teamchess-client-assets-www-yokyok-ninja # Use a globally unique name
gsutil mb -l $REGION gs://${BUCKET_NAME}
gsutil rsync -d -R client/dist gs://${BUCKET_NAME}
gsutil iam ch allUsers:objectViewer gs://${BUCKET_NAME}
```

**C. Set Up HTTPS Load Balancer**
This is identical to your previous setup. Point your domain's A record (`www.yokyok.ninja`) to the reserved global static IP for the load balancer.

### Step 6: Updating Deployments

**A. Updating the Frontend Client**
This process remains the same: rebuild, sync to GCS, and invalidate the CDN cache [cite: 356-362].

```bash
npm run build --workspace=client
gsutil rsync -d -R client/dist gs://${BUCKET_NAME}
gcloud compute url-maps invalidate-cdn-cache teamchess-lb-url-map --path "/*" --global
```

**B. Updating a Backend Service (Allocator or Game Server)**

1.  Rebuild and push the new Docker image with a new tag (e.g., `:v2`).
2.  Update the image reference in the corresponding YAML file (`allocator-deployment.yaml` or `fleet.yaml`).
3.  Apply the updated manifest: `kubectl apply -f your-file.yaml`. Kubernetes/Agones will handle the rolling update.
