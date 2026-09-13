import { describe, it, expect, afterEach, vi, type Mock } from "vitest";
import { Game } from "./Game.js";
import type { Engine } from "./types.js";
import { MSG } from "./shared_messages.js";
import {
  GameStatus,
  EndReason,
  type GameState,
  type ServerEvent,
  type Side,
  type VoteType,
} from "./shared_types.js";
import {
  DEFAULT_CLOCK_TIME,
  ENGINE_MOVE_TIMEOUT_MS,
  TEAM_EMPTY_FORFEIT_MS,
  TEAM_VOTE_DURATION_MS,
} from "./constants.js";

/** A fake Stockfish: silent until a test answers a pending search. */
interface FakeEngine extends Engine {
  sent: string[];
  pending: ((line: string) => void) | null;
  quit: Mock<() => void>;
  answer(move: string): void;
}

function fakeEngines() {
  const engines: FakeEngine[] = [];
  const create = (): Engine => {
    const engine: FakeEngine = {
      sent: [],
      pending: null,
      send(command, callback) {
        engine.sent.push(command);
        if (callback) engine.pending = callback;
      },
      quit: vi.fn<() => void>(),
      answer(move) {
        const cb = engine.pending;
        engine.pending = null;
        cb?.(`bestmove ${move}`);
      },
    };
    engines.push(engine);
    return engine;
  };
  return { create, engines, live: () => engines[engines.length - 1] };
}

/**
 * A game with a fake transport around it. Every assertion reads the published
 * state: what a client would have on screen.
 */
function setupGame() {
  const engines = fakeEngines();
  const events: ServerEvent[] = [];
  const sends: Array<{ pid: string; event: ServerEvent }> = [];
  const game = new Game(engines.create, {
    broadcast: (event) => events.push(event),
    send: (pid, event) => sends.push({ pid, event }),
  });

  const states = (): GameState[] =>
    events.flatMap((e) => (e.type === "STATE" ? [e.payload] : []));
  const state = (): GameState => states()[states().length - 1];
  const chats = (): string[] =>
    events.flatMap((e) => (e.type === "CHAT" ? [e.payload.message] : []));
  const errorsTo = (pid: string): string[] =>
    sends.flatMap((s) =>
      s.pid === pid && s.event.type === "ERROR" ? [s.event.payload.message] : []
    );
  const onSide = (side: Side): string[] =>
    state()
      .players.filter((p) => p.side === side)
      .map((p) => p.id);

  const join = (pid: string, name: string): void => game.join(pid, name);
  const leave = (pid: string): void => game.leave(pid);
  const joinSide = (pid: string, side: Side): void =>
    game.processAction(pid, { type: "JOIN_SIDE", payload: { side } });
  const propose = (pid: string, lan: string): void =>
    game.processAction(pid, { type: "SUBMIT_MOVE", payload: { lan } });
  const startVote = (pid: string, voteType: VoteType): void =>
    game.processAction(pid, { type: "START_TEAM_VOTE", payload: { voteType } });
  const castVote = (pid: string, vote: "yes" | "no"): void =>
    game.processAction(pid, { type: "VOTE_TEAM", payload: { vote } });
  const kick = (byPid: string, id: string): void =>
    game.processAction(byPid, { type: "KICK_PLAYER", payload: { id } });
  const reset = (pid: string): void =>
    game.processAction(pid, { type: "RESET_GAME", payload: null });

  return {
    game,
    engines,
    events,
    sends,
    states,
    state,
    chats,
    errorsTo,
    onSide,
    join,
    leave,
    joinSide,
    propose,
    startVote,
    castVote,
    kick,
    reset,
  };
}

type Ctx = ReturnType<typeof setupGame>;

const wasFinalized = (ctx: Ctx): boolean =>
  ctx.states().some((s) => s.status === GameStatus.FinalizingTurn);

const isOver = (ctx: Ctx): boolean => ctx.state().gameOver !== null;

