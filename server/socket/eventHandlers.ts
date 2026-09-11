import { Socket } from "socket.io";
import { Chess } from "chess.js";
import { sessions, getGameState, getIO, isLead } from "../state.js";
import { GameStatus, VoteType } from "../types.js";
import { broadcastPlayers } from "../utils/messaging.js";
import {
  tryFinalizeTurn,
  endIfOneSided,
  executeGameReset,
} from "../game/gameLogic.js";
import { startClock } from "../game/clock.js";
import { startTeamVote, castVote } from "../voting.js";
import { executeKick } from "../players/playerManager.js";
import { MSG } from "../shared_messages.js";

export function handleSetName(socket: Socket, name: string): void {
  const pid = socket.data.pid;
  const newName = name.trim().slice(0, 30);
  if (newName) {
    const sess = sessions.get(pid);
    if (sess) {
      sess.name = newName;
      socket.data.name = newName;
      broadcastPlayers();
      socket.emit("session", { id: pid, name: sess.name });
    }
  }
}

/**
 * Taking a seat cannot fail, so there is no ack: the `players` broadcast below
 * is the whole answer, and the client reads its own side back from it.
 */
export function handleJoinSide(
  socket: Socket,
  side: "white" | "black" | "spectator"
): void {
  const pid = socket.data.pid;
  const gameState = getGameState();
  const currentSess = sessions.get(pid);
  if (!currentSess) return;

  const prevSide = currentSess.side;
  currentSess.side = side;
  socket.data.side = side;

  if (gameState.status !== GameStatus.Setup) {
    if (prevSide === "white") gameState.whiteIds.delete(pid);
    else if (prevSide === "black") gameState.blackIds.delete(pid);

    if (side === "white") gameState.whiteIds.add(pid);
    else if (side === "black") gameState.blackIds.add(pid);

    endIfOneSided();
  }

  broadcastPlayers();
  tryFinalizeTurn();
}

/** Resetting the game is a lead power: it takes effect immediately, no vote. */
export function handleResetGame(
  socket: Socket,
  cb?: (res: { success?: boolean; error?: string }) => void
): void {
  if (!isLead(socket.data.pid)) {
    return cb?.({ error: MSG.errorLeadOnly });
  }

  executeGameReset();
  cb?.({ success: true });
}

export function handlePlayMove(
  socket: Socket,
  lan: string,
  cb?: (res: { error?: string }) => void
): void {
  const pid = socket.data.pid;
  const gameState = getGameState();
  const io = getIO();

  if (gameState.status === GameStatus.Setup) {
    if (socket.data.side !== "white") {
      return cb?.({ error: MSG.errorOnlyWhiteStart });
    }

    const whites = new Set<string>();
    const blacks = new Set<string>();
    for (const s of sessions.values()) {
      if (s.side === "white") whites.add(s.pid);
      else if (s.side === "black") blacks.add(s.pid);
    }

    if (blacks.size === 0) {
      return cb?.({ error: MSG.errorBothTeamsRequired });
    }

    gameState.status = GameStatus.AwaitingProposals;
    gameState.whiteIds = whites;
    gameState.blackIds = blacks;

    io.emit("game_started", {
      moveNumber: 1,
      side: "white",
      proposals: [],
    });
    io.emit("position_update", { fen: gameState.chess.fen() });
    startClock();
  } else if (gameState.status !== GameStatus.AwaitingProposals) {
    return cb?.({ error: MSG.errorNotAccepting });
  }

  const active =
    gameState.side === "white" ? gameState.whiteIds : gameState.blackIds;
  if (!active.has(pid)) return cb?.({ error: MSG.errorNotYourTurn });
  if (gameState.proposals.has(pid))
    return cb?.({ error: MSG.errorAlreadyMoved });

  let move;
  try {
    const tempChess = new Chess(gameState.chess.fen());
    move = tempChess.move(lan);
  } catch (_e) {
    return cb?.({ error: MSG.errorIllegalFormat });
  }

  if (!move) return cb?.({ error: MSG.errorIllegalMove });

  gameState.proposals.set(pid, {
    lan,
    san: move.san,
    name: socket.data.name,
  });

  io.emit("move_submitted", {
    id: pid,
    name: socket.data.name,
    moveNumber: gameState.moveNumber,
    side: gameState.side,
    lan,
    san: move.san,
  });

  tryFinalizeTurn();
  cb?.({});
}

export function handleChatMessage(socket: Socket, message: string): void {
  const pid = socket.data.pid;

  if (!message.trim()) return;
  getIO().emit("chat_message", {
    sender: socket.data.name,
    senderId: pid,
    message: message.trim(),
  });
}

export function handleStartTeamVote(socket: Socket, type: VoteType): void {
  const gameState = getGameState();

  if (socket.data.side !== "white" && socket.data.side !== "black") return;
  if (gameState.status !== GameStatus.AwaitingProposals) return;

  const result = startTeamVote(socket.data.side, type, socket.data.pid);

  if (result.error) {
    socket.emit("error", { message: result.error });
  }
}

/** Kicking is a lead power: it takes effect immediately, no vote. */
export function handleKickPlayer(socket: Socket, targetId: string): void {
  const pid = socket.data.pid;

  if (!isLead(pid)) {
    socket.emit("error", { message: MSG.errorLeadOnly });
    return;
  }
  if (pid === targetId) {
    socket.emit("error", { message: MSG.errorCannotKickSelf });
    return;
  }

  const targetSess = sessions.get(targetId);
  if (!targetSess) {
    socket.emit("error", { message: MSG.errorTargetNotFound });
    return;
  }

  executeKick(targetId, targetSess.name);
}

/**
 * Applies a yes/no ballot to whatever vote is currently active.
 * Eligibility is decided solely by the vote's frozen electorate.
 */
export function handleCastVote(socket: Socket, vote: "yes" | "no"): void {
  const result = castVote(socket.data.pid, vote);

  if (result.error) {
    socket.emit("error", { message: result.error });
  }
}
