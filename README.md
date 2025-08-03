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

    This command builds the images for the client and server and starts the application stack. The app will be available at `http://localhost:5173`.

---

## Production Deployment (Google Cloud)

These instructions guide you through deploying the application to a Google Compute Engine VM.

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

### 3\. Deploy and Configure Auto-Start

Clone your application and create a `systemd` service to manage it and enable auto-start on boot.

1.  **Clone your repository** inside the VM:

    ```bash
    git clone https://github.com/your-username/teamchess.git
    cd teamchess
    ```

2.  **Create the `systemd` service file**:

    ```bash
    sudo nano /etc/systemd/system/teamchess.service
    ```

3.  **Paste the following configuration** into the editor. Remember to replace `your-user` with your actual username on the VM (run `whoami` to check).

    ```ini
    [Unit]
    Description=TeamChess Docker Compose Application
    Requires=docker.service
    After=docker.service

    [Service]
    User=your-user
    Group=docker
    WorkingDirectory=/home/your-user/teamchess
    Restart=on-failure
    ExecStart=/usr/bin/docker compose up
    ExecStop=/usr/bin/docker compose down

    [Install]
    WantedBy=multi-user.target
    ```

    Save the file and exit (`Ctrl+X`, then `Y`, then `Enter`).

4.  **Enable and start the service**:

    ```bash
    sudo systemctl daemon-reload
    sudo systemctl enable teamchess.service
    sudo systemctl start teamchess.service
    ```

### 4\. Managing the Live Application

- **Accessing the App**: Find your VM's public IP address in the Google Cloud Console or by running `gcloud compute instances describe teamchess-vm --format='get(networkInterfaces[0].accessConfigs[0].natIP)'` on your local machine. Access the app at: `http://<YOUR_VM_EXTERNAL_IP>`

- **Updating the App**: To deploy new changes, SSH into the VM, pull the latest code, and restart the service.

  ```bash
  cd ~/teamchess
  git pull
  sudo systemctl restart teamchess.service
  ```