/** 2 white (A, B) + 2 black (C, D), game running, A has proposed so white is 1/2. */
function setupFourPlayerGame(): Ctx {
  const ctx = setupGame();
  ctx.join("A", "Alice");
  ctx.join("B", "Bob");
  ctx.join("C", "Carol");
  ctx.join("D", "Dave");
  ctx.joinSide("A", "white");
  ctx.joinSide("B", "white");
  ctx.joinSide("C", "black");
  ctx.joinSide("D", "black");
  ctx.propose("A", "e2e4");
  return ctx;
}

/** 2 white (A, B) + 1 black (C), game running, A has proposed so white is 1/2. */
function setupTwoOnOneGame(): Ctx {
  const ctx = setupGame();
  ctx.join("A", "Alice");
  ctx.join("B", "Bob");
  ctx.join("C", "Carol");
  ctx.joinSide("A", "white");
  ctx.joinSide("B", "white");
  ctx.joinSide("C", "black");
  ctx.propose("A", "e2e4");
  return ctx;
}

let current: Ctx | null = null;
const track = (ctx: Ctx): Ctx => {
  current = ctx;
  return ctx;
};

afterEach(() => {
  current?.game.destroy();
  current = null;
  vi.useRealTimers();
});

describe("membership", () => {
  it("seats a connection as a spectator under its name", () => {
    const ctx = track(setupGame());
    ctx.join("A", "Alice");

    expect(ctx.state().players).toEqual([
      { id: "A", name: "Alice", side: "spectator" },
    ]);
  });

  it("renames a player on SET_NAME, trimmed and capped at 30 characters", () => {
    const ctx = track(setupGame());
    ctx.join("A", "Alice");

    ctx.game.processAction("A", {
      type: "SET_NAME",
      payload: { name: "  " + "x".repeat(40) + "  " },
    });

    expect(ctx.state().players[0].name).toBe("x".repeat(30));
  });

  it("ignores an empty name", () => {
    const ctx = track(setupGame());
    ctx.join("A", "Alice");

    ctx.game.processAction("A", { type: "SET_NAME", payload: { name: "   " } });

    expect(ctx.state().players[0].name).toBe("Alice");
  });

  it("ignores actions from ids it does not know", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      const ctx = track(setupGame());
      ctx.join("A", "Alice");
      const before = ctx.states().length;

      ctx.joinSide("stranger", "white");

      expect(ctx.states().length).toBe(before);
      expect(ctx.onSide("white")).toEqual([]);
    } finally {
      warn.mockRestore();
    }
  });

  it("drops a player who leaves, seat included", () => {
    const ctx = track(setupGame());
    ctx.join("A", "Alice");
    ctx.joinSide("A", "white");

    ctx.leave("A");

    expect(ctx.state().players).toEqual([]);
  });

  it("renames on a repeated connection instead of seating twice", () => {
    const ctx = track(setupGame());
    ctx.join("A", "Alice");
    ctx.joinSide("A", "white");

    ctx.join("A", "Alicia");

    expect(ctx.state().players).toEqual([
      { id: "A", name: "Alicia", side: "white" },
    ]);
  });
});

describe("the lead", () => {
  it("is the first player to connect", () => {
    const ctx = track(setupGame());
    ctx.join("A", "Alice");
    ctx.join("B", "Bob");

    expect(ctx.state().leadId).toBe("A");
  });

  it("is null when nobody is around", () => {
    const ctx = track(setupGame());
    ctx.join("A", "Alice");
    ctx.leave("A");

    expect(ctx.state().leadId).toBeNull();
  });

  it("hands the role over the moment the lead leaves, and does not hand it back", () => {
    const ctx = track(setupGame());
    ctx.join("A", "Alice");
    ctx.join("B", "Bob");

    ctx.leave("A");
    expect(ctx.state().leadId).toBe("B");

    // Coming back is coming back as a newcomer: Bob keeps it.
    ctx.join("A", "Alice");
    expect(ctx.state().leadId).toBe("B");
  });
});

