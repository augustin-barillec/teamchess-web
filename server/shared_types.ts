// Types shared by the server and the browser client: the game as the server
// publishes it, and the two messages that travel over the socket.

export enum GameStatus {
  Setup = "Setup",
  AwaitingProposals = "AwaitingProposals",
  FinalizingTurn = "FinalizingTurn",
  Over = "Over",
}

export enum EndReason {
  Checkmate = "checkmate",
  Stalemate = "stalemate",
  Threefold = "threefold repetition",
  Insufficient = "insufficient material",
  DrawRule = "draw by rule",
  Resignation = "resignation",
  DrawAgreement = "draw by agreement",
  Timeout = "timeout",
  Abandonment = "abandonment",
}

export type Side = "white" | "black" | "spectator";
export type PlayerSide = "white" | "black";
export type VoteType = "resign" | "offer_draw" | "accept_draw";

export interface Player {
  id: string;
  name: string;
  side: Side;
}

export interface Proposal {
  id: string;
  name: string;
  lan: string; // Long Algebraic Notation (e.g., "e2e4")
  san: string; // Standard Algebraic Notation (e.g., "e4")
}

/** One turn of the game. Turn i is move number i + 1; the last one is the turn in progress. */
export interface Turn {
  side: PlayerSide;
  proposals: Proposal[];
  /**
   * The move the turn settled on. Deliberately not a whole Proposal: a winning move can
   * have several authors, and the moves panel marks them all by matching lan.
   */
  selection?: { lan: string; san: string };
}

/**
 * The single active vote. Only one can run at a time, whatever team started it, and
 * everyone sees it: the frozen electorate alone decides who can act on it.
 */
export interface Vote {
  type: VoteType;
  side: PlayerSide;
  /** Whoever was on the side when the vote opened, with the name they had then. */
  voters: Array<{ id: string; name: string; yes: boolean }>;
  endTime: number; // Date.now() + duration
}

/**
 * A team is empty and will lose when the countdown runs out, unless the player who
 * left comes back or anyone else joins that side. `side` is the empty team, or null
 * when both are empty and the game is heading for a draw.
 */
export interface ForfeitCountdown {
  side: PlayerSide | null;
  endTime: number; // Date.now() + TEAM_EMPTY_FORFEIT_MS
}

export interface GameOver {
  reason: EndReason;
  winner: PlayerSide | null;
  pgn: string;
}

export interface ChatMessage {
  sender: string;
  senderId: string;
  message: string;
  system?: boolean;
}

/**
 * The whole game as the server sees it. Published in full after every change, so a
 * client never has to reconstruct anything: it replaces what it has.
 */
export interface GameState {
  /** The player who may kick and reset: the longest-present one, or null when empty. */
  leadId: string | null;
  players: Player[];
  status: GameStatus;
  fen: string;
  turns: Turn[];
  /** Seconds left, as of `turnStartedAt` for the side to move, as of now for the other. */
  whiteTime: number;
  blackTime: number;
  /** When the running clock started, or null while no clock runs. Clients extrapolate. */
  turnStartedAt: number | null;
  vote: Vote | null;
  drawOffer: PlayerSide | null;
  forfeit: ForfeitCountdown | null;
  gameOver: GameOver | null;
}

/** Everything a client can ask for, sent on the "action" socket event. */
export type ClientAction =
  | { type: "SET_NAME"; payload: { name: string } }
  | { type: "JOIN_SIDE"; payload: { side: Side } }
  | { type: "SUBMIT_MOVE"; payload: { lan: string } }
  | { type: "START_TEAM_VOTE"; payload: { voteType: VoteType } }
  | { type: "VOTE_TEAM"; payload: { vote: "yes" | "no" } }
  | { type: "SEND_CHAT"; payload: { message: string } }
  // Lead powers: refused from anyone else.
  | { type: "RESET_GAME"; payload: null }
  | { type: "KICK_PLAYER"; payload: { id: string } };

/** Everything the server ever says, sent on the "event" socket event. */
export type ServerEvent =
  | { type: "SESSION"; payload: { id: string; name: string } } // who you are, on connection
  | { type: "STATE"; payload: GameState }
  | { type: "CHAT"; payload: ChatMessage }
  | { type: "ERROR"; payload: { message: string } } // to one player: why an action was refused
  | { type: "KICKED"; payload: null }; // to one player: leave, and do not come back
