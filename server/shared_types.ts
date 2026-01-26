export interface Player {
  id: string;
  name: string;
  connected: boolean;
}

export type Players = {
  spectators: Player[];
  whitePlayers: Player[];
  blackPlayers: Player[];
};

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

export type Selection = Proposal & {
  fen: string;
  candidates: Proposal[];
};

export type VoteType = "resign" | "offer_draw" | "accept_draw";

export interface TeamVoteState {
  isActive: boolean;
  type: VoteType | null;
  initiatorName: string;
  yesVotes: string[];
  requiredVotes: number;
  endTime: number;
}

export interface PollState {
  isActive: boolean;
  question: string;
  yesVotes: string[];
  noVotes: string[];
  endTime: number;
}

export enum GameStatus {
  Lobby = "Lobby",
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