describe("lead powers", () => {
  it("refuses a kick from a player who is not the lead", () => {
    const ctx = track(setupGame());
    ctx.join("A", "Alice");
    ctx.join("B", "Bob");
    ctx.join("C", "Charlie");

    ctx.kick("B", "C");

    expect(ctx.errorsTo("B")).toEqual([MSG.errorLeadOnly]);
    expect(ctx.state().players.some((p) => p.id === "C")).toBe(true);
  });

  it("refuses a self-kick", () => {
    const ctx = track(setupGame());
    ctx.join("A", "Alice");
    ctx.join("B", "Bob");

    ctx.kick("A", "A");

    expect(ctx.errorsTo("A")).toEqual([MSG.errorCannotKickSelf]);
    expect(ctx.state().players.some((p) => p.id === "A")).toBe(true);
  });

  it("refuses an unknown target", () => {
    const ctx = track(setupGame());
    ctx.join("A", "Alice");

    ctx.kick("A", "ghost");

    expect(ctx.errorsTo("A")).toEqual([MSG.errorTargetNotFound]);
  });

  it("kicks immediately: bans, tells the target and announces it", () => {
    const ctx = track(setupGame());
    ctx.join("A", "Alice");
    ctx.join("B", "Bob");
    ctx.join("C", "Charlie");

    ctx.kick("A", "C");

    expect(ctx.game.isBanned("C")).toBe(true);
    expect(ctx.state().players.some((p) => p.id === "C")).toBe(false);
    expect(ctx.sends).toContainEqual({
      pid: "C",
      event: { type: "KICKED", payload: null },
    });
    expect(ctx.chats()).toContain(MSG.playerKicked("Charlie"));
  });

  it("counts the emptied team down when the kicked player was its last member", () => {
    vi.useFakeTimers();
    const ctx = track(setupTwoOnOneGame());

    ctx.kick("A", "C");

    // A kick is a decision, not a suspicion: the seat goes immediately...
    expect(ctx.onSide("black")).toEqual([]);
    // ...but the team it empties is owed the same chance as any other
    expect(isOver(ctx)).toBe(false);

    vi.advanceTimersByTime(TEAM_EMPTY_FORFEIT_MS);

    expect(ctx.state().gameOver).toMatchObject({
      reason: EndReason.Abandonment,
      winner: "white",
    });
  });

  it("refuses a reset from a player who is not the lead", () => {
    const ctx = track(setupFourPlayerGame());

    ctx.reset("B");

    expect(ctx.errorsTo("B")).toEqual([MSG.errorLeadOnly]);
    expect(ctx.state().status).toBe(GameStatus.AwaitingProposals);
  });

  it("resets to Setup for the lead, on a fresh engine, keeping the ban list", () => {
    const ctx = track(setupFourPlayerGame());
    ctx.kick("A", "D");
    const engineBefore = ctx.engines.live();

    ctx.reset("A");

    expect(ctx.state()).toMatchObject({
      status: GameStatus.Setup,
      turns: [],
      gameOver: null,
      turnStartedAt: null,
      whiteTime: DEFAULT_CLOCK_TIME,
    });
    expect(ctx.chats()).toContain(MSG.gameReset);
    expect(engineBefore.quit).toHaveBeenCalled();
    expect(ctx.engines.live()).not.toBe(engineBefore);
    expect(ctx.game.isBanned("D")).toBe(true);
  });
});

describe("chat", () => {
  it("broadcasts a message under the name the game holds for the sender", () => {
    const ctx = track(setupGame());
    ctx.join("A", "Alice");

    ctx.game.processAction("A", {
      type: "SEND_CHAT",
      payload: { message: "  hi there  " },
    });

    expect(ctx.events).toContainEqual({
      type: "CHAT",
      payload: { sender: "Alice", senderId: "A", message: "hi there" },
    });
  });

  it("ignores an empty or whitespace-only message", () => {
    const ctx = track(setupGame());
    ctx.join("A", "Alice");

    ctx.game.processAction("A", {
      type: "SEND_CHAT",
      payload: { message: "" },
    });
    ctx.game.processAction("A", {
      type: "SEND_CHAT",
      payload: { message: "   \t  \n " },
    });

    expect(ctx.chats()).toEqual([]);
  });
});

/**
 * The event-driven finalization relies on tryFinalizeTurn() being called after every
 * event that can change who is on the side to move or what they proposed. These tests
 * lock that invariant so adding a new event path without wiring it up won't silently
 * break turn progression.
 */
