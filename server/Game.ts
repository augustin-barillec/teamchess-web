import { Chess } from "chess.js";
import type { Engine } from "./types.js";
import {
  GameStatus,
  EndReason,
  type ClientAction,
  type ForfeitCountdown,
  type GameOver,
  type GameState,
  type PlayerSide,
  type ServerEvent,
  type Side,
  type Turn,
  type Vote,
  type VoteType,
} from "./shared_types.js";
import { MSG, SENDER_SYSTEM, reasonMessages } from "./shared_messages.js";
import {
  shouldFinalizeTurn,
  calculateIncrement,
  detectGameOver,
  resolveSelectedMove,
} from "./core/turnLogic.js";
import { getCleanPgn } from "./utils/pgn.js";
import { chooseBestMove } from "./engine/stockfish.js";
import {
  DEFAULT_CLOCK_TIME,
  TEAM_EMPTY_FORFEIT_MS,
  TEAM_VOTE_DURATION_MS,
} from "./constants.js";

const MAX_NAME_LENGTH = 30;

/** Trims and caps a display name; null when nothing usable is left. */
export function normalizeName(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const name = raw.trim().slice(0, MAX_NAME_LENGTH);
  return name || null;
}

/** What the game needs from the outside world: a way to reach players. */
export interface GameHooks {
  /** Delivers an event to everyone. */
  broadcast(event: ServerEvent): void;
  /** Delivers an event to one player. */
  send(pid: string, event: ServerEvent): void;
}

/**
 * The one game this server hosts. It holds the whole state, applies every action
 * and timer to it, and after each of those publishes the state in full: nothing
 * here is ever announced piecemeal, so a client can only ever be one snapshot behind.
 */
export class Game {
  private chess = new Chess();
  private engine: Engine;

  /**
   * Identifies the turn currently in flight. finalizeTurn captures it before awaiting
   * the engine and bails out if it changed — its turn no longer exists. Only a counter
   * can say that: the game status is a state label and comes back (a reset followed by a
   * fresh turn puts us in FinalizingTurn again), a generation number never does.
   */
  private generation = 0;

  private status = GameStatus.Setup;
  private turns: Turn[] = [];
  /**
   * Everyone here, in arrival order: the first one leads, and the moment they drop off
   * the next longest-present player takes over, with no bookkeeping to keep in sync.
   * Being in the map is being here — there is no other state.
   */
  private players = new Map<string, { name: string; side: Side }>();
  /** Kicked players. A kick outlives the socket it was served on. */
  private banned = new Set<string>();

  private whiteTime = DEFAULT_CLOCK_TIME;
  private blackTime = DEFAULT_CLOCK_TIME;
  /** When the side to move's clock started running, or null while it is paused. */
  private turnStartedAt: number | null = null;
  private flagTimer: NodeJS.Timeout | null = null;

  // A single slot: only one vote can be active at a time, whichever team started it.
  private vote: (Vote & { timer: NodeJS.Timeout }) | null = null;
  private drawOffer: PlayerSide | null = null;

  /** Armed while a team has nobody on it. See checkAutoForfeit. */
  private forfeitTimer: NodeJS.Timeout | null = null;
  private forfeitEndTime = 0;

  private gameOver: GameOver | null = null;

  constructor(
    private createEngine: () => Engine,
    private hooks: GameHooks
  ) {
    this.engine = createEngine();
  }

  public destroy(): void {
    this.generation++;
    this.clearVote();
    this.pauseClock();
    this.clearForfeit();
    this.engine.quit();
  }

  // ─── Membership ───────────────────────────────────────────────────────────

  public isBanned(pid: string): boolean {
    return this.banned.has(pid);
  }

  /** A connection: seated as a spectator if new, renamed if already here. */
  public join(pid: string, name: string): void {
    const player = this.players.get(pid);
    if (player) player.name = name;
    else this.players.set(pid, { name, side: "spectator" });
    this.publish();
  }

