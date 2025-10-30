# ♟️ TeamChess

This project is a simple, self-hosted chess application. It's designed to run as a single, dedicated game server.

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

1.  **Install Dependencies & Git Hooks:**

    ```sh
    npm install
    ```

    This installs all local dependencies (like `husky` and `prettier`) and runs the `prepare` script to set up the pre-commit hooks. **This step is required** for your pre-commit formatting to work.

2.  **Build and run the container:**

    ```sh
    docker compose up --build
    ```

    This command will build the `Dockerfile` , start the container, and stream the server logs to your terminal.

3.  **Access the game:**
    Open `http://localhost` in your browser .
    The `docker-compose.yaml` file maps your machine's port 80 to the container's port 3001 .

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

This command will create a small `e2-micro` server in the `europe-west1` region, using Ubuntu 22.04, and apply our `http-server` firewall tag.

```sh
gcloud compute instances create teamchess-server \
    --machine-type=e2-micro \
    --image-family=ubuntu-2204-lts \
    --image-project=ubuntu-os-cloud \
    --region=europe-west1 \
    --tags=http-server
```

### Step 4: SSH into the VM and Install Dependencies

1.  **SSH into your new VM:**

    ```sh
    gcloud compute ssh teamchess-server --region=europe-west1
    ```

    You are now inside the VM's terminal.

2.  **Update packages:**

    ```sh
    sudo apt-get update
    ```

3.  **Install Git:**

    ```sh
    sudo apt-get install git -y
    ```

4.  **Install Docker and Docker Compose:**

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
    ```

    Then run the SSH command again:

    ```sh
    gcloud compute ssh teamchess-server --region=europe-west1
    ```

### Step 5: Clone and Run Your Project

1.  **Clone your project:**

2.  **Build and run the container in "detached" mode:**

    ```sh
    docker compose up --build -d
    ```

    - `--build` forces it to build your image from the `Dockerfile`.
    - `-d` (detached) runs the container in the background so you can close the SSH window.

### Step 6: Find Your IP and Play\!

1.  **Get your VM's external IP address.** You can run this in your **local terminal** (not the SSH one):

    ```sh
    gcloud compute instances describe teamchess-server \
        --region=europe-west1 \
        --format='get(networkInterfaces[0].accessConfigs[0].natIP)'
    ```

2.  **Play:** Paste the IP address (e.g., `http://34.123.45.67`) into your browser. Share it with your friends\!

---

## ✏️ Updating Production (Deploying Changes)

Here is the simple workflow for when you've made code changes locally and want to push them to your live server.

### On Your Local Machine

1.  Make your code changes.
2.  Test them locally (`docker compose up --build`).
3.  When you're happy, commit and push your changes to `main`:
    ```sh
    git add .
    git commit -m "feat: added a new feature"
    git push main
    ```

### On Your GCP VM

1.  **SSH** into your VM:

    ```sh
    gcloud compute ssh teamchess-server --region=europe-west1
    ```

2.  **Navigate** to your project directory:

    ```sh
    cd your-repo-name
    ```

3.  **Pull** the latest changes from GitHub:

    ```sh
    git pull main
    ```

4.  **Rebuild and restart** the container with your new code:

    ```sh
    docker compose up --build -d
    ```

That's it\! Docker Compose will intelligently rebuild the image and restart the container with your new code.