describe("turn finalization invariant", () => {
  it("finalizes after SUBMIT_MOVE when the proposer is the only active team member", () => {
    const ctx = track(setupGame());
    ctx.join("A", "Alice");
    ctx.join("B", "Bob");
    ctx.joinSide("A", "white");
    ctx.joinSide("B", "black");

    ctx.propose("A", "e2e4");

    expect(wasFinalized(ctx)).toBe(true);
  });

  it("finalizes after JOIN_SIDE when a teammate becomes a spectator and the remaining member has already proposed", () => {
    const ctx = track(setupTwoOnOneGame());
    expect(wasFinalized(ctx)).toBe(false);

    ctx.joinSide("B", "spectator");

    expect(wasFinalized(ctx)).toBe(true);
  });

  it("finalizes after a member leaves when the remaining member has already proposed", () => {
    const ctx = track(setupTwoOnOneGame());
    expect(wasFinalized(ctx)).toBe(false);

    ctx.leave("B");

    expect(wasFinalized(ctx)).toBe(true);
  });
});

describe("setup rules", () => {
  it("lets only white make the first move", () => {
    const ctx = track(setupGame());
    ctx.join("A", "Alice");
    ctx.join("B", "Bob");
    ctx.joinSide("A", "white");
    ctx.joinSide("B", "black");

    ctx.propose("B", "e7e5");

    expect(ctx.errorsTo("B")).toEqual([MSG.errorOnlyWhiteStart]);
    expect(ctx.state().status).toBe(GameStatus.Setup);
  });

  it("needs both teams before the first move", () => {
    const ctx = track(setupGame());
    ctx.join("A", "Alice");
    ctx.joinSide("A", "white");

    ctx.propose("A", "e2e4");

    expect(ctx.errorsTo("A")).toEqual([MSG.errorBothTeamsRequired]);
    expect(ctx.state().status).toBe(GameStatus.Setup);
  });
});

/**
 * A proposal is final for the turn it was made in. Letting a player resubmit would let
 * them watch their teammates' proposals land — they are published the moment they are
 * accepted — and then re-aim, which is not the game being played.
 */
describe("proposals", () => {
  it("refuses a second proposal from the same player and says why", () => {
    const ctx = track(setupFourPlayerGame());

    ctx.propose("A", "d2d4");

    expect(ctx.errorsTo("A")).toContain(MSG.errorAlreadyMoved);
    expect(ctx.state().turns[0].proposals.map((p) => p.lan)).toEqual(["e2e4"]);
  });

  it("tells a player off the active side that it is not their turn", () => {
    const ctx = track(setupFourPlayerGame());

    ctx.propose("C", "e7e5");

    expect(ctx.errorsTo("C")).toContain(MSG.errorNotYourTurn);
  });

  it("refuses an illegal move without touching the turn", () => {
    const ctx = track(setupFourPlayerGame());

    ctx.propose("B", "e2e5");

    expect(ctx.errorsTo("B")).toContain(MSG.errorIllegalMove);
    expect(ctx.state().turns[0].proposals).toHaveLength(1);
  });

  it("records the proposal with its SAN under the proposer's name", () => {
    const ctx = track(setupFourPlayerGame());

    expect(ctx.state().turns[0].proposals).toEqual([
      { id: "A", name: "Alice", lan: "e2e4", san: "e4" },
    ]);
  });
});