  /**
   * Gives up a seat for good: nothing is held for an absent player, whatever the
   * game state. What makes a blink survivable is the countdown an emptied team
   * gets — long enough for the client to come back and claim its side again.
   */
  public leave(pid: string): void {
    if (!this.players.has(pid)) return;
    this.removePlayer(pid);
    this.publish();
  }

  private removePlayer(pid: string): void {
    this.players.delete(pid);
    // Active votes keep their frozen electorate: a leaver counts as an
    // abstention, which blocks unanimity until the vote times out.
    this.checkAutoForfeit();
    this.tryFinalizeTurn();
  }

  private leadId(): string | null {
    for (const pid of this.players.keys()) return pid;
    return null;
  }

  // ─── Actions ──────────────────────────────────────────────────────────────

  public processAction(pid: string, action: ClientAction): void {
    const player = this.players.get(pid);
    if (!player) {
      console.warn(`Ignoring ${action.type} from ${pid}: not in the game`);
      return;
    }
    const isLead = pid === this.leadId();

    switch (action.type) {
      case "SET_NAME": {
        const name = normalizeName(action.payload.name);
        if (name) player.name = name;
        break;
      }
      case "JOIN_SIDE":
        player.side = action.payload.side;
        this.checkAutoForfeit();
        this.tryFinalizeTurn();
        break;
      case "SUBMIT_MOVE":
        this.handleSubmitMove(pid, action.payload.lan);
        break;
      case "START_TEAM_VOTE":
        if (
          player.side !== "spectator" &&
          this.status === GameStatus.AwaitingProposals
        ) {
          this.startVote(player.side, action.payload.voteType, pid);
        }
        break;
      case "VOTE_TEAM":
        this.castVote(pid, action.payload.vote);
        break;
      case "SEND_CHAT": {
        const message = action.payload.message.trim();
        if (message) {
          this.hooks.broadcast({
            type: "CHAT",
            payload: { sender: player.name, senderId: pid, message },
          });
        }
        break;
      }
      case "RESET_GAME":
        if (isLead) this.resetGame();
        else this.error(pid, MSG.errorLeadOnly);
        break;
      case "KICK_PLAYER":
        if (isLead) this.kick(pid, action.payload.id);
        else this.error(pid, MSG.errorLeadOnly);
        break;
    }

    this.publish();
  }

  private handleSubmitMove(pid: string, lan: string): void {
    const player = this.players.get(pid)!;

    if (this.status === GameStatus.Setup) {
      if (player.side !== "white")
        return this.error(pid, MSG.errorOnlyWhiteStart);
      if (this.team("black").length === 0) {
        return this.error(pid, MSG.errorBothTeamsRequired);
      }
      this.startNewGame();
    }

    if (this.status !== GameStatus.AwaitingProposals) {
      return this.error(pid, MSG.errorNotAccepting);
    }
    const turn = this.currentTurn()!;
    if (player.side !== turn.side) return this.error(pid, MSG.errorNotYourTurn);
    // One proposal per player per turn: the first one stands. Silently replacing it
    // would let a player watch their teammates' proposals land, then re-aim.
    if (turn.proposals.some((p) => p.id === pid)) {
      return this.error(pid, MSG.errorAlreadyMoved);
    }

    // Validated on a throwaway board: a rejected proposal must not touch the game.
    let san: string;
    try {
      san = new Chess(this.chess.fen()).move(moveFromLan(lan)).san;
    } catch {
      return this.error(pid, MSG.errorIllegalMove);
    }

    turn.proposals.push({ id: pid, name: player.name, lan, san });
    this.tryFinalizeTurn();
  }

  private kick(byPid: string, targetPid: string): void {
    if (targetPid === byPid) return this.error(byPid, MSG.errorCannotKickSelf);
    const target = this.players.get(targetPid);
    if (!target) return this.error(byPid, MSG.errorTargetNotFound);

    this.banned.add(targetPid);
    // Removed first: the transport may close the player's sockets on KICKED, and
    // the leave that follows must then find nothing left to do.
    this.removePlayer(targetPid);
    this.hooks.send(targetPid, { type: "KICKED", payload: null });
    this.systemChat(MSG.playerKicked(target.name));
  }

