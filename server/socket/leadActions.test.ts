import { describe, it, expect, afterEach, vi } from "vitest";
import type { Socket } from "socket.io";
import { GameStatus, EndReason } from "../shared_types.js";
import { MSG } from "../shared_messages.js";
import { TEAM_EMPTY_FORFEIT_MS } from "../constants.js";
import { TestGame, type FakeSocket } from "../testUtils.js";
import { getLeadId } from "../state.js";
import { broadcastPlayers } from "../utils/messaging.js";
import { leave } from "../players/playerManager.js";
import { handleKickPlayer, handleResetGame } from "./eventHandlers.js";

// executeGameReset builds a real engine; keep it from spawning a process in tests
vi.mock("../engine/stockfish.js", async (importOriginal) => {
  const mod = await importOriginal<typeof import("../engine/stockfish.js")>();
  return { ...mod, createEngine: () => ({ send: () => {}, quit: () => {} }) };
});

const asSocket = (s: FakeSocket): Socket => s as unknown as Socket;

const errorsOn = (s: FakeSocket): unknown[] =>
  s.emittedEvents.filter((e) => e.event === "error").map((e) => e.data);

let game: TestGame;

afterEach(() => {
  game?.cleanup();
});

describe("the lead", () => {
  it("is the first player to connect", () => {
    game = new TestGame();
    game.addPlayer("p1", "Alice", "white");
    game.addPlayer("p2", "Bob", "black");

    expect(getLeadId()).toBe("p1");
  });

  it("is null when nobody is around", () => {
    game = new TestGame();

    expect(getLeadId()).toBeNull();
  });

  it("ships with every player broadcast", () => {
    game = new TestGame();
    game.addPlayer("p1", "Alice", "white");
    game.addPlayer("p2", "Bob", "black");

    broadcastPlayers();

    const update = game.getLastEmittedData<{ leadId: string }>("players");
    expect(update?.leadId).toBe("p1");
  });

  it("hands the role over the moment the lead drops off, and takes it back on return", () => {
    // Mid-game, so the seat survives the disconnection and only presence moves
    game = new TestGame({ status: GameStatus.AwaitingProposals });
    const s1 = game.addPlayer("p1", "Alice", "white");
    game.addPlayer("p2", "Bob", "black");

    // A session now outlives a disconnection, so the crown follows presence
    // rather than mere existence — otherwise a player who quit would keep it
    // and nobody could kick or reset.
    game.disconnectSocket("p1");
    leave(asSocket(s1));

    expect(getLeadId()).toBe("p2");
    expect(game.getLastEmittedData<{ leadId: string }>("players")?.leadId).toBe(
      "p2"
    );

    game.reconnectSocket("p1");
    expect(getLeadId()).toBe("p1");
  });
});

describe("handleKickPlayer", () => {
  it("rejects a kick from a player who is not the lead", () => {
    game = new TestGame();
    game.addPlayer("p1", "Alice", "white");
    const s2 = game.addPlayer("p2", "Bob", "black");
    game.addPlayer("p3", "Charlie", "black");

    handleKickPlayer(asSocket(s2), "p3");

    expect(errorsOn(s2)).toEqual([{ message: MSG.errorLeadOnly }]);
    expect(game.sessions.has("p3")).toBe(true);
  });

  it("rejects a self-kick", () => {
    game = new TestGame();
    const s1 = game.addPlayer("p1", "Alice", "white");
    game.addPlayer("p2", "Bob", "black");

    handleKickPlayer(asSocket(s1), "p1");

    expect(errorsOn(s1)).toEqual([{ message: MSG.errorCannotKickSelf }]);
    expect(game.sessions.has("p1")).toBe(true);
  });

  it("rejects an unknown target", () => {
    game = new TestGame();
    const s1 = game.addPlayer("p1", "Alice", "white");

    handleKickPlayer(asSocket(s1), "ghost");

    expect(errorsOn(s1)).toEqual([{ message: MSG.errorTargetNotFound }]);
  });

  it("kicks immediately: blacklists, disconnects and announces the target", () => {
    game = new TestGame();
    const s1 = game.addPlayer("p1", "Alice", "white");
    game.addPlayer("p2", "Bob", "black");
    const target = game.addPlayer("p3", "Charlie", "black");

    handleKickPlayer(asSocket(s1), "p3");

    expect(game.gameState.blacklist.has("p3")).toBe(true);
    expect(game.sessions.has("p3")).toBe(false);
    expect(target.emittedEvents.some((e) => e.event === "kicked")).toBe(true);
    const chats = game.getEmittedData<{ message: string }>("chat_message");
    expect(chats.some((c) => c.message === MSG.playerKicked("Charlie"))).toBe(
      true
    );
  });

  it("counts the emptied team down when the kicked player was its last member", () => {
    vi.useFakeTimers();
    try {
      game = new TestGame({ status: GameStatus.AwaitingProposals });
      const s1 = game.addPlayer("p1", "Alice", "white");
      game.addPlayer("p2", "Bob", "white");
      game.addPlayer("p3", "Charlie", "black"); // last black player

      handleKickPlayer(asSocket(s1), "p3");

      // A kick is a decision, not a suspicion: the seat goes immediately...
      expect(game.sessions.has("p3")).toBe(false);
      // ...but the team it empties is owed the same chance as any other
      expect(game.gameState.status).toBe(GameStatus.AwaitingProposals);

      vi.advanceTimersByTime(TEAM_EMPTY_FORFEIT_MS);

      expect(game.gameState.status).toBe(GameStatus.Over);
      const over = game.getLastEmittedData<{ reason: string; winner: string }>(
        "game_over"
      );
      expect(over?.reason).toBe(EndReason.Abandonment);
      expect(over?.winner).toBe("white");
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("handleResetGame", () => {
  it("rejects a reset from a player who is not the lead", () => {
    game = new TestGame({ status: GameStatus.AwaitingProposals });
    game.addPlayer("p1", "Alice", "white");
    const s2 = game.addPlayer("p2", "Bob", "black");
    const cb = vi.fn();

    handleResetGame(asSocket(s2), cb);

    expect(cb).toHaveBeenCalledWith({ error: MSG.errorLeadOnly });
    expect(game.hasEmitted("game_reset")).toBe(false);
    expect(game.gameState.status).toBe(GameStatus.AwaitingProposals);
  });

  it("resets the game in place for the lead, keeping the blacklist", () => {
    game = new TestGame({ status: GameStatus.AwaitingProposals });
    const s1 = game.addPlayer("p1", "Alice", "white");
    game.addPlayer("p2", "Bob", "black");
    game.gameState.blacklist.add("banned-pid");
    const stateRef = game.gameState;
    const cb = vi.fn();

    handleResetGame(asSocket(s1), cb);

    expect(cb).toHaveBeenCalledWith({ success: true });
    expect(game.hasEmitted("game_reset")).toBe(true);
    expect(game.gameState).toBe(stateRef); // same object, mutated in place
    expect(game.gameState.status).toBe(GameStatus.Setup);
    expect(game.gameState.generation).toBe(1);
    expect(game.gameState.blacklist.has("banned-pid")).toBe(true);
  });
});
