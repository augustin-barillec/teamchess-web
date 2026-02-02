import { sessions, getGameState, getIO } from "../state.js";
import { InternalVoteState, VoteType, EndReason } from "../types.js";
import { TEAM_VOTE_DURATION_MS } from "../constants.js";
import { sendSystemMessage, sendTeamMessage } from "../utils/messaging.js";

// Callback for ending the game (set by gameLogic to avoid circular dependency)
let endGameCallback: ((reason: string, winner: string | null) => void) | null =
  null;

export function setEndGameCallback(
  callback: (reason: string, winner: string | null) => void
): void {
  endGameCallback = callback;
}

export function getTeamVoteClientData(side: "white" | "black") {
  const gameState = getGameState();
  const vote = side === "white" ? gameState.whiteVote : gameState.blackVote;
  if (!vote) {
    return {
      isActive: false,
      type: null,
      initiatorName: "",
      yesVotes: [],
      requiredVotes: 0,
      endTime: 0,
    };
  }

  const yesNames = Array.from(vote.yesVoters).map(
    (pid) => sessions.get(pid)?.name || "Unknown"
  );

  return {
    isActive: true,
    type: vote.type,
    initiatorName: sessions.get(vote.initiatorId)?.name || "Unknown",
    yesVotes: yesNames,
    requiredVotes: vote.required,
    endTime: vote.endTime,
  };
}

export function broadcastTeamVote(side: "white" | "black"): void {
  const io = getIO();
  const data = getTeamVoteClientData(side);
  for (const socket of io.sockets.sockets.values()) {
    if (socket.data.side === side) {
      socket.emit("team_vote_update", data);
    }
  }
}

export function clearTeamVote(side: "white" | "black"): void {
  const gameState = getGameState();
  const vote = side === "white" ? gameState.whiteVote : gameState.blackVote;
  if (vote) {
    clearTimeout(vote.timer);
    if (side === "white") gameState.whiteVote = undefined;
    else gameState.blackVote = undefined;
    broadcastTeamVote(side);
  }
}

export function startTeamVoteLogic(
  side: "white" | "black",
  type: VoteType,
  initiatorId: string,
  initiatorName: string
): void {
  const gameState = getGameState();
  const io = getIO();

  // Validation
  if (
    type === "accept_draw" &&
    (!gameState.drawOffer || gameState.drawOffer === side)
  )
    return;
  if (type === "offer_draw" && gameState.drawOffer) return;

  const currentVote =
    side === "white" ? gameState.whiteVote : gameState.blackVote;
  if (currentVote) return;

  // Snapshot N (connected teammates)
  const onlinePids = new Set<string>();
  for (const s of io.sockets.sockets.values()) {
    if (s.data.pid) onlinePids.add(s.data.pid);
  }
  const teamIds = side === "white" ? gameState.whiteIds : gameState.blackIds;
  const connectedTeamIds = [...teamIds].filter((pid) => onlinePids.has(pid));
  const N = connectedTeamIds.length;

  // AUTO-EXECUTE if N<=1 AND it is a player-initiated action (Resign/Offer).
  const isSystemTriggered = initiatorId === "system";

  if (N <= 1 && !isSystemTriggered) {
    if (type === "resign") {
      const winner = side === "white" ? "black" : "white";
      sendSystemMessage(`${initiatorName} resigns.`);
      if (endGameCallback) endGameCallback(EndReason.Resignation, winner);
    } else if (type === "offer_draw") {
      gameState.drawOffer = side;
      io.emit("draw_offer_update", { side });
      sendSystemMessage(`${initiatorName} offers a draw.`);

      // Trigger vote for other side
      const otherSide = side === "white" ? "black" : "white";
      startTeamVoteLogic(otherSide, "accept_draw", "system", "System");
    } else if (type === "accept_draw") {
      sendSystemMessage(`${initiatorName} accepts the draw.`);
      if (endGameCallback) endGameCallback(EndReason.DrawAgreement, null);
    }
    return;
  }

  // START VOTE
  const endTime = Date.now() + TEAM_VOTE_DURATION_MS;
  // If system triggered (accept_draw), start with 0 votes.
  // If player triggered, start with 1 vote (themselves).
  const initialYes = isSystemTriggered
    ? new Set<string>()
    : new Set([initiatorId]);

  const voteState: InternalVoteState = {
    type,
    initiatorId,
    yesVoters: initialYes,
    eligibleVoters: new Set(connectedTeamIds), // Snapshot of voters
    required: N,
    endTime,
    timer: setTimeout(() => {
      sendTeamMessage(
        side,
        `❌ Vote to ${type.replace("_", " ")} failed: Time expired.`
      );
      if (side === "white") gameState.whiteVote = undefined;
      else gameState.blackVote = undefined;
      broadcastTeamVote(side);

      // If accept_draw fails by timeout, reject the offer
      if (type === "accept_draw") {
        gameState.drawOffer = undefined;
        io.emit("draw_offer_update", { side: null });
        sendSystemMessage("Draw offer rejected (timeout).");
      }
    }, TEAM_VOTE_DURATION_MS),
  };

  if (side === "white") gameState.whiteVote = voteState;
  else gameState.blackVote = voteState;

  if (isSystemTriggered) {
    sendTeamMessage(side, `🗳️ Draw offered! Vote to Accept Draw. (0/${N})`);
  } else {
    sendTeamMessage(
      side,
      `🗳️ ${initiatorName} started a vote to ${type.replace(
        "_",
        " "
      )}. (1/${N})`
    );
  }
  broadcastTeamVote(side);
}
