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

  // Section headings
  headingPlayers: "Players",
  headingMoves: "Moves",
  headingChat: "Chat",
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
  btnKick: "Kick",
  btnClose: "Close",
  btnJoin: "Join",

  // Icon-button labels & tooltips
  btnResignLabel: "Resign",
  btnOfferDrawLabel: "Offer Draw",
  btnResetLabel: "Reset",
  btnMuteLabel: "Mute",
  btnUnmuteLabel: "Unmute",
  btnCopyPgnLabel: "PGN",
  tooltipCopyPgn: "Copy PGN",
  tooltipAutoAssign: "Auto assign",
  drawOfferPending: "Draw offered",

  // Vote UI
  voteTypeResign: "Resign",
  voteTypeOfferDraw: "Offer Draw",
  voteTypeAcceptDraw: "Accept Draw",
  voteResetGame: "Vote: Reset Game",
  votingOnDraw: "Voting on draw...",
  voteInProgress: "Vote in progress.",

  // Kick vote
  kickVoteTargetSelf: "Vote to kick you",
  kickVoteTargetOther: "Vote to kick this player?",
  kickVoteTooltip: (name: string) => `Vote to kick ${name}`,

  // Status
  noMovesYet: "No moves played yet.",
  offlineBanner: "You\u2019re offline. Trying to reconnect\u2026",

  // Chat
  chatPlaceholder: "Type a message...",

  // Confirmations
  confirmResign: "Are you sure you want to resign?",
  confirmOfferDraw: "Are you sure you want to offer a draw?",
  confirmResetGame: "Are you sure you want to reset the game?",
  confirmOk: "Confirm",
  confirmCancel: "Cancel",

  // Toasts
  toastMoveSubmitted: "Move submitted",
  toastPgnCopied: "PGN copied!",
  toastPgnCopyFailed: "Could not copy PGN.",
  toastIllegalMove: "Illegal move!",
  toastOnlyWhiteStart: "Only White can make the first move.",
  toastDrawOffer: (teamName: string) => `Draw offer from the ${teamName} team.`,
  toastKicked: "You have been kicked by vote.",
} as const;
