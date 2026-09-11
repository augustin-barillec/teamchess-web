export interface Player {
  id: string;
  name: string;
}

export type Players = {
  spectators: Player[];
  whitePlayers: Player[];
  blackPlayers: Player[];
};

/**
 * The `players` broadcast. The lead ships with the roster rather than in its own
 * event so a client can never render a crown on a player it has not heard of.
 */
export type PlayersUpdate = Players & { leadId: string | null };

export type ChatMessage = {
  sender: string;
  senderId: string;
  message: string;
  system?: boolean;
};

export type GameInfo = {
  moveNumber: number;
  side: "white" | "black";
};

export type Proposal = {
  id: string;
  name: string;
  moveNumber: number;
  side: "white" | "black";
  lan: string;
  san?: string;
};

/**
 * The move a turn settled on. Deliberately not a whole Proposal: a winning move can have
 * several authors, and the moves panel marks them all by matching lan, so naming one of
 * them here would say something the UI never claims.
 */
export type Selection = Omit<Proposal, "id" | "name"> & {
  fen: string;
  candidates: Proposal[];
};

export type VoteType = "resign" | "offer_draw" | "accept_draw";

// Only one team vote can be active at a time. The server sends the whole state
// (or null) on every `vote_update`; fields are personalized per viewer.
export interface TeamVoteState {
  side: "white" | "black";
  type: VoteType;
  yesVotes: string[];
  requiredVotes: number;
  endTime: number;
  myVoteEligible: boolean;
  myCurrentVote: "yes" | null;
}

/**
 * A team is empty and will lose when the clock runs out, unless the player who
 * left comes back or anyone else joins that side. `side` is the empty
 * team, or null when both are empty and the game is heading for a draw.
 */
export interface ForfeitCountdown {
  side: "white" | "black" | null;
  endTime: number;
}

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
