import { Proposal, Selection } from "../../server/shared_types";

export type Turn = {
  moveNumber: number;
  side: "white" | "black";
  proposals: Proposal[];
  selection?: Selection;
};

export type {
  Player,
  Players,
  PlayersUpdate,
  ChatMessage,
  GameInfo,
  Proposal,
  Selection,
  VoteType,
  TeamVoteState,
  ForfeitCountdown,
} from "../../server/shared_types";

export { GameStatus } from "../../server/shared_types";
