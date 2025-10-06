import express from 'express';
import cors from 'cors';
import { KubeConfig, CustomObjectsApi } from '@kubernetes/client-node';

// --- Kubernetes API Client Setup ---
// This configures the client to talk to the Kubernetes API.
// It automatically uses in-cluster credentials when deployed on GKE,
// or your local kubeconfig file for local development.
const kc = new KubeConfig();
process.env.NODE_ENV === 'production' ? kc.loadFromCluster() : kc.loadFromDefault();
const k8sCustomApi = kc.makeApiClient(CustomObjectsApi);

// --- Express App Setup ---
const app = express();
app.use(express.json());

// Re-using the same robust CORS configuration from your original file
const whitelist = ['https://storage.googleapis.com', 'https://www.yokyok.ninja'];
const corsOptions = {
  origin: function (
    origin: string | undefined,
    callback: (err: Error | null, allow?: boolean) => void,
  ) {
    if (!origin || whitelist.indexOf(origin) !== -1 || origin.startsWith('http://localhost')) {
      return callback(null, true);
    } else {
      callback(new Error('Not allowed by CORS'));
    }
  },
};
app.use(cors(corsOptions));

// --- API Endpoints ---

/**
 * The client calls this endpoint to request a dedicated game server.
 * This service asks Agones to allocate a GameServer from the fleet.
 * If successful, it returns the IP and port for the client to connect to.
 */
app.post('/allocate', async (req, res) => {
  const namespace = process.env.NAMESPACE || 'default';
  const fleetName = process.env.FLEET_NAME || 'teamchess-fleet';

  const gameServerAllocation = {
    apiVersion: 'allocation.agones.dev/v1',
    kind: 'GameServerAllocation',
    spec: {
      required: {
        matchLabels: {
          'agones.dev/fleet': fleetName,
        },
      },
    },
  };

  try {
    console.log(`Requesting allocation from fleet '${fleetName}' in namespace '${namespace}'...`);

    const result = await k8sCustomApi.createNamespacedCustomObject(
      'allocation.agones.dev',
      'v1',
      namespace,
      'gameserverallocations',
      gameServerAllocation,
    );

    // The result.body contains the allocation response. We cast it to access its properties.
    const allocationResult = result.body as any;

    if (allocationResult.status.state === 'Allocated') {
      const address = process.env.GAMESERVER_ADDRESS_OVERRIDE || allocationResult.status.address;
      const port = allocationResult.status.ports[0].port;
      console.log(`Successfully allocated GameServer: ${address}:${port}`);
      res.status(200).json({ address, port });
    } else {
      // This state can occur if no servers are ready in the fleet.
      console.warn('Allocation unsuccessful, no servers available.');
      res
        .status(503)
        .json({ error: 'No game servers are available at this moment. Please try again soon.' });
    }
  } catch (err: any) {
    console.error('Error during GameServer allocation:', err.body ? err.body.message : err.message);
    res
      .status(500)
      .json({ error: 'An internal error occurred while trying to allocate a game server.' });
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