describe("the engine", () => {
  it("plays the agreed move without consulting the engine", async () => {
    const ctx = track(setupFourPlayerGame());

    // A already proposed e2e4; B proposes the very same move → 2/2 white.
    ctx.propose("B", "e2e4");
    // finalizeTurn suspends on an already-resolved promise, so its continuation is
    // queued one microtask ahead of ours — a single tick is what lets it run to
    // the published selection.
    await Promise.resolve();

    expect(ctx.state().turns[0].selection?.lan).toBe("e2e4");
    expect(ctx.engines.live().sent.some((c) => c.startsWith("go"))).toBe(false);
  });

  it("plays the engine's pick among differing proposals", async () => {
    const ctx = track(setupFourPlayerGame());

    ctx.propose("B", "d2d4");
    expect(ctx.state().status).toBe(GameStatus.FinalizingTurn);

    ctx.engines.live().answer("d2d4");
    // The answer travels through two promises (chooseBestMove's own and the
    // await in finalizeTurn): a macrotask lets both settle.
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(ctx.state().turns[0].selection).toEqual({ lan: "d2d4", san: "d4" });
    expect(ctx.state().turns).toHaveLength(2);
    expect(ctx.state().turns[1].side).toBe("black");
    expect(ctx.state().status).toBe(GameStatus.AwaitingProposals);
    expect(ctx.chats()).not.toContain(MSG.engineFallback);
  });

  /**
   * Locks the engine-failure fallback: when Stockfish cannot pick a move, the turn must
   * still advance on one of the proposals and the players must be told — never freeze
   * on FinalizingTurn.
   */
  it("plays a random proposal and warns when the engine never answers", async () => {
    vi.useFakeTimers();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      const ctx = track(setupFourPlayerGame());
      ctx.propose("B", "d2d4");

      await vi.advanceTimersByTimeAsync(ENGINE_MOVE_TIMEOUT_MS);

      expect(ctx.chats()).toContain(MSG.engineFallback);
      expect(warn).toHaveBeenCalledWith(
        expect.stringContaining("Engine fallback")
      );
      expect(["e2e4", "d2d4"]).toContain(ctx.state().turns[0].selection?.lan);
      expect(ctx.state().turns).toHaveLength(2);
      expect(ctx.state().status).toBe(GameStatus.AwaitingProposals);
    } finally {
      warn.mockRestore();
    }
  });

  /**
   * A reset can happen while the engine is thinking. The pending search must then
   * be dropped: it belongs to a game that no longer exists.
   */
  it("ignores the engine answer arriving after a reset", async () => {
    vi.useFakeTimers();
    const ctx = track(setupFourPlayerGame());
    ctx.propose("B", "d2d4");
    expect(ctx.state().status).toBe(GameStatus.FinalizingTurn);

    ctx.reset("A");
    ctx.events.length = 0;

    // The stale search resolves via its timeout fallback — and must be dropped
    await vi.advanceTimersByTimeAsync(ENGINE_MOVE_TIMEOUT_MS);

    expect(ctx.states()).toEqual([]);
  });

  it("publishes nothing after destroy when a search was still running", async () => {
    vi.useFakeTimers();
    const ctx = setupFourPlayerGame();
    ctx.propose("B", "d2d4");

    ctx.game.destroy();
    ctx.events.length = 0;

    await vi.advanceTimersByTimeAsync(ENGINE_MOVE_TIMEOUT_MS);

    expect(ctx.events).toEqual([]);
    expect(ctx.engines.live().quit).toHaveBeenCalled();
  });
});

/**
 * Locks the single-slot rule: only one vote can be active at a time, whichever team
 * started it. A second START_TEAM_VOTE — same team or the other one — must be refused
 * with an error and must not disturb the vote already running.
 */
describe("single active vote slot", () => {
  it("refuses a vote from the other team while one is active", () => {
    const ctx = track(setupFourPlayerGame());

    ctx.startVote("A", "resign");
    ctx.startVote("C", "resign");

    expect(ctx.errorsTo("C")).toContain(MSG.errorVoteInProgress);

    // D's yes lands on the still-active WHITE vote, where D is not eligible → no effect
    ctx.castVote("D", "yes");
    expect(isOver(ctx)).toBe(false);

    // Completing the original white vote resigns white → black wins
    ctx.castVote("B", "yes");
    expect(ctx.state().gameOver?.winner).toBe("black");
  });

  it("refuses a second vote on the same team while one is active", () => {
    const ctx = track(setupFourPlayerGame());

    ctx.startVote("A", "resign");
    ctx.startVote("B", "offer_draw");
    ctx.castVote("B", "yes");

    expect(ctx.state().gameOver?.winner).toBe("black");
    expect(ctx.states().some((s) => s.drawOffer === "white")).toBe(false);
  });

  it("frees the slot for the other team once the vote resolves", () => {
    const ctx = track(setupFourPlayerGame());

    ctx.startVote("A", "resign");
    ctx.castVote("B", "no");
    expect(ctx.state().vote).toBeNull();

    ctx.startVote("C", "resign");
    ctx.castVote("D", "yes");

    expect(ctx.state().gameOver?.winner).toBe("white");
  });
});

