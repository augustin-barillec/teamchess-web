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
            {teamVote.yesVotes.length}/{teamVote.requiredVotes} • {voteTimeLeft}
            s
          </div>

          <div style={{ display: "flex", gap: "10px" }}>
            <button
              onClick={() => onSendTeamVote("yes")}
              disabled={!teamVote.myVoteEligible}
              style={{
                flex: 1,
                background: teamVote.myVoteEligible
                  ? "var(--color-vote-yes-bg)"
                  : "var(--color-vote-disabled-bg)",
                borderColor: teamVote.myVoteEligible
                  ? "var(--color-vote-yes-border)"
                  : "var(--color-vote-disabled-border)",
                color: teamVote.myVoteEligible
                  ? "var(--color-vote-yes-text)"
                  : "var(--color-vote-disabled-text)",
                fontWeight: "bold",
                cursor: teamVote.myVoteEligible ? "pointer" : "default",
                opacity: teamVote.myVoteEligible ? 1 : 0.6,
              }}
            >
              Yes ({teamVote.yesVotes.length})
            </button>
            <button
              onClick={() => onSendTeamVote("no")}
              disabled={!teamVote.myVoteEligible}
              style={{
                flex: 1,
                background: teamVote.myVoteEligible
                  ? "var(--color-vote-no-bg)"
                  : "var(--color-vote-disabled-bg)",
                borderColor: teamVote.myVoteEligible
                  ? "var(--color-vote-no-border)"
                  : "var(--color-vote-disabled-border)",
                color: teamVote.myVoteEligible
                  ? "var(--color-vote-no-text)"
                  : "var(--color-vote-disabled-text)",
                fontWeight: "bold",
                cursor: teamVote.myVoteEligible ? "pointer" : "default",
                opacity: teamVote.myVoteEligible ? 1 : 0.6,
              }}
            >
              No
            </button>
          </div>
          {teamVote.yesVotes.length > 0 && (
            <div
              style={{
                fontSize: "0.8em",
                marginTop: "6px",
                color: "var(--color-vote-yes-label)",
              }}
            >
              Yes: {teamVote.yesVotes.join(", ")}
            </div>
          )}
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
            {resetVote.yesVotes.length}/{resetVote.requiredVotes} •{" "}
            {resetVoteTimeLeft}s
          </div>

          <div style={{ display: "flex", gap: "10px" }}>
            <button
              onClick={() => onSendResetVote("yes")}
              disabled={!resetVote.myVoteEligible}
              style={{
                flex: 1,
                background: resetVote.myVoteEligible
                  ? "var(--color-vote-yes-bg)"
                  : "var(--color-vote-disabled-bg)",
                borderColor: resetVote.myVoteEligible
                  ? "var(--color-vote-yes-border)"
                  : "var(--color-vote-disabled-border)",
                color: resetVote.myVoteEligible
                  ? "var(--color-vote-yes-text)"
                  : "var(--color-vote-disabled-text)",
                fontWeight: "bold",
                cursor: resetVote.myVoteEligible ? "pointer" : "default",
                opacity: resetVote.myVoteEligible ? 1 : 0.6,
              }}
            >
              Yes ({resetVote.yesVotes.length})
            </button>
            <button
              onClick={() => onSendResetVote("no")}
              disabled={!resetVote.myVoteEligible}
              style={{
                flex: 1,
                background: resetVote.myVoteEligible
                  ? "var(--color-vote-no-bg)"
                  : "var(--color-vote-disabled-bg)",
                borderColor: resetVote.myVoteEligible
                  ? "var(--color-vote-no-border)"
                  : "var(--color-vote-disabled-border)",
                color: resetVote.myVoteEligible
                  ? "var(--color-vote-no-text)"
                  : "var(--color-vote-disabled-text)",
                fontWeight: "bold",
                cursor: resetVote.myVoteEligible ? "pointer" : "default",
                opacity: resetVote.myVoteEligible ? 1 : 0.6,
              }}
            >
              No ({resetVote.noVotes.length})
            </button>
          </div>
          {resetVote.yesVotes.length > 0 && (
            <div
              style={{
                fontSize: "0.8em",
                marginTop: "6px",
                color: "var(--color-vote-yes-label)",
              }}
            >
              Yes: {resetVote.yesVotes.join(", ")}
            </div>
          )}
          {resetVote.noVotes.length > 0 && (
            <div
              style={{
                fontSize: "0.8em",
                marginTop: "2px",
                color: "var(--color-vote-no-label)",
              }}
            >
              No: {resetVote.noVotes.join(", ")}
            </div>
          )}
        </div>
      </div>
    );
  };

  return (
    <>
      {gameStatus !== GameStatus.Setup &&
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
              {gameStatus === GameStatus.Setup && (
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
    </>
  );
};
