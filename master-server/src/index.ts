import express from 'express';
import cors from 'cors';
import { KubeConfig, CustomObjectsApi } from '@kubernetes/client-node';
import { customAlphabet } from 'nanoid';
import { GameVisibility, MAX_PLAYERS_PER_GAME } from '@teamchess/shared';

// --- Kubernetes API Client Setup ---
const kc = new KubeConfig();
kc.loadFromDefault();
const k8sCustomApi = kc.makeApiClient(CustomObjectsApi);

// --- Express App Setup ---
const app = express();
app.use(express.json());

const corsOptions = {
  origin: function (
    origin: string | undefined,
    callback: (err: Error | null, allow?: boolean) => void,
  ) {
    if (!origin || origin.startsWith('http://localhost')) {
      return callback(null, true);
    } else {
      callback(new Error('Not allowed by CORS'));
    }
  },
};
app.use(cors(corsOptions));

// --- API Endpoints ---
const nanoid = customAlphabet('ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789', 10);
const friendlyId = () => `${nanoid(4)}-${nanoid(4)}-${nanoid(2)}`;

app.post('/create', async (req, res) => {
  const namespace = process.env.NAMESPACE || 'default';
  const fleetName = process.env.FLEET_NAME || 'teamchess-fleet';
  const gameId = friendlyId();

  const gameServerAllocation = {
    apiVersion: 'allocation.agones.dev/v1',
    kind: 'GameServerAllocation',
    spec: {
      metadata: {
        labels: { 'teamchess.dev/game-id': gameId },
      },
      required: {
        matchLabels: { 'agones.dev/fleet': fleetName },
      },
    },
  };

  try {
    console.log(`Requesting allocation for new game ID: ${gameId}`);
    // --- FIX START ---
    // The method now expects a single object argument.
    const result = await k8sCustomApi.createNamespacedCustomObject({
      group: 'allocation.agones.dev',
      version: 'v1',
      namespace: namespace,
      plural: 'gameserverallocations',
      body: gameServerAllocation,
    });
    // --- FIX END ---
    const allocationResult = result as any;

    if (allocationResult.status.state === 'Allocated') {
      const address = allocationResult.status.address;
      const port = allocationResult.status.ports[0].port;
      console.log(`Successfully allocated GameServer for ${gameId} at ${address}:${port}`);
      res.status(200).json({ address, port, gameId });
    } else {
      console.warn('Allocation unsuccessful, no servers available.');
      res
        .status(503)
        .json({ error: 'No game servers are available at this moment. Please try again soon.' });
    }
  } catch (err: any) {
    console.error('Error during allocation:', err.body ? err.body.message : err.message);
    res
      .status(500)
      .json({ error: 'An internal error occurred while trying to allocate a game server.' });
  }
});

app.get('/join/:gameId', async (req, res) => {
  const { gameId } = req.params;
  const namespace = process.env.NAMESPACE || 'default';

  if (!gameId) {
    return res.status(400).json({ error: 'Game ID is required.' });
  }

  try {
    console.log(`Looking for game with ID: ${gameId}`);
    // --- FIX START ---
    // The method now expects a single object argument.
    const result = await k8sCustomApi.listNamespacedCustomObject({
      group: 'agones.dev',
      version: 'v1',
      namespace: namespace,
      plural: 'gameservers',
      labelSelector: `teamchess.dev/game-id=${gameId}`,
    });
    // --- FIX END ---

    const servers = (result as any).items;
    if (servers.length === 0) {
      return res.status(404).json({ error: 'Game not found.' });
    }

    const server = servers[0];
    if (server.status.state !== 'Allocated') {
      return res.status(503).json({ error: 'Game is not ready to be joined.' });
    }

    const address = server.status.address;
    const port = server.status.ports[0].port;
    console.log(`Found game ${gameId} at ${address}:${port}`);
    res.status(200).json({ address, port });
  } catch (err: any) {
    console.error('Error finding game:', err.body ? err.body.message : err.message);
    res.status(500).json({ error: 'Internal error finding the game.' });
  }
});

app.get('/games', async (req, res) => {
  const namespace = process.env.NAMESPACE || 'default';
  const fleetName = process.env.FLEET_NAME || 'teamchess-fleet';

  try {
    const result = await k8sCustomApi.listNamespacedCustomObject({
      group: 'agones.dev',
      version: 'v1',
      namespace: namespace,
      plural: 'gameservers',
      // FIX 1: Query for the correct, prefixed visibility label
      labelSelector: `agones.dev/fleet=${fleetName},agones.dev/sdk-visibility=${GameVisibility.Public}`,
    });

    const servers = (result as any).items;
    if (!servers) {
      return res.status(200).json([]);
    }

    const publicGames = servers
      .map((server: any) => {
        // FIX 2: Read the player count from the correct, prefixed label
        const playerCount = parseInt(
          server.metadata.labels['agones.dev/sdk-player-count'] || '0',
          10,
        );
        const gameId = server.metadata.labels['teamchess.dev/game-id'];

        if (!gameId || playerCount >= MAX_PLAYERS_PER_GAME) {
          return null;
        }

        return {
          id: gameId,
          players: playerCount,
        };
      })
      .filter(Boolean); // Filter out any null (full or invalid) games

    res.status(200).json(publicGames);
  } catch (err: any) {
    console.error('Error listing public games:', err.body ? err.body.message : err.message);
    res.status(500).json({ error: 'Internal error finding games.' });
  }
});

// A simple health check endpoint
app.get('/healthz', (req, res) => {
  res.status(200).send('ok');
});

// --- Server Start ---
const port = process.env.PORT || 4000;
app.listen(port, () => {
  console.log(`Agones Allocator Service listening on port ${port}`);
});
