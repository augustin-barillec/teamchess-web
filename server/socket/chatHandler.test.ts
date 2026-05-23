import { describe, it, expect } from "vitest";
import { Socket } from "socket.io";
import { handleChatMessage } from "./eventHandlers.js";
import { MockGameContext } from "../context/MockGameContext.js";

function fakeSocket(pid: string, name: string): Socket {
  return {
    data: { pid, name, side: "white" },
  } as unknown as Socket;
}

describe("handleChatMessage", () => {
  it("broadcasts a non-empty message via io.emit with sender + senderId + message", () => {
    const ctx = new MockGameContext();
    ctx.addPlayer("p1", "Alice", "white");
    const socket = fakeSocket("p1", "Alice");

    handleChatMessage(socket, "hello", ctx);

    const chats = ctx.getEmittedData<{
      sender: string;
      senderId: string;
      message: string;
    }>("chat_message");
    expect(chats).toHaveLength(1);
    expect(chats[0]).toEqual({
      sender: "Alice",
      senderId: "p1",
      message: "hello",
    });
  });

  it("trims the message before broadcasting", () => {
    const ctx = new MockGameContext();
    ctx.addPlayer("p1", "Alice", "white");
    const socket = fakeSocket("p1", "Alice");

    handleChatMessage(socket, "   hi there  ", ctx);

    const chats = ctx.getEmittedData<{ message: string }>("chat_message");
    expect(chats[0].message).toBe("hi there");
  });

  it("ignores an empty message", () => {
    const ctx = new MockGameContext();
    ctx.addPlayer("p1", "Alice", "white");
    const socket = fakeSocket("p1", "Alice");

    handleChatMessage(socket, "", ctx);

    expect(ctx.getEmittedData("chat_message")).toHaveLength(0);
  });

  it("ignores a whitespace-only message", () => {
    const ctx = new MockGameContext();
    ctx.addPlayer("p1", "Alice", "white");
    const socket = fakeSocket("p1", "Alice");

    handleChatMessage(socket, "   \t  \n ", ctx);

    expect(ctx.getEmittedData("chat_message")).toHaveLength(0);
  });

  it("uses the sender's name from socket.data, not from any payload field", () => {
    const ctx = new MockGameContext();
    ctx.addPlayer("p1", "Alice", "white");
    const socket = fakeSocket("p1", "Alice");

    handleChatMessage(socket, "hi", ctx);

    const chats = ctx.getEmittedData<{ sender: string; senderId: string }>(
      "chat_message"
    );
    expect(chats[0].sender).toBe("Alice");
    expect(chats[0].senderId).toBe("p1");
  });
});
