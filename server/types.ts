import { Chess } from "chess.js";
import { GameStatus, VoteType } from "./shared_types.js";

export type Side = "white" | "black" | "spectator";
export type PlayerSide = "white" | "black";

export type Session = {
  pid: string;
  name: string;
  side: Side;
  reconnectTimer?: NodeJS.Timeout;
};

export interface InternalVoteState {
  type: VoteType;
  initiatorId: string;
  yesVoters: Set<string>;
  eligibleVoters: Set<string>;
  required: number;
  timer: NodeJS.Timeout;
  endTime: number;
}

export interface Engine {
  send: (command: string, callback?: (output: string) => void) => void;
  quit: () => void;
}

export interface GameState {
  whiteIds: Set<string>;
  blackIds: Set<string>;
  moveNumber: number;
  side: PlayerSide;
  proposals: Map<string, { lan: string; san: string; name: string }>;
  whiteTime: number;
  blackTime: number;
  timerInterval?: NodeJS.Timeout;
  engine: Engine;
  chess: Chess;
  status: GameStatus;
  endReason?: string;
  endWinner?: string | null;
  drawOffer?: "white" | "black";
  whiteVote?: InternalVoteState;
  blackVote?: InternalVoteState;
}

export type {
  Player,
  Players,
  ChatMessage,
  GameInfo,
  Proposal,
  Selection,
  VoteType,
  TeamVoteState,
} from "./shared_types.js";

export { GameStatus, EndReason } from "./shared_types.js";