  // ─── Game flow ────────────────────────────────────────────────────────────

  private startNewGame(): void {
    this.chess = new Chess();
    this.turns = [{ side: "white", proposals: [] }];
    this.drawOffer = null;
    this.gameOver = null;
    this.whiteTime = DEFAULT_CLOCK_TIME;
    this.blackTime = DEFAULT_CLOCK_TIME;
    this.status = GameStatus.AwaitingProposals;
    this.startClock();
  }

  /** Back to Setup. The ban list survives: kicked players stay kicked across games. */
  private resetGame(): void {
    this.generation++;
    this.clearVote();
    this.pauseClock();
    this.clearForfeit();
    this.status = GameStatus.Setup;
    this.chess.reset();
    this.turns = [];
    this.drawOffer = null;
    this.gameOver = null;
    this.whiteTime = DEFAULT_CLOCK_TIME;
    this.blackTime = DEFAULT_CLOCK_TIME;
    // Fresh engine for a fresh game: a search still in flight belongs to the previous one.
    this.engine.quit();
    this.engine = this.createEngine();
    this.systemChat(MSG.gameReset);
  }

  private tryFinalizeTurn(): void {
    const turn = this.currentTurn();
    if (!turn) return;
    const active = new Set(this.team(turn.side).map((p) => p.id));
    const proposers = turn.proposals.map((p) => p.id);
    if (shouldFinalizeTurn(this.status, active, proposers)) {
      void this.finalizeTurn(turn);
    }
  }

  private async finalizeTurn(turn: Turn): Promise<void> {
    this.status = GameStatus.FinalizingTurn;
    this.pauseClock();

    const moves = turn.proposals.map((p) => p.lan);

    // A game end, reset or destroy during the search bumps `generation`: the
    // position this search was started on no longer exists — drop its answer.
    const generation = this.generation;
    const engineMove = await chooseBestMove(
      this.engine,
      this.chess.fen(),
      moves
    );
    if (this.generation !== generation) return;

    const selected = resolveSelectedMove(engineMove, moves);
    if (!selected) {
      // Nothing to play: hand the turn back instead of freezing on FinalizingTurn.
      this.status = GameStatus.AwaitingProposals;
      this.startClock();
      return this.publish();
    }

    if (selected.fallback) {
      console.warn(
        `Engine fallback: played ${selected.lan} at random among ${moves.length} proposals ` +
          `(engine answered ${engineMove ?? "nothing"})`
      );
      this.systemChat(MSG.engineFallback);
    }

    let played;
    try {
      played = this.chess.move(moveFromLan(selected.lan));
    } catch (err) {
      // Should be impossible (candidates were validated on this position), but a
      // throw here would otherwise leave the game frozen on FinalizingTurn.
      console.error(
        `CRITICAL: selected move rejected. Move: ${selected.lan}`,
        err
      );
      turn.proposals = [];
      this.status = GameStatus.AwaitingProposals;
      this.systemChat(MSG.systemError);
      this.startClock();
      return this.publish();
    }

    if (turn.side === "white")
      this.whiteTime += calculateIncrement(this.whiteTime);
    else this.blackTime += calculateIncrement(this.blackTime);
    turn.selection = { lan: selected.lan, san: played.san };

    const over = detectGameOver(this.chess, turn.side);
    if (over.isOver) {
      this.endGame(over.reason!, over.winner ?? null);
    } else {
      this.turns.push({ side: opposite(turn.side), proposals: [] });
      this.status = GameStatus.AwaitingProposals;
      this.startClock();
    }
    this.publish();
  }

  private endGame(reason: EndReason, winner: PlayerSide | null): void {
    if (this.status === GameStatus.Over) return;
    this.generation++;
    this.status = GameStatus.Over;
    this.pauseClock();
    this.clearVote();
    this.clearForfeit();
    this.gameOver = { reason, winner, pgn: getCleanPgn(this.chess) };
    this.systemChat(reasonMessages[reason](winner));
  }

