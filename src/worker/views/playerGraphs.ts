import {
	isSport,
	PHASE,
	PLAYER,
	PLAYER_STATS_TABLES,
	RATINGS,
} from "../../common/index.ts";
import { idb } from "../db/index.ts";
import { g, helpers, random } from "../util/index.ts";
import type {
	UpdateEvents,
	ViewInput,
	PlayerStatType,
} from "../../common/types.ts";
import { POS_NUMBERS } from "../../common/constants.baseball.ts";
import { maxBy } from "../../common/utils.ts";
import {
	getStats,
	getStatsTableByType,
} from "../../common/advancedPlayerSearch.ts";

export const statTypes = [
	"bio",
	"ratings",
	...(isSport("basketball")
		? ["perGame", "per36", "totals", "shotLocations", "advanced", "gameHighs"]
		: Object.keys(PLAYER_STATS_TABLES)),
];

const getPlayerStats = async (
	statTypeInput: string | undefined,
	season: number | "career",
	playoffs: "playoffs" | "regularSeason" | "combined",
) => {
	// This is the value form the form/URL (or a random one), which confusingly is not the same as statType passed to playersPlus
	const statTypePlus =
		statTypeInput !== undefined && statTypes.includes(statTypeInput)
			? statTypeInput
			: random.choice(statTypes);

	const statsTable = getStatsTableByType(statTypePlus);

	const ratings = statTypePlus === "ratings" ? ["ovr", "pot", ...RATINGS] : [];
	let statType: PlayerStatType;
	if (isSport("basketball")) {
		if (statTypePlus === "totals") {
			statType = "totals";
		} else if (statTypePlus === "per36") {
			statType = "per36";
		} else {
			statType = "perGame";
		}
	} else {
		statType = "totals";
	}

	let playersAll;

	if (g.get("season") === season && g.get("phase") <= PHASE.PLAYOFFS) {
		playersAll = await idb.cache.players.indexGetAll("playersByTid", [
			PLAYER.FREE_AGENT,
			Infinity,
		]);
	} else {
		playersAll = await idb.getCopies.players(
			{
				activeSeason: typeof season === "number" ? season : undefined,
			},
			"noCopyCache",
		);
	}

	const statKeys = statsTable?.stats ?? ["gp"];

	let players = await idb.getCopies.playersPlus(playersAll, {
		attrs: [
			"pid",
			"name",
			"tid",

			// draft is needed to know who is undrafted, for the tooltip
			"draft",
			...(statTypePlus == "bio" ? ["age", "salary", "draftPosition"] : []),
		],
		ratings,
		stats: statKeys,
		season: typeof season === "number" ? season : undefined,
		tid: undefined,
		statType,
		playoffs: playoffs === "playoffs",
		regularSeason: playoffs === "regularSeason",
		combined: playoffs === "combined",
		mergeStats: "totOnly",
		fuzz: true,
	});

	if (season === "career") {
		let obj;
		if (playoffs === "playoffs") {
			obj = "careerStatsPlayoffs";
		} else if (playoffs === "combined") {
			obj = "careerStatsCombined";
		} else {
			obj = "careerStats";
		}
		for (const p of players) {
			p.stats = p[obj];
			delete p[obj];

			// Show row from max ovr season
			if (p.ratings) {
				p.ratings = maxBy(p.ratings, (row) => row.ovr);
			}
		}
	}

	// HACKY! Sum up fielding stats, rather than by position
	if (isSport("baseball") && statTypePlus === "fielding") {
		for (const p of players) {
			// Ignore DH games played, so that filtering on GP in the Player Graphs UI does something reasonable. Otherwise DHs with 0 fielding stats appear in all the fielding graphs.
			const dhIndex = POS_NUMBERS.DH - 1;
			p.stats.gp = 0;
			for (let i = 0; i < p.stats.gpF.length; i++) {
				if (i !== dhIndex && p.stats.gpF[i] !== undefined) {
					p.stats.gp += p.stats.gpF[i];
				}
			}

			// Sum up stats
			for (const stat of statKeys) {
				if (Array.isArray(p.stats[stat])) {
					let sum = 0;
					for (const value of p.stats[stat]) {
						if (value !== undefined) {
							sum += value;
						}
					}
					p.stats[stat] = sum;
				}
			}

			// Fix Fld%
			p.stats.fldp = helpers.ratio(
				(p.stats.po ?? 0) + (p.stats.a ?? 0),
				(p.stats.po ?? 0) + (p.stats.a ?? 0) + (p.stats.e ?? 0),
			);
		}
	}

	if (statsTable?.onlyShowIf && !isSport("basketball")) {
		// Ensure some non-zero stat for this position
		const onlyShowIf = statsTable.onlyShowIf;

		players = players.filter((p) => {
			for (const stat of onlyShowIf) {
				// Array check is for byPos stats
				if (
					(typeof p.stats[stat] === "number" && p.stats[stat] > 0) ||
					(Array.isArray(p.stats[stat]) && p.stats[stat].length > 0)
				) {
					return true;
				}
			}

			return false;
		});
	}

	if (g.get("challengeNoRatings") && ratings.length > 0) {
		for (const p of players) {
			if (p.tid !== PLAYER.RETIRED) {
				for (const key of ratings) {
					p.ratings[key] = 50;
				}
			}
		}
	}

	const stats = getStats(statTypePlus);
	return { players, stats, statType: statTypePlus };
};

