# ♟️ TeamChess

TeamChess is a simple, self-hosted chess application designed to run as a single, dedicated game server.

## The Game Concept

TeamChess is a collaborative chess game. Everyone who connects to the server joins the **same game**.

1.  **Join a Team:** You can join as **White**, **Black**, or a **Spectator**.
2.  **Propose a Move:** All players on the team whose turn it is can propose a move.
3.  **The Best Move Wins:** When all active players on the team have submitted a move, the server uses Stockfish to analyze all _proposed_ moves and selects the best one to play on the board.

## Tech Stack

- **Backend:** Node.js, Express, Socket.IO
- **Frontend:** React, Vite, `react-chessboard`
- **Engine:** Stockfish.js
- **Container:** Docker & Docker Compose

---

## 🚀 Local Development

You can run the project in three different ways depending on your goal.

### 1. Dev Mode (Coding ⚡)

_Best for writing code. Features live updates (Hot Reload) for the frontend and auto-restart for the backend._

1.  **Terminal 1 (Backend):**

    ```sh
    npm run dev
    ```

    _Runs the server on port 3001._

2.  **Terminal 2 (Frontend):**
    ```sh
    npx vite client
    ```
    _Runs the client on port 5173._

👉 **Access:** Open `http://localhost:5173`

### 2. Local Production (Testing 🏗️)

_Best for verifying the build process before deploying. No live updates._

1.  **Build:**
    ```sh
    npm run build
    ```
2.  **Start:**
    ```sh
    npm run start
    ```

👉 **Access:** Open `http://localhost:3001`

### 3. Docker (Deployment Sim 🐳)

_Best for simulating the exact production environment (Linux/Alpine)._

1.  **Build & Run:**
    ```sh
    docker compose build --no-cache
    docker compose up -d
    ```

👉 **Access:** Open `http://localhost` (Port 80 maps to container port 3001)

---

## 🌎 Production Deployment (on a single GCP VM)

This guide will walk you through setting up a small, cheap virtual machine on Google Cloud Platform to run your game 24/7.

### Step 1: Install and Configure `gcloud` CLI

1.  **Login to your Google Account:**
    ```sh
    gcloud auth login
    ```
2.  **Set your project:** (Replace `YOUR_PROJECT_ID` with your actual GCP project ID)
    ```sh
    gcloud config set project YOUR_PROJECT_ID
    ```

### Step 2: Create the Firewall Rule

We need to allow traffic on port 80 (HTTP) to reach our server.

```sh
gcloud compute firewall-rules create http-80 \
    --allow tcp:80 \
    --target-tags http-server \
    --description="Allow HTTP traffic on port 80"

```

### Step 3: Create the VM Instance

This command will create a small e2-standard-2 server, using Ubuntu 22.04, and apply our http-server firewall tag.

```sh
gcloud compute instances create teamchess-server \
    --machine-type=e2-standard-2 \
    --image-family=ubuntu-2204-lts \
    --image-project=ubuntu-os-cloud \
    --zone=europe-west1-b \
    --tags=http-server

```

### Step 4: SSH into the VM and Install Dependencies

1. **SSH into your new VM:**

```sh
gcloud compute ssh teamchess-server --zone=europe-west1-b

```

2. **Update packages:**

```sh
sudo apt-get update

```

3. **Install Git:**

```sh
sudo apt-get install git -y

```

4. **Install Docker and Docker Compose:**

```sh
# Install prerequisites
sudo apt-get install ca-certificates curl -y
sudo install -m 0755 -d /etc/apt/keyrings
sudo curl -fsSL [https://download.docker.com/linux/ubuntu/gpg](https://download.docker.com/linux/ubuntu/gpg) -o /etc/apt/keyrings/docker.asc
sudo chmod a+r /etc/apt/keyrings/docker.asc

# Add the repository to Apt sources
echo \
  "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] [https://download.docker.com/linux/ubuntu](https://download.docker.com/linux/ubuntu) \
  $(. /etc/os-release && echo "$VERSION_CODENAME") stable" | \
  sudo tee /etc/apt/sources.list.d/docker.list > /dev/null
sudo apt-get update

# Install Docker Engine and Compose plugin
sudo apt-get install docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin -y

```

5.  **Add your user to the `docker` group** (to avoid using `sudo` for Docker):

```sh
sudo usermod -aG docker $USER

```

6.  **IMPORTANT:** Log out and log back in for the group change to take effect.

```sh
exit
gcloud compute ssh teamchess-server --zone=europe-west1-b

```

### Step 5: Clone and Run Your Project

1. **Clone your project:**

```sh
git clone <YOUR_REPO_URL>
cd teamchess

```

2. **Build and run the container:**

```sh
docker compose build --no-cache
docker compose up -d

```

### Step 6: Find Your IP and Play!

1.  **Get your VM's external IP address.** (Run this in your **local terminal**, not SSH):

```sh
gcloud compute instances describe teamchess-server \
    --zone=europe-west1-b \
    --format='get(networkInterfaces[0].accessConfigs[0].natIP)'

```

2. **Play:** Paste the IP address into your browser. Share it with your friends!

---

## ✏️ Updating Production (Deploying Changes)

When you have pushed code changes to `main`:

1. **SSH** into your VM:

```sh
gcloud compute ssh teamchess-server --zone=europe-west1-b

```

2. **Navigate** to your project directory:

```sh
cd teamchess

```

3. **Pull** the latest changes:

```sh
git pull

```

4. **Rebuild and restart**:

```sh
docker compose build --no-cache
docker compose up -d

```