  // ─── Clock ────────────────────────────────────────────────────────────────
  // Deadline-based, like the vote and the forfeit countdown: the server records when
  // the clock started and arms one timer for the flag; clients extrapolate the
  // display from `turnStartedAt` themselves. Pausing commits the elapsed time.

  private startClock(): void {
    this.pauseClock();
    const side = this.currentTurn()!.side;
    this.turnStartedAt = Date.now();
    this.flagTimer = setTimeout(
      () => {
        this.flagTimer = null;
        this.pauseClock();
        this.endGame(EndReason.Timeout, opposite(side));
        this.publish();
      },
      (side === "white" ? this.whiteTime : this.blackTime) * 1000
    );
  }

  private pauseClock(): void {
    if (this.flagTimer) {
      clearTimeout(this.flagTimer);
      this.flagTimer = null;
    }
    if (this.turnStartedAt === null) return;
    const elapsed = (Date.now() - this.turnStartedAt) / 1000;
    this.turnStartedAt = null;
    if (this.currentTurn()!.side === "white") {
      this.whiteTime = Math.max(0, this.whiteTime - elapsed);
    } else {
      this.blackTime = Math.max(0, this.blackTime - elapsed);
    }
  }

  // ─── Votes ────────────────────────────────────────────────────────────────
  // Unanimous, yes-only, 20 seconds. The electorate is frozen when the vote opens:
  // leaving afterwards neither shrinks the quorum nor counts as consent. A lone
  // player's vote is a vote too — it just passes on their own yes.

  private startVote(
    side: PlayerSide,
    type: VoteType,
    initiatorId: string | null
  ): void {
    if (this.vote) {
      if (initiatorId) this.error(initiatorId, MSG.errorVoteInProgress);
      return;
    }
    // A draw can only be accepted against a live offer from the other side, and
    // only offered once.
    if (type === "accept_draw" && this.drawOffer !== opposite(side)) return;
    if (type === "offer_draw" && this.drawOffer) return;

    const voters = this.team(side).map((p) => ({
      id: p.id,
      name: p.name,
      yes: p.id === initiatorId,
    }));
    this.vote = {
      type,
      side,
      voters,
      endTime: Date.now() + TEAM_VOTE_DURATION_MS,
      timer: setTimeout(() => {
        if (!this.vote) return;
        this.failVote();
        this.publish();
      }, TEAM_VOTE_DURATION_MS),
    };
    this.settleVote();
  }

  private castVote(voterId: string, choice: "yes" | "no"): void {
    const voter = this.vote?.voters.find((v) => v.id === voterId);
    if (!voter) return;
    if (choice === "no") return this.failVote();
    voter.yes = true;
    this.settleVote();
  }

  /** Passes the vote once it is unanimous. */
  private settleVote(): void {
    const vote = this.vote!;
    if (!vote.voters.every((v) => v.yes)) return;
    this.clearVote();

    if (vote.type === "resign") {
      this.endGame(EndReason.Resignation, opposite(vote.side));
    } else if (vote.type === "offer_draw") {
      this.drawOffer = vote.side;
      this.startVote(opposite(vote.side), "accept_draw", null);
    } else {
      this.endGame(EndReason.DrawAgreement, null);
    }
  }

  private failVote(): void {
    const vote = this.vote!;
    this.clearVote();
    this.systemChat(MSG.teamVoteFailed(vote.type));
    if (vote.type === "accept_draw") this.drawOffer = null;
  }

  private clearVote(): void {
    if (!this.vote) return;
    clearTimeout(this.vote.timer);
    this.vote = null;
  }

  // ─── Forfeit ──────────────────────────────────────────────────────────────

