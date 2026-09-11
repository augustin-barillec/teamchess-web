import { Chess } from "chess.js";
import { GameStatus, VoteType } from "./shared_types.js";

export type Side = "white" | "black" | "spectator";
export type PlayerSide = "white" | "black";

export type Session = {
  pid: string;
  name: string;
  side: Side;
};

// `eligibleVoters` is the vote's frozen electorate: pid -> name as of vote creation.
// Never mutate it or `required` on an in-flight vote. Only one vote can be active
// at a time (gameState.activeVote).

export interface InternalTeamVote {
  side: PlayerSide;
  type: VoteType;
  yesVoters: Set<string>;
  readonly eligibleVoters: ReadonlyMap<string, string>;
  readonly required: number;
  timer: NodeJS.Timeout;
  endTime: number;
}

export interface Engine {
  send: (command: string, callback?: (output: string) => void) => void;
  quit: () => void;
}

export interface GameState {
  /**
   * Bumped on every game end or reset. Async callbacks (engine search) capture it
   * before awaiting and bail out if it changed — their turn no longer exists.
   */
  generation: number;
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
  /** Formatted end-of-game announcement, kept for resyncing late joiners. */
  endMessage?: string;
  drawOffer?: "white" | "black";
  activeVote?: InternalTeamVote;
  /** Armed while a team has nobody on it. See endIfOneSided. */
  forfeitTimer?: NodeJS.Timeout;
  forfeitEndTime: number;
  blacklist: Set<string>;
}

export type {
  Player,
  PlayersUpdate,
  Proposal,
  VoteType,
  ForfeitCountdown,
} from "./shared_types.js";

export { GameStatus, EndReason } from "./shared_types.js";