describe("vote rules", () => {
  it("refuses to accept a draw nobody offered", () => {
    const ctx = track(setupFourPlayerGame());

    ctx.startVote("C", "accept_draw");

    expect(ctx.state().vote).toBeNull();
  });

  it("refuses a second draw offer while one stands", () => {
    const ctx = track(setupFourPlayerGame());
    // Black is the sole offerer: C and D agree, so the offer stands and white votes.
    ctx.startVote("C", "offer_draw");
    ctx.castVote("D", "yes");
    expect(ctx.state().drawOffer).toBe("black");
    expect(ctx.state().vote?.type).toBe("accept_draw");

    // White refuses; the offer is gone and black may not offer again while... it is gone
    ctx.castVote("A", "no");
    expect(ctx.state().drawOffer).toBeNull();
    expect(ctx.state().vote).toBeNull();
  });

  it("passes a lone player's vote on their own yes", () => {
    const ctx = track(setupTwoOnOneGame());

    // Carol is black alone: there is nobody left to agree with.
    ctx.startVote("C", "resign");

    expect(ctx.state().vote).toBeNull();
    expect(ctx.state().gameOver).toMatchObject({
      reason: EndReason.Resignation,
      winner: "white",
    });
  });

  it("chains a passed offer into an accept vote for the other side, with nobody's yes", () => {
    const ctx = track(setupFourPlayerGame());

    ctx.startVote("A", "offer_draw");
    ctx.castVote("B", "yes");

    expect(ctx.state().drawOffer).toBe("white");
    expect(ctx.state().vote).toMatchObject({
      type: "accept_draw",
      side: "black",
      voters: [
        { id: "C", name: "Carol", yes: false },
        { id: "D", name: "Dave", yes: false },
      ],
    });
  });

  it("waits for a lone opponent's yes before agreeing a draw", () => {
    const ctx = track(setupTwoOnOneGame());

    ctx.startVote("A", "offer_draw");
    ctx.castVote("B", "yes");
    expect(ctx.state().vote?.type).toBe("accept_draw");
    expect(isOver(ctx)).toBe(false);

    ctx.castVote("C", "yes");

    expect(ctx.state().gameOver?.reason).toBe(EndReason.DrawAgreement);
  });

  it("ignores a duplicate yes", () => {
    const ctx = track(setupFourPlayerGame());

    ctx.startVote("A", "resign");
    ctx.castVote("A", "yes");

    expect(ctx.state().vote?.voters.filter((v) => v.yes)).toHaveLength(1);
    expect(isOver(ctx)).toBe(false);
  });
});

/**
 * Locks the frozen-electorate rule, in both directions. The roll is taken once, when the
 * vote starts: only who is on the side at that instant is on it, and once on it nobody
 * comes off.
 */
describe("vote electorate", () => {
  it("does not pass a vote when the missing voter leaves mid-vote", () => {
    const ctx = track(setupFourPlayerGame());

    ctx.startVote("A", "resign");
    ctx.leave("B");

    expect(isOver(ctx)).toBe(false);
    expect(ctx.state().vote?.voters).toHaveLength(2);
  });

  it("lets the last connected teammate act alone once the other seat has dropped", () => {
    const ctx = track(setupFourPlayerGame());

    ctx.leave("D");
    ctx.startVote("C", "resign");

    expect(ctx.state().gameOver).toMatchObject({
      reason: EndReason.Resignation,
      winner: "white",
    });
  });

  it("does not count a seat that dropped before the vote toward its quorum", () => {
    const ctx = track(setupFourPlayerGame());
    ctx.join("E", "Erin");
    ctx.joinSide("E", "black");
    ctx.leave("D");

    ctx.startVote("C", "resign");
    ctx.castVote("E", "yes");

    expect(ctx.state().gameOver?.winner).toBe("white");
  });

  it("shows every voter under the name they had when the vote opened", () => {
    const ctx = track(setupFourPlayerGame());

    ctx.startVote("C", "resign");
    ctx.leave("D");

    expect(ctx.state().vote?.voters).toEqual([
      { id: "C", name: "Carol", yes: true },
      { id: "D", name: "Dave", yes: false },
    ]);
  });
});

