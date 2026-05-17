// Per-player identity colours, shared by the chat, move list and player list
// so the same person is the same colour everywhere. No green: green is
// reserved as a state signal (selected move / player has played this turn).
const PLAYER_COLORS = [
  "var(--color-player-1)",
  "var(--color-player-2)",
  "var(--color-player-3)",
  "var(--color-player-4)",
  "var(--color-player-5)",
  "var(--color-player-6)",
  "var(--color-player-7)",
  "var(--color-player-8)",
  "var(--color-player-9)",
  "var(--color-player-10)",
];

// Hash the stable senderId/playerId (not the display name) so the same person
// always gets the same colour and near-identical/empty names don't collide.
export const colorForPlayer = (id: string): string => {
  let hash = 0;
  for (let i = 0; i < id.length; i++) {
    hash = (hash * 31 + id.charCodeAt(i)) | 0;
  }
  return PLAYER_COLORS[Math.abs(hash) % PLAYER_COLORS.length];
};