const updatePlayers = async (
	axis: "X" | "Y",
	inputs: ViewInput<"playerGraphs">,
	updateEvents: UpdateEvents,
	state: any,
) => {
	const season = `season${axis}` as const;
	const statType = `statType${axis}` as const;
	const playoffs = `playoffs${axis}` as const;
	if (
		updateEvents.includes("firstRun") ||
		(inputs[season] === g.get("season") &&
			(updateEvents.includes("gameSim") ||
				updateEvents.includes("playerMovement"))) ||
		// Purposely skip checking statX, statY, minGames - those are only used client side, they in the URL for usability
		inputs[season] !== state[season] ||
		inputs[statType] !== state[statType] ||
		inputs[playoffs] !== state[playoffs]
	) {
		const statForAxis = await getPlayerStats(
			inputs[statType],
			inputs[season],
			inputs[playoffs],
		);

		const statKey = `stat${axis}` as const;
		const inputStat = inputs[statKey];

		const stat =
			inputStat !== undefined && statForAxis.stats.includes(inputStat)
				? inputStat
				: random.choice(statForAxis.stats);

		return {
			[season]: inputs[season],
			[statType]: statForAxis.statType,
			[playoffs]: inputs[playoffs],
			[`players${axis}`]: statForAxis.players,
			[`stats${axis}`]: statForAxis.stats,
			[statKey]: stat,
			minGames: inputs.minGames,
		};
	}
};

const updateClientSide = (
	inputs: ViewInput<"playerGraphs">,
	state: any,
	x: Awaited<ReturnType<typeof updatePlayers>>,
	y: Awaited<ReturnType<typeof updatePlayers>>,
) => {
	if (
		inputs.minGames !== state.minGames ||
		inputs.statX !== state.statX ||
		inputs.statY !== state.statY
	) {
		// Check x and y for statX and statY in case they were already specified there, such as randomly selecting from statForAxis
		return {
			statX: x?.statX ?? inputs.statX,
			statY: y?.statY ?? inputs.statY,
			minGames: inputs.minGames,
		} as {
			// We can assert this because we know the above block runs on first render, so this is just updating an existing state, so we don't want TypeScript to get confused
			seasonX: number | "career";
			seasonY: number | "career";
			statTypeX: string;
			statTypeY: string;
			playoffsX: "playoffs" | "regularSeason" | "combined";
			playoffsY: "playoffs" | "regularSeason" | "combined";
			playersX: any[];
			playersY: any[];
			statsX: string[];
			statsY: string[];
			statX: string;
			statY: string;
			minGames: string;
		};
	}
};

export default async (
	inputs: ViewInput<"playerGraphs">,
	updateEvents: UpdateEvents,
	state: any,
) => {
	const x = await updatePlayers("X", inputs, updateEvents, state);
	const y = await updatePlayers("Y", inputs, updateEvents, state);

	return Object.assign({}, x, y, updateClientSide(inputs, state, x, y));
};
