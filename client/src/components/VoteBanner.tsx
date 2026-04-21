interface VoteBannerProps {
  title: string;
  yesVotes: string[];
  noVotes?: string[];
  requiredVotes: number;
  timeLeft: number;
  myVoteEligible: boolean;
  myCurrentVote?: "yes" | "no" | null;
  onYes: () => void;
  onNo: () => void;
}

export const VoteBanner: React.FC<VoteBannerProps> = ({
  title,
  yesVotes,
  noVotes,
  requiredVotes,
  timeLeft,
  myVoteEligible,
  myCurrentVote,
  onYes,
  onNo,
}) => {
  return (
    <div className="vote-banner">
      <div className="vote-banner-info">
        <div className="vote-banner-title">{title}</div>
        <div className="vote-banner-meta">
          {yesVotes.length}/{requiredVotes} &bull; {timeLeft}s
          {yesVotes.length > 0 && (
            <span className="vote-banner-yes-list">
              {" "}
              &bull; Yes: {yesVotes.join(", ")}
            </span>
          )}
          {noVotes && noVotes.length > 0 && (
            <span className="vote-banner-no-list">
              {" "}
              &bull; No: {noVotes.join(", ")}
            </span>
          )}
        </div>
      </div>
      <div className="vote-banner-buttons">
        <button
          onClick={onYes}
          disabled={!myVoteEligible || myCurrentVote === "yes"}
          className="vote-yes-btn"
        >
          Yes ({yesVotes.length})
        </button>
        <button
          onClick={onNo}
          disabled={!myVoteEligible || myCurrentVote === "no"}
          className="vote-no-btn"
        >
          {noVotes ? `No (${noVotes.length})` : "No"}
        </button>
      </div>
    </div>
  );
};