  /**
   * An abandoned team does not lose on the spot: it gets TEAM_EMPTY_FORFEIT_MS,
   * counted down in front of everyone, for the missing player to come back or for
   * anyone else to take the seat. Called after anything that can change who is
   * on a side; it arms or cancels the countdown accordingly.
   */
  private checkAutoForfeit(): void {
    const running =
      this.status === GameStatus.AwaitingProposals ||
      this.status === GameStatus.FinalizingTurn;
    if (!running || this.emptySides().length === 0) return this.clearForfeit();

    // A team emptying while another countdown runs shares its deadline: the clock
    // started when the game first lost a side, and that is the one that matters.
    if (this.forfeitTimer) return;
    this.forfeitEndTime = Date.now() + TEAM_EMPTY_FORFEIT_MS;
    this.forfeitTimer = setTimeout(() => {
      this.forfeitTimer = null;
      this.executeForfeit();
      this.publish();
    }, TEAM_EMPTY_FORFEIT_MS);
  }

  /** The countdown ran out. Recomputed from scratch: a side may have filled up since. */
  private executeForfeit(): void {
    const white = this.team("white").length;
    const black = this.team("black").length;
    if (white > 0 && black > 0) return this.clearForfeit();
    this.endGame(
      EndReason.Abandonment,
      white > 0 ? "white" : black > 0 ? "black" : null
    );
  }

  private clearForfeit(): void {
    if (this.forfeitTimer) clearTimeout(this.forfeitTimer);
    this.forfeitTimer = null;
    this.forfeitEndTime = 0;
  }

  private forfeitCountdown(): ForfeitCountdown | null {
    if (!this.forfeitTimer) return null;
    const empty = this.emptySides();
    return {
      side: empty.length === 2 ? null : empty[0],
      endTime: this.forfeitEndTime,
    };
  }

  // ─── Helpers ──────────────────────────────────────────────────────────────

  private currentTurn(): Turn | undefined {
    return this.turns[this.turns.length - 1];
  }

  private team(side: Side): Array<{ id: string; name: string }> {
    return [...this.players]
      .filter(([, p]) => p.side === side)
      .map(([id, p]) => ({ id, name: p.name }));
  }

  private emptySides(): PlayerSide[] {
    return (["white", "black"] as const).filter(
      (side) => this.team(side).length === 0
    );
  }

  /** Tells one player why their action was turned down. */
  private error(pid: string, message: string): void {
    this.hooks.send(pid, { type: "ERROR", payload: { message } });
  }

  private systemChat(message: string): void {
    this.hooks.broadcast({
      type: "CHAT",
      payload: {
        sender: SENDER_SYSTEM,
        senderId: "system",
        message,
        system: true,
      },
    });
  }

  private snapshot(): GameState {
    const state: GameState = {
      leadId: this.leadId(),
      players: [...this.players].map(([id, p]) => ({
        id,
        name: p.name,
        side: p.side,
      })),
      status: this.status,
      fen: this.chess.fen(),
      turns: this.turns,
      whiteTime: this.whiteTime,
      blackTime: this.blackTime,
      turnStartedAt: this.turnStartedAt,
      vote: this.vote && {
        type: this.vote.type,
        side: this.vote.side,
        voters: this.vote.voters,
        endTime: this.vote.endTime,
      },
      drawOffer: this.drawOffer,
      forfeit: this.forfeitCountdown(),
      gameOver: this.gameOver,
    };
    // A copy, so that what was published stays what was published once the
    // turns and voters above are mutated by the next action.
    return structuredClone(state);
  }

  private publish(): void {
    this.hooks.broadcast({ type: "STATE", payload: this.snapshot() });
  }
}

function opposite(side: PlayerSide): PlayerSide {
  return side === "white" ? "black" : "white";
}

/** "e7e8q" → the object form chess.js validates strictly. */
function moveFromLan(lan: string): {
  from: string;
  to: string;
  promotion?: string;
} {
  return {
    from: lan.slice(0, 2),
    to: lan.slice(2, 4),
    ...(lan.length === 5 ? { promotion: lan[4] } : {}),
  };
}
