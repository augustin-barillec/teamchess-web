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
          {" "}
          {chatMessages
            .slice()
            .reverse()
            .map((msg, idx) => {
              if (msg.system) {
                return (
                  <div key={idx} className="chat-message-item system">
                    {" "}
                    {msg.message}{" "}
                  </div>
                );
              }
              return (
                <div
                  key={idx}
                  className={
                    "chat-message-item " +
                    (myId === msg.senderId ? "own" : "other")
                  }
                >
                  {" "}
                  {myId === msg.senderId ? (
                    <strong>{msg.sender}:</strong>
                  ) : (
                    <span>{msg.sender}:</span>
                  )}{" "}
                  {msg.message}{" "}
                </div>
              );
            })}{" "}
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
