export { DEFAULT_PLAYER_NAME } from "../../server/shared_messages";

export const UI = {
  // Section headings
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
  btnJoin: "Join",
  playedThisTurn: "Played this turn",
  leadLabel: "Host",

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
  votingOnDraw: "Voting on draw…",

  // Kick (a lead power)
  kickTooltip: (name: string) => `Kick ${name}`,

  // Status
  noMovesYet: "No moves played yet.",
  offlineBanner: "You\u2019re offline. Trying to reconnect\u2026",
  forfeitCountdown: (team: string, seconds: number) =>
    `${team} has nobody left \u2014 forfeits in ${seconds}s unless someone joins`,
  forfeitCountdownBoth: (seconds: number) =>
    `Nobody left on either side \u2014 draw in ${seconds}s unless someone joins`,

  // Chat
  chatPlaceholder: "Type a message...",

  // Confirmations
  confirmResign: "Resign the game?",
  confirmOfferDraw: "Offer a draw?",
  confirmResetGame: "Reset the game? All progress will be lost.",
  confirmKick: (name: string) => `Kick ${name}?`,
  confirmOk: "Confirm",
  confirmCancel: "Cancel",

  // Toasts
  toastPgnCopied: "PGN copied!",
  toastPgnCopyFailed: "Could not copy PGN.",
  toastIllegalMove: "Illegal move!",
  toastOnlyWhiteStart: "Only White can make the first move.",
  toastKicked: "You have been kicked from the game.",
} as const;
