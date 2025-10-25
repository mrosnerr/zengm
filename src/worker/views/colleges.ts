import { idb } from "../db/index.ts";
import { g, helpers, processPlayersHallOfFame } from "../util/index.ts";
import type { UpdateEvents, Player } from "../../common/types.ts";
import { bySport } from "../../common/index.ts";
import { getValueStatsRow } from "../core/player/checkJerseyNumberRetirement.ts";
import addFirstNameShort from "../util/addFirstNameShort.ts";

type InfoTemp = {
	numPlayers: number;
	numActivePlayers: number;
	numHof: number;
	numRetired: number;
	gp: number;
	displayStat: number;
	valueStat: number;
	best: {
		displayStat: number;
		valueStat: number;
		p: Player;
	};
};

const displayStatNames = bySport({
	baseball: ["war"],
	basketball: ["ows", "dws"],
	football: ["av"],
	hockey: ["ops", "dps", "gps"],
});

const reducer = (
	type: "college" | "country" | "draftPosition" | "jerseyNumbers",
	infos: { [key: string]: InfoTemp | undefined },
	p: Player,
) => {
	let name;
	if (type === "college") {
		name = p.college && p.college !== "" ? p.college : "None";
	} else if (type === "jerseyNumbers") {
		name = helpers.getJerseyNumber(p, "mostCommon");
		if (name === undefined) {
			return;
		}
	} else if (type === "draftPosition") {
		name = p.draft.round > 0 ? `${p.draft.round}-${p.draft.pick}` : "undrafted";
	} else {
		name = helpers.getCountry(p.born.loc);
	}

	if (!infos[name]) {
		infos[name] = {
			numPlayers: 0,
			numActivePlayers: 0,
			numHof: 0,
			numRetired: 0,
			gp: 0,
			displayStat: 0,
			valueStat: 0,
			best: {
				displayStat: -Infinity,
				valueStat: -Infinity,
				p,
			},
		};
	}

	const info = infos[name] as InfoTemp;
	info.numPlayers += 1;
	if (p.tid >= 0) {
		info.numActivePlayers += 1;
	}
	if (p.hof) {
		info.numHof += 1;
	}

	let displayStat = 0;
	let valueStat = 0;
	let gp = 0;
	for (const stats of p.stats) {
		gp += stats.gp;
		valueStat += getValueStatsRow(stats);
		for (const displayStatName of displayStatNames) {
			displayStat += stats[displayStatName] ?? 0;
		}
	}

	info.gp += gp;
	info.valueStat += valueStat;
	info.displayStat += displayStat;
	if (valueStat >= info.best.valueStat) {
		info.best = {
			displayStat,
			p,
			valueStat,
		};
	}
};

export const genView = (
	type: "college" | "country" | "draftPosition" | "jerseyNumbers",
) => {
	return async (inputs: unknown, updateEvents: UpdateEvents) => {
		// In theory should update more frequently, but the list is potentially expensive to update and rarely changes
		if (updateEvents.includes("firstRun")) {
			const displayStat = bySport({
				baseball: "war",
				basketball: "ws",
				football: "av",
				hockey: "ps",
			});
			const stats = bySport({
				baseball: ["keyStats", "war"],
				basketball: [
					"gp",
					"min",
					"pts",
					"trb",
					"ast",
					"per",
					"ewa",
					"ows",
					"dws",
					"ws",
					"ws48",
				],
				football: ["keyStats", "av"],
				hockey: ["keyStats", "ops", "dps", "ps"],
			});

			const infosTemp: { [key: string]: InfoTemp } = {};
			for await (const { value: p } of idb.league.transaction("players")
				.store) {
				reducer(type, infosTemp, p);
			}

			const infos = await Promise.all(
				Object.entries(infosTemp).map(async ([name, info]) => {
					const p = await idb.getCopy.playersPlus(info.best.p, {
						attrs: [
							"pid",
							"firstName",
							"lastName",
							"draft",
							"retiredYear",
							"statsTids",
							"hof",
							"jerseyNumber",
						],
						ratings: ["season", "ovr", "pos"],
						stats: ["season", "abbrev", "tid", ...stats],
						fuzz: true,
					});

					return {
						name,
						numPlayers: info.numPlayers,
						numActivePlayers: info.numActivePlayers,
						numHof: info.numHof,
						numRetired: info.numRetired,
						gp: info.gp,
						displayStat: info.displayStat,
						valueStat: info.valueStat,
						p: processPlayersHallOfFame([p])[0],
					};
				}),
			);

			if (type === "jerseyNumbers") {
				const retiredCounts: Record<string, number> = {};
				const teams = await idb.cache.teams.getAll();
				for (const t of teams) {
					if (t.retiredJerseyNumbers) {
						for (const row of t.retiredJerseyNumbers) {
							if (retiredCounts[row.number] === undefined) {
								retiredCounts[row.number] = 1;
							} else {
								retiredCounts[row.number]! += 1;
							}
						}
					}
				}

				for (const info of infos) {
					info.numRetired = retiredCounts[info.name] ?? 0;
				}
			}

			// Hacky crap because p is nested
			const players = infos.map((info) => info.p);
			const playersWithFirstNameShort = addFirstNameShort(players);
			for (const [i, info] of infos.entries()) {
				info.p = playersWithFirstNameShort[i];
			}

			return {
				challengeNoRatings: g.get("challengeNoRatings"),
				infos,
				stats,
				userTid: g.get("userTid"),
				displayStat,
			};
		}
	};
};

export default genView("college");