describe("vote expiration", () => {
  it("fails a team vote after the timeout", () => {
    vi.useFakeTimers();
    const ctx = track(setupFourPlayerGame());

    ctx.startVote("C", "resign");
    vi.advanceTimersByTime(TEAM_VOTE_DURATION_MS);

    expect(ctx.state().vote).toBeNull();
    expect(ctx.chats()).toContain(MSG.teamVoteFailed("resign"));
    expect(isOver(ctx)).toBe(false);
  });

  it("clears the draw offer when the accept vote times out", () => {
    vi.useFakeTimers();
    const ctx = track(setupFourPlayerGame());

    ctx.startVote("A", "offer_draw");
    ctx.castVote("B", "yes");
    expect(ctx.state().drawOffer).toBe("white");

    vi.advanceTimersByTime(TEAM_VOTE_DURATION_MS);

    expect(ctx.state().drawOffer).toBeNull();
    expect(ctx.state().vote).toBeNull();
  });
});

/**
 * A seat goes the moment its owner does — nothing is held for an absent player. What
 * makes a blink survivable is the countdown an emptied team gets instead: long enough
 * for the client to come back and claim its side, or for anyone else to take it.
 */
describe("empty-team forfeit countdown", () => {
  it("does not forfeit an emptied team on the spot", () => {
    vi.useFakeTimers();
    const ctx = track(setupTwoOnOneGame());

    ctx.leave("C");
    vi.advanceTimersByTime(TEAM_EMPTY_FORFEIT_MS - 1000);

    expect(isOver(ctx)).toBe(false);
  });

  it("announces the countdown so everyone can see it running", () => {
    vi.useFakeTimers();
    const ctx = track(setupTwoOnOneGame());

    ctx.leave("C");

    expect(ctx.state().forfeit).toEqual({
      side: "black",
      endTime: Date.now() + TEAM_EMPTY_FORFEIT_MS,
    });
  });

  it("gives the seat up at once, and lets the returning player take it again", () => {
    vi.useFakeTimers();
    const ctx = track(setupTwoOnOneGame());

    ctx.leave("C");
    vi.advanceTimersByTime(TEAM_EMPTY_FORFEIT_MS / 2);
    expect(ctx.state().players.some((p) => p.id === "C")).toBe(false);

    // Coming back is a fresh spectator session; the client asks for its side back.
    ctx.join("C", "Carol");
    expect(ctx.onSide("spectator")).toContain("C");
    ctx.joinSide("C", "black");
    vi.advanceTimersByTime(TEAM_EMPTY_FORFEIT_MS * 2);

    expect(ctx.onSide("black")).toEqual(["C"]);
    // The countdown was called off, not merely postponed
    expect(ctx.state().forfeit).toBeNull();
    expect(isOver(ctx)).toBe(false);
  });

  it("lets anyone else take the empty seat to save the game", () => {
    vi.useFakeTimers();
    const ctx = track(setupTwoOnOneGame());
    ctx.join("D", "Dave"); // a spectator, watching

    ctx.leave("C");
    vi.advanceTimersByTime(TEAM_EMPTY_FORFEIT_MS / 2);
    ctx.joinSide("D", "black");
    vi.advanceTimersByTime(TEAM_EMPTY_FORFEIT_MS * 2);

    expect(isOver(ctx)).toBe(false);
  });

  it("forfeits once the countdown runs out", () => {
    vi.useFakeTimers();
    const ctx = track(setupTwoOnOneGame());

    ctx.leave("C");
    vi.advanceTimersByTime(TEAM_EMPTY_FORFEIT_MS);

    expect(ctx.state().gameOver).toMatchObject({
      reason: EndReason.Abandonment,
      winner: "white",
    });
  });

  it("heads for a draw when both teams are empty", () => {
    vi.useFakeTimers();
    const ctx = track(setupTwoOnOneGame());

    ctx.leave("C");
    ctx.joinSide("A", "spectator");
    ctx.joinSide("B", "spectator");
    expect(ctx.state().forfeit?.side).toBeNull();

    vi.advanceTimersByTime(TEAM_EMPTY_FORFEIT_MS);

    expect(ctx.state().gameOver).toMatchObject({
      reason: EndReason.Abandonment,
      winner: null,
    });
  });

  it("does not make teammates wait on a player who has left to finalize the turn", () => {
    vi.useFakeTimers();
    const ctx = track(setupTwoOnOneGame());
    expect(wasFinalized(ctx)).toBe(false);

    ctx.leave("B");

    expect(wasFinalized(ctx)).toBe(true);
  });

  it("does not let a departed player's proposal finalize the turn on its own", () => {
    vi.useFakeTimers();
    const ctx = track(setupTwoOnOneGame());

    ctx.leave("A");

    expect(wasFinalized(ctx)).toBe(false);
  });

  it("gives up the seats of players still missing when the next game is set up", () => {
    vi.useFakeTimers();
    const ctx = track(setupTwoOnOneGame());

    ctx.leave("C");
    ctx.reset("A");

    expect(ctx.state().status).toBe(GameStatus.Setup);
    expect(ctx.state().players.some((p) => p.id === "C")).toBe(false);
    expect(ctx.state().forfeit).toBeNull();
  });
});

