import { useState, useEffect } from "react";
import { GameStatus, TeamVoteState, ResetVoteState, VoteType } from "../types";

interface ControlsPanelProps {
  gameStatus: GameStatus;
  side: "white" | "black" | "spectator";
  drawOffer: "white" | "black" | null;
  pgn: string;
  isMuted: boolean;
  toggleMute: () => void;
  resetGame: () => void;
  autoAssign: () => void;
  joinSide: (side: "white" | "black" | "spectator") => void;
  joinSpectator: () => void;
  copyPgn: () => void;
  teamVote: TeamVoteState;
  onStartTeamVote: (type: VoteType) => void;
  onSendTeamVote: (vote: "yes" | "no") => void;
  resetVote: ResetVoteState;
  onSendResetVote: (vote: "yes" | "no") => void;
}

export const ControlsPanel: React.FC<ControlsPanelProps> = ({
  gameStatus,
  side,
  drawOffer,
  pgn,
  isMuted,
  toggleMute,
  resetGame,
  autoAssign,
  joinSide,
  joinSpectator,
  copyPgn,
  teamVote,
  onStartTeamVote,
  onSendTeamVote,
  resetVote,
  onSendResetVote,
}) => {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (!teamVote.isActive && !resetVote.isActive) return;
    const interval = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(interval);
  }, [teamVote.isActive, resetVote.isActive]);

  const voteTimeLeft = Math.max(0, Math.ceil((teamVote.endTime - now) / 1000));

  const renderVoteUI = () => {
    if (!teamVote.isActive || !teamVote.type) return null;

    const titleMap = {
      resign: "Resign",
      offer_draw: "Offer Draw",
      accept_draw: "Accept Draw",
    };

    return (
      <div className="poll-container" style={{ marginBottom: "10px" }}>
        <div
          style={{
            background: "#ebf8ff",
            padding: "10px",
            borderRadius: "6px",
            border: "1px solid #bee3f8",
          }}
        >
          <div style={{ fontWeight: "bold", marginBottom: "5px" }}>
            🗳️ Vote: {titleMap[teamVote.type]}
          </div>
          <div
            style={{
              fontSize: "0.85em",
              color: "#666",
              marginBottom: "10px",
              fontStyle: "italic",
            }}
          >
            Time left: {voteTimeLeft}s • Required: {teamVote.requiredVotes}
          </div>

          <div style={{ display: "flex", gap: "10px" }}>
            <button
              onClick={() => onSendTeamVote("yes")}
              style={{
                flex: 1,
                background: "#e6fffa",
                borderColor: "#38b2ac",
                color: "#234e52",
                fontWeight: "bold",
              }}
            >
              Yes ({teamVote.yesVotes.length})
            </button>
            <button
              onClick={() => onSendTeamVote("no")}
              style={{
                flex: 1,
                background: "#fff5f5",
                borderColor: "#fc8181",
                color: "#742a2a",
                fontWeight: "bold",
              }}
            >
              No
            </button>
          </div>
          <div style={{ fontSize: "0.8em", marginTop: "8px", color: "#555" }}>
            Voters: {teamVote.yesVotes.join(", ")}
          </div>
        </div>
      </div>
    );
  };

  const renderResetVoteUI = () => {
    if (!resetVote.isActive) return null;

    const resetVoteTimeLeft = Math.max(
      0,
      Math.ceil((resetVote.endTime - now) / 1000)
    );

    return (
      <div className="poll-container" style={{ marginBottom: "10px" }}>
        <div
          style={{
            background: "#ebf8ff",
            padding: "10px",
            borderRadius: "6px",
            border: "1px solid #bee3f8",
          }}
        >
          <div style={{ fontWeight: "bold", marginBottom: "5px" }}>
            🗳️ Vote: Reset Game
          </div>
          <div
            style={{
              fontSize: "0.85em",
              color: "#666",
              marginBottom: "10px",
              fontStyle: "italic",
            }}
          >
            Time left: {resetVoteTimeLeft}s • Required:{" "}
            {resetVote.requiredVotes}
          </div>

          <div style={{ display: "flex", gap: "10px" }}>
            <button
              onClick={() => onSendResetVote("yes")}
              style={{
                flex: 1,
                background: "#e6fffa",
                borderColor: "#38b2ac",
                color: "#234e52",
                fontWeight: "bold",
              }}
            >
              Yes ({resetVote.yesVotes.length})
            </button>
            <button
              onClick={() => onSendResetVote("no")}
              style={{
                flex: 1,
                background: "#fff5f5",
                borderColor: "#fc8181",
                color: "#742a2a",
                fontWeight: "bold",
              }}
            >
              No
            </button>
          </div>
          <div style={{ fontSize: "0.8em", marginTop: "8px", color: "#555" }}>
            Voters: {resetVote.yesVotes.join(", ")}
          </div>
        </div>
      </div>
    );
  };

  return (
    <>
      {gameStatus !== GameStatus.Lobby &&
        (resetVote.isActive ? (
          renderResetVoteUI()
        ) : (
          <button onClick={resetGame}>🔄 Reset Game</button>
        ))}

      {/* 1. Join/Switch Buttons (Always Visible) */}
      {gameStatus !== GameStatus.Over && (
        <>
          {side === "spectator" && (
            <>
              <button onClick={autoAssign}>🎲 Auto Assign</button>
              <button onClick={() => joinSide("white")}>♔ Join White</button>
              <button onClick={() => joinSide("black")}>♚ Join Black</button>
            </>
          )}
          {(side === "white" || side === "black") && (
            <>
              <button onClick={joinSpectator}>👁️ Join Spectators</button>
              {gameStatus === GameStatus.Lobby && (
                <button
                  onClick={() => joinSide(side === "white" ? "black" : "white")}
                >
                  🔁 Switch to {side === "white" ? "Black" : "White"}
                </button>
              )}
            </>
          )}
        </>
      )}

      {/* 2. Action Area: Vote Box OR Action Buttons */}
      {gameStatus !== GameStatus.Over && (
        <>
          {/* If Vote is active, show Vote Box */}
          {teamVote.isActive && renderVoteUI()}

          {/* If Vote NOT active, show Resign/Draw Buttons */}
          {!teamVote.isActive &&
            gameStatus === GameStatus.AwaitingProposals && (
              <>
                {(side === "white" || side === "black") && (
                  <>
                    {drawOffer === side ? (
                      <button
                        disabled
                        style={{ opacity: 0.6, cursor: "default" }}
                      >
                        ⏳ Draw Offered...
                      </button>
                    ) : drawOffer && drawOffer !== side ? (
                      <span style={{ fontStyle: "italic", fontSize: "0.9em" }}>
                        Voting on Draw...
                      </span>
                    ) : (
                      <>
                        <button onClick={() => onStartTeamVote("resign")}>
                          🏳️ Resign
                        </button>
                        <button onClick={() => onStartTeamVote("offer_draw")}>
                          🤝 Offer Draw
                        </button>
                      </>
                    )}
                  </>
                )}
              </>
            )}
        </>
      )}

      {gameStatus === GameStatus.Over && pgn && (
        <button onClick={copyPgn}>📋 Copy PGN</button>
      )}

      <button onClick={toggleMute}>
        {isMuted ? "🔊 Unmute Sounds" : "🔇 Mute Sounds"}
      </button>
    </>
  );
};
