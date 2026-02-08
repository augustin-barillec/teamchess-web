export {
  reasonMessages,
  gameOverFallback,
  DEFAULT_PLAYER_NAME,
} from "../../server/shared_messages";

export const UI = {
  // Tabs
  tabPlayers: "Players",
  tabMoves: "Moves",
  tabChat: "Chat",
  tabControls: "Controls",

  // Section headings
  headingPlayers: "Players",
  headingMoves: "Moves",
  headingChat: "Chat",
  headingControls: "Controls",
  headingSpectators: "Spectators",
  headingWhite: "White",
  headingBlack: "Black",

  // Name modal
  nameModalTitle: "Change Name",
  nameModalPlaceholder: "Set your name",
  nameModalAriaLabel: "Set your name (Enter to save)",
  nameModalCancel: "Cancel",
  nameModalSave: "Save",

  // Promotion dialog
  promotionTitle: "Promote to:",

  // Buttons
  btnResetGame: "🔄 Reset Game",
  btnAutoAssign: "🎲 Auto Assign",
  btnJoinWhite: "♔ Join White",
  btnJoinBlack: "♚ Join Black",
  btnJoinSpectators: "👁️ Join Spectators",
  btnSwitchTo: (otherSide: string) => `🔁 Switch to ${otherSide}`,
  btnResign: "🏳️ Resign",
  btnOfferDraw: "🤝 Offer Draw",
  btnDrawOffered: "⏳ Draw Offered...",
  btnCopyPgn: "📋 Copy PGN",
  btnMuteSounds: "🔇 Mute Sounds",
  btnUnmuteSounds: "🔊 Unmute Sounds",
  btnKick: "Kick",
  btnClose: "Close",

  // Vote UI
  voteTypeResign: "Resign",
  voteTypeOfferDraw: "Offer Draw",
  voteTypeAcceptDraw: "Accept Draw",
  voteResetGame: "🗳️ Vote: Reset Game",
  votingOnDraw: "Voting on Draw...",
  voteInProgress: "Vote in progress",

  // Kick vote
  kickVoteTargetSelf: "Vote to kick YOU",
  kickVoteTargetOther: "Kick this player?",
  kickVoteTooltip: (name: string) => `Vote to kick ${name}`,

  // Status
  noMovesYet: "No moves played yet.",
  offlineBanner: "You\u2019re offline. Trying to reconnect\u2026",

  // Chat
  chatPlaceholder: "Type a message...",

  // Confirmations
  confirmResign: "Are you sure you want to resign?",
  confirmOfferDraw: "Are you sure you want to offer a draw?",

  // Toasts
  toastMoveSubmitted: "Move submitted \u2714\uFE0F",
  toastPgnCopied: "PGN copied!",
  toastPgnCopyFailed: "Could not copy PGN.",
  toastIllegalMove: "Illegal move!",
  toastOnlyWhiteStart: "Only White can make the first move to start the game.",
  toastDrawOffer: (teamName: string) => `Draw offer from the ${teamName} team.`,
  toastKicked: "You have been kicked by vote.",
} as const;
