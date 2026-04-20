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
      <div className="poll-container">
        <div className="vote-box">
          <div className="vote-box-title">
            🗳️ Vote: {titleMap[teamVote.type]}
          </div>
          <div className="vote-box-meta">
            {teamVote.yesVotes.length}/{teamVote.requiredVotes} • {voteTimeLeft}
            s
          </div>

          <div className="vote-box-buttons">
            <button
              onClick={() => onSendTeamVote("yes")}
              disabled={!teamVote.myVoteEligible}
              className="vote-yes-btn"
            >
              Yes ({teamVote.yesVotes.length})
            </button>
            <button
              onClick={() => onSendTeamVote("no")}
              disabled={!teamVote.myVoteEligible}
              className="vote-no-btn"
            >
              No
            </button>
          </div>
          {teamVote.yesVotes.length > 0 && (
            <div className="vote-box-yes-list">
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
      <div className="poll-container">
        <div className="vote-box">
          <div className="vote-box-title">{UI.voteResetGame}</div>
          <div className="vote-box-meta">
            {resetVote.yesVotes.length}/{resetVote.requiredVotes} •{" "}
            {resetVoteTimeLeft}s
          </div>

          <div className="vote-box-buttons">
            <button
              onClick={() => onSendResetVote("yes")}
              disabled={!resetVote.myVoteEligible}
              className="vote-yes-btn"
            >
              Yes ({resetVote.yesVotes.length})
            </button>
            <button
              onClick={() => onSendResetVote("no")}
              disabled={!resetVote.myVoteEligible}
              className="vote-no-btn"
            >
              No ({resetVote.noVotes.length})
            </button>
          </div>
          {resetVote.yesVotes.length > 0 && (
            <div className="vote-box-yes-list">
              Yes: {resetVote.yesVotes.join(", ")}
            </div>
          )}
          {resetVote.noVotes.length > 0 && (
            <div className="vote-box-no-list">
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

      {gameStatus !== GameStatus.Over && (
        <>
          {teamVote.isActive && renderVoteUI()}

          {!teamVote.isActive &&
            gameStatus === GameStatus.AwaitingProposals && (
              <>
                {(side === "white" || side === "black") && (
                  <>
                    {drawOffer === side ? (
                      <button disabled className="draw-offered-btn">
                        {UI.btnDrawOffered}
                      </button>
                    ) : drawOffer && drawOffer !== side ? (
                      <span className="vote-status-text">
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
