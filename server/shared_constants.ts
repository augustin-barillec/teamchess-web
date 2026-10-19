// Game constants shared by the server and the browser client. Kept apart from
// `constants.ts` because that one reaches for `path` to locate Stockfish, which
// no bundle for the browser can follow — the client imports this file directly.

/** Default clock time per side in seconds (10 minutes) */
export const DEFAULT_CLOCK_TIME = 600;

/**
 * Time threshold (seconds) at or below which increment is awarded — and, on the
 * client, at or below which the clock switches to its low-time styling. One
 * number, so the warning can never appear on a clock that is not yet earning.
 */
export const INCREMENT_THRESHOLD = 60;

/** Seconds added per move when time is at or below INCREMENT_THRESHOLD */
export const TIME_INCREMENT = 10;

// ─── Limits ───────────────────────────────────────────────────────────────────
// What the server takes from a client, and what the inputs let a player type, so
// that an honest client never runs into the server's refusal. The server is the
// one that enforces them: a modified client types nothing.

export const MAX_PLAYER_NAME_LENGTH = 30;
export const MAX_CHAT_MESSAGE_LENGTH = 500;
