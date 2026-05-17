import { RefObject } from "react";
import { Socket } from "socket.io-client";
import { ChatMessage } from "../types";
import { UI } from "../messages";

interface ChatPanelProps {
  activeTab: string;
  chatMessages: ChatMessage[];
  myId: string;
  chatInput: string;
  setChatInput: (value: string) => void;
  chatInputRef: RefObject<HTMLInputElement | null>;
  socket: Socket | null;
}

// Distinct, theme-readable colours; a sender always maps to the same one.
const SENDER_COLORS = [
  "var(--color-chat-name-1)",
  "var(--color-chat-name-2)",
  "var(--color-chat-name-3)",
  "var(--color-chat-name-4)",
  "var(--color-chat-name-5)",
  "var(--color-chat-name-6)",
  "var(--color-chat-name-7)",
  "var(--color-chat-name-8)",
];

// Hash the stable senderId (not the display name) so the same person always
// gets the same colour and near-identical/empty names don't collide.
const colorForSender = (senderId: string): string => {
  let hash = 0;
  for (let i = 0; i < senderId.length; i++) {
    hash = (hash * 31 + senderId.charCodeAt(i)) | 0;
  }
  return SENDER_COLORS[Math.abs(hash) % SENDER_COLORS.length];
};

export const ChatPanel: React.FC<ChatPanelProps> = ({
  activeTab,
  chatMessages,
  myId,
  chatInput,
  setChatInput,
  chatInputRef,
  socket,
}) => {
  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const message = chatInput.trim();
    if (message) {
      socket?.emit("chat_message", message);
      setChatInput("");
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      e.preventDefault();
      const message = chatInput.trim();
      if (message) {
        socket?.emit("chat_message", message);
        setChatInput("");
      }
    }
  };

  return (
    <div
      className={
        "tab-panel chat-panel " + (activeTab === "chat" ? "active" : "")
      }
    >
      <h3>{UI.headingChat}</h3>
      <div className="chat-box-container">
        <div className="chat-messages">
          {chatMessages
            // Compute on chronological order: the display is reversed
            // (column-reverse + reversed array), so the "previous" message
            // must be the real chronological neighbour.
            .map((msg, idx) => {
              const prev = chatMessages[idx - 1];
              const showName =
                !msg.system &&
                myId !== msg.senderId &&
                (!prev || !!prev.system || prev.senderId !== msg.senderId);
              return { msg, idx, showName };
            })
            .reverse()
            .map(({ msg, idx, showName }) => {
              if (msg.system) {
                return (
                  <div key={idx} className="chat-message-item system">
                    {msg.message}
                  </div>
                );
              }
              const isOwn = myId === msg.senderId;
              return (
                <div
                  key={idx}
                  className={"chat-message-item " + (isOwn ? "own" : "other")}
                >
                  {showName && (
                    <span
                      className="chat-sender"
                      style={{ color: colorForSender(msg.senderId) }}
                    >
                      {msg.sender}
                    </span>
                  )}
                  {msg.message}
                </div>
              );
            })}
        </div>
        <div className="chat-form">
          <form onSubmit={handleSubmit}>
            <input
              ref={chatInputRef}
              type="text"
              name="chatInput"
              autoComplete="off"
              autoCorrect="off"
              autoCapitalize="off"
              spellCheck="false"
              placeholder={UI.chatPlaceholder}
              value={chatInput}
              onChange={(e) => setChatInput(e.target.value)}
              onKeyDown={handleKeyDown}
            />
          </form>
        </div>
      </div>
    </div>
  );
};
