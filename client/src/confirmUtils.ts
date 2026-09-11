import type { Player } from "./types";

export function shouldConfirmTeamAction(teamPlayers: Player[]): boolean {
  return teamPlayers.length === 1;
}
