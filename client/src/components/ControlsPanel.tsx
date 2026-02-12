import { useState, useEffect } from "react";
import { GameStatus, TeamVoteState, ResetVoteState, VoteType } from "../types";
import { UI } from "../messages";

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
  effectiveTheme: "light" | "dark";
  toggleTheme: () => void;
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
  effectiveTheme,
  toggleTheme,
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
      resign: UI.voteTypeResign,
      offer_draw: UI.voteTypeOfferDraw,
      accept_draw: UI.voteTypeAcceptDraw,
    };

    return (
      <div className="poll-container" style={{ marginBottom: "10px" }}>
        <div
          style={{
            background: "var(--color-vote-bg)",
            padding: "10px",
            borderRadius: "6px",
            border: "1px solid var(--color-vote-border)",
          }}
        >
          <div style={{ fontWeight: "bold", marginBottom: "5px" }}>
            🗳️ Vote: {titleMap[teamVote.type]}
          </div>
          <div
            style={{
              fontSize: "0.85em",
              color: "var(--color-text-tertiary)",
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
                background: "var(--color-vote-yes-bg)",
                borderColor: "var(--color-vote-yes-border)",
                color: "var(--color-vote-yes-text)",
                fontWeight: "bold",
              }}
            >
              Yes ({teamVote.yesVotes.length})
            </button>
            <button
              onClick={() => onSendTeamVote("no")}
              style={{
                flex: 1,
                background: "var(--color-vote-no-bg)",
                borderColor: "var(--color-vote-no-border)",
                color: "var(--color-vote-no-text)",
                fontWeight: "bold",
              }}
            >
              No
            </button>
          </div>
          <div
            style={{
              fontSize: "0.8em",
              marginTop: "8px",
              color: "var(--color-text-secondary)",
            }}
          >
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
            background: "var(--color-vote-bg)",
            padding: "10px",
            borderRadius: "6px",
            border: "1px solid var(--color-vote-border)",
          }}
        >
          <div style={{ fontWeight: "bold", marginBottom: "5px" }}>
            {UI.voteResetGame}
          </div>
          <div
            style={{
              fontSize: "0.85em",
              color: "var(--color-text-tertiary)",
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
                background: "var(--color-vote-yes-bg)",
                borderColor: "var(--color-vote-yes-border)",
                color: "var(--color-vote-yes-text)",
                fontWeight: "bold",
              }}
            >
              Yes ({resetVote.yesVotes.length})
            </button>
            <button
              onClick={() => onSendResetVote("no")}
              style={{
                flex: 1,
                background: "var(--color-vote-no-bg)",
                borderColor: "var(--color-vote-no-border)",
                color: "var(--color-vote-no-text)",
                fontWeight: "bold",
              }}
            >
              No
            </button>
          </div>
          <div
            style={{
              fontSize: "0.8em",
              marginTop: "8px",
              color: "var(--color-text-secondary)",
            }}
          >
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
          <button onClick={resetGame}>{UI.btnResetGame}</button>
        ))}

      {/* 1. Join/Switch Buttons (Always Visible) */}
      {gameStatus !== GameStatus.Over && (
        <>
          {side === "spectator" && (
            <>
              <button onClick={autoAssign}>{UI.btnAutoAssign}</button>
              <button onClick={() => joinSide("white")}>
                {UI.btnJoinWhite}
              </button>
              <button onClick={() => joinSide("black")}>
                {UI.btnJoinBlack}
              </button>
            </>
          )}
          {(side === "white" || side === "black") && (
            <>
              <button onClick={joinSpectator}>{UI.btnJoinSpectators}</button>
              {gameStatus === GameStatus.Lobby && (
                <button
                  onClick={() => joinSide(side === "white" ? "black" : "white")}
                >
                  {UI.btnSwitchTo(side === "white" ? "Black" : "White")}
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
                        {UI.btnDrawOffered}
                      </button>
                    ) : drawOffer && drawOffer !== side ? (
                      <span style={{ fontStyle: "italic", fontSize: "0.9em" }}>
                        {UI.votingOnDraw}
                      </span>
                    ) : (
                      <>
                        <button onClick={() => onStartTeamVote("resign")}>
                          {UI.btnResign}
                        </button>
                        <button onClick={() => onStartTeamVote("offer_draw")}>
                          {UI.btnOfferDraw}
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
        <button onClick={copyPgn}>{UI.btnCopyPgn}</button>
      )}

      <button onClick={toggleMute}>
        {isMuted ? UI.btnUnmuteSounds : UI.btnMuteSounds}
      </button>

      <button onClick={toggleTheme}>
        {effectiveTheme === "dark" ? UI.btnLightMode : UI.btnDarkMode}
      </button>
    </>
  );
};
