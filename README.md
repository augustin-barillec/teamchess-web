# TeamChess ♟️

TeamChess is a real-time, collaborative multiplayer chess application where teams of players vote on the best move for their side. This project is a full-stack monorepo featuring a React frontend and a scalable backend using Node.js game servers orchestrated by Agones on Google Kubernetes Engine.

## Features

- **On-Demand Game Servers**: Automatically allocates a dedicated server for each game session.
- **Real-time Multiplayer**: Play chess with multiple people on each team in a single game.
- **Move by Committee**: Players propose moves, and the team's most popular or engine-verified best move is played.
- **Spectator Mode**: Join games to watch the action unfold without participating.
- **In-Game Chat**: Communicate with other players and spectators in the game room.

---

## Tech Stack

- **Frontend**: React, TypeScript, Vite, Socket.IO Client, `react-chessboard`.
- **Backend (Game Server)**: Node.js, TypeScript, Socket.IO, `chess.js`, orchestrated by **Agones**.
- **Backend (Allocator Service)**: Node.js, TypeScript, and Express, acting as a stateless service to allocate game servers via the Agones API.
- **Monorepo Management**: npm Workspaces for managing shared code and dependencies.
- **Infrastructure**: Docker, **Minikube** (for local development), **Google Kubernetes Engine (GKE)** (for production).

---

## Local Development Environment Setup

This guide provides a reliable method for running the complete application stack locally using Minikube.

### Prerequisites

- **Docker**: For running containers.
- **Node.js**: Version 22 or higher.
- **kubectl**: For interacting with Kubernetes.
- **Minikube**: For running a local Kubernetes cluster.

### Step 1: Clean Up Previous Environments (Optional)

If you have a previous Minikube cluster, it's best to start fresh to ensure the correct network configuration.

```bash
minikube delete
```

### Step 2: Start Minikube

```bash
minikube start --driver=docker
```

### Step 3: Install Agones

Install the Agones game server orchestrator onto your new cluster.

```bash
# Create the namespace for Agones
kubectl create namespace agones-system

# Install Agones from the official YAML
kubectl create -f https://raw.githubusercontent.com/googleforgames/agones/release-1.52.0/install/yaml/install.yaml
```

Wait for the Agones pods to be running by checking `kubectl get pods -n agones-system`.

### Step 4: Install Project Dependencies

From the root of the project, install all dependencies for all workspaces.

```bash
npm install
```

### Step 5: Build and Load Docker Images

Build the Docker images for the allocator and the game server and load them into Minikube's internal Docker registry.

```bash
# Point your shell to Minikube's Docker daemon
eval $(minikube -p minikube docker-env)

# Build the images
docker build -t teamchess-allocator:local -f master-server/Dockerfile .
docker build -t teamchess-server:local -f server/Dockerfile .
```

### Step 6: Deploy Local Applications to Minikube

Apply the development manifests to deploy your services and the necessary permissions.

```bash
# Apply permissions for the allocator
kubectl apply -f development/allocator-rbac.yaml

# Deploy the allocator service
kubectl apply -f development/allocator-deployment.yaml

# Deploy the game server fleet
kubectl apply -f development/fleet.yaml
```

### Step 7: Run the Application\!

You will need two separate terminals for this final step.

**Terminal 1: Port-Forward the Allocator**
This command creates a tunnel to the allocator service. Keep this terminal open.

```bash
kubectl port-forward service/allocator-service 4000:4000
```

**Terminal 2: Start the Frontend Client**
This starts the Vite development server.

```bash
npm run dev --workspace=client
```

Now, you can open your browser to `http://localhost:5173` and play the game\!

---

### How to Update the `master-server` (Allocator)

The allocator is a standard Kubernetes `Deployment`.

**Step 1: Rebuild the Docker Image**
First, make sure your shell is connected to Minikube's Docker daemon. Then, rebuild the image. This command replaces your old `teamchess-allocator:local` image with a new one containing your code changes.

```bash
# Ensure you are connected to Minikube's Docker
eval $(minikube -p minikube docker-env)

# Rebuild the image
docker build -t teamchess-allocator:local -f master-server/Dockerfile .
```

**Step 2: Restart the Deployment**
Now, tell Kubernetes to restart the `allocator-service` deployment. This will gracefully terminate the old pod and create a new one based on the new image you just built.

```bash
kubectl rollout restart deployment allocator-service
```

You can watch the new pod come up with `kubectl get pods -w`.

---

### How to Update the `server` (Game Server)

The game server is managed by an Agones `Fleet`. The process is similar to updating the allocator but uses a different resource type.

**Step 1: Rebuild the Docker Image**
First, rebuild the game server image to include your changes.

```bash
# Ensure you are connected to Minikube's Docker
eval $(minikube -p minikube docker-env)

# Rebuild the image
docker build -t teamchess-server:local -f server/Dockerfile .
```

**Step 2: Update the Fleet's GameServers**
For an Agones `Fleet`, the correct way to force an update with a `:local` image tag is to delete the **`GameServer`** resources it manages. The Fleet controller will automatically detect that they are missing and create new ones using the latest version of the `teamchess-server:local` image.

```bash
kubectl delete gameservers -l agones.dev/fleet=teamchess-fleet
```

You can watch the old `GameServers` terminate and the new ones become `Ready` with `kubectl get gameservers -w`.

## Production Deployment on GKE

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
