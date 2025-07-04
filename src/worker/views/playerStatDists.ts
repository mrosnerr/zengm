import {
	bySport,
	PHASE,
	PLAYER,
	PLAYER_STATS_TABLES,
} from "../../common/index.ts";
import { idb } from "../db/index.ts";
import { g } from "../util/index.ts";
import type {
	UpdateEvents,
	ViewInput,
	PlayerStatType,
} from "../../common/types.ts";

const updatePlayers = async (
	inputs: ViewInput<"playerStatDists">,
	updateEvents: UpdateEvents,
	state: any,
) => {
	if (
		updateEvents.includes("firstRun") ||
		(inputs.season === g.get("season") &&
			(updateEvents.includes("gameSim") ||
				updateEvents.includes("playerMovement"))) ||
		inputs.season !== state.season ||
		inputs.statType !== state.statType
	) {
		let players;

		if (g.get("season") === inputs.season && g.get("phase") <= PHASE.PLAYOFFS) {
			players = await idb.cache.players.indexGetAll("playersByTid", [
				PLAYER.FREE_AGENT,
				Infinity,
			]);
		} else {
			players = await idb.getCopies.players(
				{
					activeSeason: inputs.season,
				},
				"noCopyCache",
			);
		}

		let stats = undefined;
		let statType: PlayerStatType = "perGame";
		if (
			bySport({
				baseball: true,
				basketball: false,
				football: true,
				hockey: true,
			})
		) {
			stats = PLAYER_STATS_TABLES[inputs.statType]!.stats;
		} else {
			if (inputs.statType === "advanced") {
				stats = PLAYER_STATS_TABLES.advanced!.stats;
			} else if (inputs.statType === "shotLocations") {
				stats = PLAYER_STATS_TABLES.shotLocations!.stats;
			} else {
				stats = PLAYER_STATS_TABLES.regular!.stats;
				if (inputs.statType === "totals") {
					statType = "totals";
				} else if (inputs.statType === "per36") {
					statType = "per36";
				}
			}
		}

		players = await idb.getCopies.playersPlus(players, {
			ratings: ["skills"],
			stats,
			season: inputs.season,
			statType,
		});
		if (
			bySport({
				baseball: true,
				basketball: false,
				football: true,
				hockey: true,
			})
		) {
			const statTable = PLAYER_STATS_TABLES[inputs.statType]!;
			const onlyShowIf = statTable.onlyShowIf;
			if (onlyShowIf) {
				players = players.filter((p) => {
					for (const stat of onlyShowIf) {
						if (typeof p["stats"][stat] === "number" && p["stats"][stat] > 0) {
							return true;
						}
					}

					return false;
				});
			}
		}

		const statsAll = players.reduce((memo, p) => {
			for (const stat of Object.keys(p.stats)) {
				if (stat === "playoffs") {
					continue;
				}
				if (memo[stat]) {
					memo[stat].push(p.stats[stat]);
				} else {
					memo[stat] = [p.stats[stat]];
				}
			}

			return memo;
		}, {});

		return {
			numGames: g.get("numGames"),
			season: inputs.season,
			statsAll,
			statType: inputs.statType,
		};
	}
};

export default updatePlayers;
