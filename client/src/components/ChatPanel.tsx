import { RefObject } from "react";
import { ChatMessage } from "../types";
import { UI } from "../messages";
import { colorForPlayer } from "../playerColors";

interface ChatPanelProps {
  chatMessages: ChatMessage[];
  myId: string;
  chatInput: string;
  setChatInput: (value: string) => void;
  chatInputRef: RefObject<HTMLInputElement | null>;
  onSend: (message: string) => void;
}

export const ChatPanel: React.FC<ChatPanelProps> = ({
  chatMessages,
  myId,
  chatInput,
  setChatInput,
  chatInputRef,
  onSend,
}) => {
  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      e.preventDefault();
      const message = chatInput.trim();
      if (message) {
        onSend(message);
        setChatInput("");
      }
    }
  };

  return (
    <div className="tab-panel chat-panel">
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
                      style={{ color: colorForPlayer(msg.senderId) }}
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
          {/* Enter is handled on the input (onKeyDown); this only stops the
              browser's implicit submit from navigating away. */}
          <form onSubmit={(e) => e.preventDefault()}>
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
