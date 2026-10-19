import { describe, it, expect } from "vitest";
import { parseClientAction } from "./clientAction.js";
import {
  MAX_CHAT_MESSAGE_LENGTH,
  MAX_PLAYER_NAME_LENGTH,
} from "../constants.js";

describe("parseClientAction", () => {
  it("passes every well-formed action through unchanged", () => {
    const actions = [
      { type: "SET_NAME", payload: { name: "Alice" } },
      { type: "JOIN_SIDE", payload: { side: "white" } },
      { type: "SUBMIT_MOVE", payload: { lan: "e2e4" } },
      { type: "SUBMIT_MOVE", payload: { lan: "a7a8q" } },
      { type: "START_TEAM_VOTE", payload: { voteType: "offer_draw" } },
      { type: "VOTE_TEAM", payload: { vote: "no" } },
      { type: "SEND_CHAT", payload: { message: "gg" } },
      { type: "RESET_GAME", payload: null },
      { type: "KICK_PLAYER", payload: { id: "V1StGXR8_Z5jdHi6B-myT" } },
    ];
    for (const action of actions)
      expect(parseClientAction(action)).toEqual(action);
  });

  it("rejects what is not an action at all", () => {
    const junk = [
      null,
      undefined,
      42,
      "SET_NAME",
      [],
      {},
      { type: "SET_NAME" },
      { type: "SET_NAME", payload: null },
      { type: "SET_NAME", payload: "Alice" },
      { type: "FORMAT_DISK", payload: {} },
    ];
    for (const raw of junk) expect(parseClientAction(raw)).toBeNull();
  });

  it("rejects a payload field of the wrong type", () => {
    // A message that is not a string would make the server's trim() throw inside
    // a socket handler, and that takes the whole server down with it.
    expect(
      parseClientAction({ type: "SEND_CHAT", payload: { message: 42 } })
    ).toBeNull();
    expect(
      parseClientAction({ type: "SEND_CHAT", payload: { message: ["x"] } })
    ).toBeNull();
    expect(
      parseClientAction({ type: "SET_NAME", payload: { name: { evil: true } } })
    ).toBeNull();
    expect(
      parseClientAction({ type: "KICK_PLAYER", payload: { id: 123 } })
    ).toBeNull();
  });

  it("rejects values outside the declared enums", () => {
    // An undeclared vote type would land in settleVote's catch-all branch, which
    // is "draw agreed" — a draw forced without the other side's say.
    expect(
      parseClientAction({
        type: "START_TEAM_VOTE",
        payload: { voteType: "end_it_all" },
      })
    ).toBeNull();
    expect(
      parseClientAction({ type: "START_TEAM_VOTE", payload: { voteType: 3 } })
    ).toBeNull();
    expect(
      parseClientAction({ type: "VOTE_TEAM", payload: { vote: "maybe" } })
    ).toBeNull();
    expect(
      parseClientAction({ type: "JOIN_SIDE", payload: { side: "red" } })
    ).toBeNull();
  });

  it("rejects empty and oversized text", () => {
    const setName = (name: string) =>
      parseClientAction({ type: "SET_NAME", payload: { name } });
    expect(setName("")).toBeNull();
    expect(setName("x".repeat(MAX_PLAYER_NAME_LENGTH))).not.toBeNull();
    expect(setName("x".repeat(MAX_PLAYER_NAME_LENGTH + 1))).toBeNull();

    const chat = (message: string) =>
      parseClientAction({ type: "SEND_CHAT", payload: { message } });
    expect(chat("")).toBeNull();
    expect(chat("x".repeat(MAX_CHAT_MESSAGE_LENGTH))).not.toBeNull();
    expect(chat("x".repeat(MAX_CHAT_MESSAGE_LENGTH + 1))).toBeNull();
  });

  it("only lets a move through in plain long algebraic notation", () => {
    const rejected = [
      "e2e4\nsetoption name Hash value 8192",
      "e2e4 ",
      "E2E4",
      "e2e4k",
      "e2",
      "Nf3",
      "",
    ];
    for (const lan of rejected) {
      expect(
        parseClientAction({ type: "SUBMIT_MOVE", payload: { lan } })
      ).toBeNull();
    }
  });

  it("drops fields the protocol does not declare", () => {
    const raw = {
      type: "SEND_CHAT",
      payload: { message: "hi", admin: true },
      extra: 1,
    };
    expect(parseClientAction(raw)).toEqual({
      type: "SEND_CHAT",
      payload: { message: "hi" },
    });
  });
});
