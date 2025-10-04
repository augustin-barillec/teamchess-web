import express from 'express';
import cors from 'cors';

const app = express();
app.use(express.json());
const whitelist = [
  'https://storage.googleapis.com', // You can keep this for testing
  'https://www.yokyok.ninja', // <-- ADD YOUR NEW DOMAIN HERE
];
const corsOptions = {
  origin: function (origin, callback) {
    // Allow requests with no origin (like mobile apps or curl requests)
    if (!origin) {
      return callback(null, true);
    }
    // Allow whitelisted origins for production and any localhost origin for development
    if (whitelist.indexOf(origin) !== -1 || origin.startsWith('http://localhost')) {
      return callback(null, true);
    } else {
      callback(new Error('Not allowed by CORS'));
    }
  },
};
app.use(cors(corsOptions));

interface GameServer {
  name: string;
  address: string;
  playerCount: number;
  maxPlayers: number;
  totalGames: number;
  maxGames: number;
  lastHeartbeat: number;
}

// Use the server's address as the key for simplicity
const activeServers = new Map<string, GameServer>();
const STALE_SERVER_TIMEOUT_MS = 35000; // 35 seconds

// The Game Servers will call this endpoint every 30 seconds
app.post('/heartbeat', (req, res) => {
  const { name, address, playerCount, maxPlayers, totalGames, maxGames } = req.body;

  if (!name || !address) {
    return res.status(400).send({ error: 'Missing required server info.' });
  }

  activeServers.set(address, {
    name,
    address,
    playerCount,
    maxPlayers,
    totalGames,
    maxGames,
    lastHeartbeat: Date.now(),
  });

  res.status(200).send({ success: true });
});

// The React client will call this to get the list of servers
app.get('/servers', (req, res) => {
  const serverList = Array.from(activeServers.values());
  res.json(serverList);
});

// Periodically clean up servers that haven't sent a heartbeat
setInterval(() => {
  const now = Date.now();
  for (const [address, server] of activeServers.entries()) {
    if (now - server.lastHeartbeat > STALE_SERVER_TIMEOUT_MS) {
      console.log(`Removing stale server: ${server.name} (${address})`);
      activeServers.delete(address);
    }
  }
}, 15000); // Check every 15 seconds

app.listen(4000, () => {
  console.log('Master server listening on port 4000');
});