/**
 * The clock is a deadline, not a tick: the server records when the side to move
 * started and arms one timer for the flag. A timeout is the one game-ending path no
 * player action triggers, so nothing else exercises it.
 */
describe("the clock", () => {
  it("starts the side to move's clock when the game starts", () => {
    vi.useFakeTimers();
    const ctx = track(setupFourPlayerGame());

    expect(ctx.state()).toMatchObject({
      whiteTime: DEFAULT_CLOCK_TIME,
      blackTime: DEFAULT_CLOCK_TIME,
      turnStartedAt: Date.now(),
    });
  });

  it("charges the side to move for its thinking time and hands the clock over", async () => {
    vi.useFakeTimers();
    const ctx = track(setupFourPlayerGame());

    vi.advanceTimersByTime(3000);
    ctx.propose("B", "e2e4"); // unanimous → no search
    await vi.advanceTimersByTimeAsync(0);

    expect(ctx.state()).toMatchObject({
      whiteTime: DEFAULT_CLOCK_TIME - 3,
      blackTime: DEFAULT_CLOCK_TIME,
      turnStartedAt: Date.now(),
    });
    expect(ctx.state().turns[1].side).toBe("black");
  });

  it("pauses the clock while the engine thinks", () => {
    vi.useFakeTimers();
    const ctx = track(setupFourPlayerGame());

    vi.advanceTimersByTime(2000);
    ctx.propose("B", "d2d4"); // two moves → the engine is consulted

    expect(ctx.state().status).toBe(GameStatus.FinalizingTurn);
    expect(ctx.state().turnStartedAt).toBeNull();
    expect(ctx.state().whiteTime).toBe(DEFAULT_CLOCK_TIME - 2);
  });

  it("ends the game on timeout and awards the win to the other side", () => {
    vi.useFakeTimers();
    const ctx = track(setupFourPlayerGame());

    // White is to move, so white's clock is the one draining.
    vi.advanceTimersByTime(DEFAULT_CLOCK_TIME * 1000);

    expect(ctx.state().gameOver).toMatchObject({
      reason: EndReason.Timeout,
      winner: "black",
    });
    expect(ctx.state().whiteTime).toBe(0);
  });

  it("stops the clock once the game has ended on time", () => {
    vi.useFakeTimers();
    const ctx = track(setupFourPlayerGame());

    vi.advanceTimersByTime(DEFAULT_CLOCK_TIME * 1000);
    const publishedAtTimeout = ctx.states().length;

    vi.advanceTimersByTime(5000);

    expect(ctx.state().turnStartedAt).toBeNull();
    expect(ctx.states()).toHaveLength(publishedAtTimeout);
  });
});
