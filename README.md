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
docker build -t teamchess-game-server:local -f game-server/Dockerfile .
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

### How to Update the `game-server` (Game Server)

The game server is managed by an Agones `Fleet`. The process is similar to updating the allocator but uses a different resource type.

**Step 1: Rebuild the Docker Image**
First, rebuild the game server image to include your changes.

```bash
# Ensure you are connected to Minikube's Docker
eval $(minikube -p minikube docker-env)

# Rebuild the image
docker build -t teamchess-game-server:local -f game-server/Dockerfile .
```

**Step 2: Update the Fleet's GameServers**
For an Agones `Fleet`, the correct way to force an update with a `:local` image tag is to delete the **`GameServer`** resources it manages. The Fleet controller will automatically detect that they are missing and create new ones using the latest version of the `teamchess-game-server:local` image.

```bash
kubectl delete gameservers -l agones.dev/fleet=teamchess-fleet
```

You can watch the old `GameServers` terminate and the new ones become `Ready` with `kubectl get gameservers -w`.
