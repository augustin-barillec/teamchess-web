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
  ChatMessage,
  GameInfo,
  Proposal,
  Selection,
  VoteType,
  TeamVoteState,
  KickVoteState,
  ResetVoteState,
} from "../../server/shared_types";

export { GameStatus, EndReason } from "../../server/shared_types";
