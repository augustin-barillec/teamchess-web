# TeamChess

**Collaborative turn-based chess with Stockfish-powered move selection.**

This project is a full-stack application featuring a React frontend and a Node.js backend, containerized with Docker for easy deployment.

---

## Structure

- `shared/` — Shared types and enums between the client and server.
- `server/` — Socket.IO + Stockfish backend server (TypeScript).
- `client/` — React + Vite frontend application.

---

## Local Development

For running the application directly on your local machine for development purposes.

1.  **Install dependencies** from the root of the project:

    ```bash
    npm install
    ```

2.  **Start the development servers** for both the client and server:

    ```bash
    npm run dev
    ```

    The client will be available at `http://localhost:5173`.

---

## Docker (Local Pre-production)

Test the production-ready Docker environment on your local machine. This is the best way to ensure the containerized application works before deploying.

1.  **Prerequisites**: Make sure you have **Docker** and **Docker Compose** installed.

2.  **Build and run the containers**:

    ```bash
    docker compose up --build
    ```

    This command builds the images for the client and server and starts the application stack. The app will be available at `http://localhost:80`.

---

## Production Deployment (Google Cloud)

These instructions guide you through deploying the application to a Google Compute Engine VM. This method uses Docker Compose's built-in restart capabilities to ensure the application starts automatically on boot.

### 1\. Initial Setup (Local Machine)

Run these commands from your **local terminal** to create the necessary cloud infrastructure.

1.  **Create the Debian VM**:

    ```bash
    gcloud compute instances create teamchess-vm \
      --project=YOUR_PROJECT_ID \
      --zone=europe-west1-b \
      --machine-type=e2-medium \
      --image-family=debian-12 \
      --image-project=debian-cloud \
      --tags=http-server
    ```

2.  **Create the firewall rule** to allow web traffic on port 80:

    ```bash
    gcloud compute firewall-rules create allow-http-traffic \
      --network=default \
      --action=ALLOW \
      --direction=INGRESS \
      --rules=tcp:80 \
      --source-ranges=0.0.0.0/0 \
      --target-tags=http-server
    ```

### 2\. Configure the VM

Connect to your new VM and install the required software.

1.  **SSH into the VM**:

    ```bash
    gcloud compute ssh teamchess-vm --zone=europe-west1-b
    ```

2.  **Install Git, Docker, and Docker Compose** inside the VM:

    ```bash
    # Update packages and install prerequisites
    sudo apt-get update
    sudo apt-get install -y ca-certificates curl git

    # Add Docker's official GPG key and repository
    sudo install -m 0755 -d /etc/apt/keyrings
    sudo curl -fsSL https://download.docker.com/linux/debian/gpg -o /etc/apt/keyrings/docker.asc
    sudo chmod a+r /etc/apt/keyrings/docker.asc
    echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/debian $(. /etc/os-release && echo "$VERSION_CODENAME") stable" | sudo tee /etc/apt/sources.list.d/docker.list > /dev/null

    # Install Docker Engine and the Compose plugin
    sudo apt-get update
    sudo apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
    ```

3.  **Add your user to the `docker` group** to run Docker commands without `sudo`.

    ```bash
    sudo usermod -aG docker ${USER}
    ```

    **Important**: You must log out (`exit`) and log back in for this change to take effect.

### 3\. Deploy and Run the Application

Clone your application repository onto the VM and start it using Docker Compose.

1.  **Clone your repository** inside the VM:

    ```bash
    git clone https://github.com/your-username/teamchess.git
    cd teamchess
    ```

2.  **Build and start the application**:

    ```bash
    docker compose up --build -d
    ```

    - `--build`: This builds the Docker images from scratch.
    - `-d`: This runs the containers in "detached" mode, so they run in the background.

3.  **How Auto-Start Works**: The `docker-compose.yaml` file includes the `restart: unless-stopped` policy for both services. This tells the Docker daemon to automatically restart these containers whenever the VM boots up or if they crash.

### 4\. Managing the Live Application

- **Accessing the App**: Find your VM's public IP address in the Google Cloud Console or by running `gcloud compute instances describe teamchess-vm --format='get(networkInterfaces[0].accessConfigs[0].natIP)'` on your local machine. Access the app at: `http://<YOUR_VM_EXTERNAL_IP>`

- **Updating the App**: To deploy new changes, SSH into the VM, pull the latest code, and re-run the `docker compose` command. It will intelligently rebuild and restart only the services that have changed.

  ```bash
  cd ~/teamchess
  git pull
  docker compose up --build -d
  ```

- **Viewing Logs**: To see the real-time logs from all running services:

  ```bash
  docker compose logs -f
  ```

- **Stopping the App**: To stop and remove all application containers:

  ```bash
  docker compose down
  ```
