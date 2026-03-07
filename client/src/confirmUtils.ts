import type { Player } from "./types";

export function shouldConfirmTeamAction(teamPlayers: Player[]): boolean {
  return teamPlayers.filter((p) => p.connected).length === 1;
}

export function shouldConfirmResetGame(allPlayers: Player[]): boolean {
  return allPlayers.filter((p) => p.connected).length === 1;
}
