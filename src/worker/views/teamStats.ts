import { idb } from "../db/index.ts";
import { g, helpers } from "../util/index.ts";
import type {
	UpdateEvents,
	ViewInput,
	TeamStatAttr,
	TeamSeasonAttr,
} from "../../common/types.ts";
import { TEAM_STATS_TABLES } from "../../common/index.ts";
import { season, team } from "../core/index.ts";
import { lowerIsBetter } from "../../common/lowerIsBetter.ts";

export const getStats = async ({
	season,
	playoffs,
	statsTable,
	usePts,
	tid,
	noDynamicAvgAge,
}: {
	season: number;
	playoffs: boolean;
	statsTable: {
		stats: string[];
	};
	usePts: boolean;
	tid?: number;
	noDynamicAvgAge?: boolean;
}) => {
	const stats = statsTable.stats;
	const seasonAttrs: TeamSeasonAttr[] = [
		"abbrev",
		"region",
		"name",
		"imgURL",
		"imgURLSmall",
		"won",
		"lost",
		"tied",
		"otl",
		"avgAge",
	];
	if (usePts) {
		seasonAttrs.push("pts", "ptsPct");
	} else {
		seasonAttrs.push("winp");
	}
	const teams = (
		await idb.getCopies.teamsPlus(
			{
				attrs: ["tid"],
				seasonAttrs,
				stats: ["gp", ...stats] as TeamStatAttr[],
				season,
				tid,
				playoffs,
				regularSeason: !playoffs,
			},
			"noCopyCache",
		)
	).filter((t) => {
		// For playoffs, only show teams who actually made playoffs (gp > 0)
		return !playoffs || t.stats.gp > 0;
	});

	// For playoffs, fix W/L to be playoff W/L not regular season
	if (playoffs) {
		const playoffSeries = await idb.getCopy.playoffSeries(
			{
				season,
			},
			"noCopyCache",
		);

		if (playoffSeries !== undefined) {
			// Reset W/L
			for (const t of teams) {
				t.seasonAttrs.won = 0;
				t.seasonAttrs.lost = 0;
				t.seasonAttrs.tied = 0;
				t.seasonAttrs.otl = 0;
			}

			for (const round of playoffSeries.series) {
				for (const series of round) {
					for (const ah of ["away", "home"] as const) {
						const ha = ah === "away" ? "home" : "away";
						const t = teams.find(
							(t2) => series[ah] && t2.tid === series[ah].tid,
						);

						if (t && series[ah] && series[ha]) {
							t.seasonAttrs.won += series[ah].won;
							t.seasonAttrs.lost += series[ha].won;
						}
					}
				}
			}
		}

		for (const t of teams) {
			if (usePts) {
				t.seasonAttrs.pts = team.evaluatePointsFormula(t.seasonAttrs, {
					season,
				});
				t.seasonAttrs.ptsPct = team.ptsPct(t.seasonAttrs);
			} else {
				t.seasonAttrs.winp = helpers.calcWinp(t.seasonAttrs);
			}
		}
	}

	for (const t of teams) {
		if (t.seasonAttrs.avgAge === undefined) {
			let playersRaw;
			if (g.get("season") === season) {
				playersRaw = await idb.cache.players.indexGetAll("playersByTid", t.tid);
			} else {
				if (noDynamicAvgAge) {
					continue;
				}
				playersRaw = await idb.getCopies.players(
					{
						activeSeason: season,
						statsTid: t.tid,
					},
					"noCopyCache",
				);
			}

			const players = await idb.getCopies.playersPlus(playersRaw, {
				attrs: ["age"],
				stats: ["gp", "min"],
				season,
				showNoStats: g.get("season") === season,
				showRookies: g.get("season") === season,
				tid: t.tid,
			});

			t.seasonAttrs.avgAge = team.avgAge(players);
		}
	}

	return {
		seasonAttrs,
		stats,
		teams,
	};
};

export const ignoreStats = ["mov", "pw", "pl"];

export const averageTeamStats = (
	{ seasonAttrs, stats, teams }: Awaited<ReturnType<typeof getStats>>,
	{ otl, ties, tid }: { otl: boolean; ties: boolean; tid?: number | undefined },
) => {
	if (!ties || !otl) {
		for (const t of teams) {
			if (t.seasonAttrs.tied > 0) {
				ties = true;
			}
			if (t.seasonAttrs.otl > 0) {
				otl = true;
			}
			if (ties && otl) {
				break;
			}
		}
	}

	const row: Record<string, number | number[]> = {};

	let foundSomething = false;

	// Average together stats
	for (const stat of [...stats, "gp", "avgAge"]) {
		if (ignoreStats.includes(stat)) {
			continue;
		}

		const byPos =
			teams.length > 0 && Array.isArray((teams[0]!.stats as any)[stat]);

		let sum = byPos ? [] : 0;
		for (const t of teams) {
			if (tid !== undefined && t.tid !== tid) {
				continue;
			}

			if (stat === "avgAge") {
				// @ts-expect-error
				sum += t.seasonAttrs.avgAge ?? 0;
			} else if (byPos) {
				// @ts-expect-error
				const byPosStat: (number | undefined)[] = t.stats[stat];
				for (let i = 0; i < byPosStat.length; i++) {
					const value = byPosStat[i];
					if (value !== undefined) {
						if ((sum as number[])[i] === undefined) {
							(sum as number[])[i] = 0;
						}
						(sum as number[])[i]! += value;
					}
				}
			} else {
				// @ts-expect-error
				sum += t.stats[stat];
			}
			foundSomething = true;
		}

		if (tid === undefined && teams.length !== 0) {
			if (byPos) {
				row[stat] = (sum as number[]).map((value) => value / teams.length);
			} else {
				row[stat] = (sum as number) / teams.length;
			}
		} else {
			row[stat] = sum;
		}
	}
	for (const attr of seasonAttrs) {
		if (attr === "abbrev") {
			continue;
		}
		let sum = 0;
		for (const t of teams) {
			if (tid !== undefined && t.tid !== tid) {
				continue;
			}
			// @ts-expect-error
			sum += t.seasonAttrs[attr];
			foundSomething = true;
		}

		// Don't overwrite pts
		const statsKey = attr === "pts" ? "ptsPts" : attr;
		row[statsKey] =
			tid === undefined && teams.length !== 0 ? sum / teams.length : sum;
	}

	return {
		row: foundSomething ? row : undefined,
		otl,
		ties,
	};
};

const updateTeams = async (
	inputs: ViewInput<"teamStats">,
	updateEvents: UpdateEvents,
	state: any,
) => {
	if (
		updateEvents.includes("firstRun") ||
		(inputs.season === g.get("season") &&
			(updateEvents.includes("gameSim") ||
				updateEvents.includes("playerMovement"))) ||
		inputs.playoffs !== state.playoffs ||
		inputs.season !== state.season ||
		inputs.teamOpponent !== state.teamOpponent
	) {
		const statsTable = TEAM_STATS_TABLES[inputs.teamOpponent];

		if (!statsTable) {
			throw new Error(`Invalid statType: "${inputs.teamOpponent}"`);
		}

		const pointsFormula = g.get("pointsFormula", inputs.season);
		const usePts = pointsFormula !== "";

		const { seasonAttrs, stats, teams } = await getStats({
			season: inputs.season,
			playoffs: inputs.playoffs === "playoffs",
			statsTable,
			usePts,
		});

		let ties = season.hasTies(inputs.season);
		let otl = g.get("otl", inputs.season);
		for (const t of teams) {
			if (t.seasonAttrs.tied > 0) {
				ties = true;
			}
			if (t.seasonAttrs.otl > 0) {
				otl = true;
			}
			if (ties && otl) {
				break;
			}
		}

		// Sort stats so we can determine what percentile our team is in.
		const allStats: Record<string, number[]> = {};
		let statTypes: string[] = seasonAttrs.slice();

		for (const table of Object.values(TEAM_STATS_TABLES)) {
			statTypes = statTypes.concat(table.stats);
		}
		statTypes = Array.from(new Set(statTypes));

		for (const t of teams) {
			for (const statType of statTypes) {
				const value = Object.hasOwn(t.stats, statType)
					? (t.stats as any)[statType]
					: (t.seasonAttrs as any)[statType];

				if (value === undefined) {
					continue;
				}

				// TEMP DISABLE WITH ESLINT 9 UPGRADE eslint-disable-next-line @typescript-eslint/strict-boolean-expressions
				if (!allStats[statType]) {
					allStats[statType] = [value];
				} else {
					allStats[statType].push(value);
				}
			}
		}

		// Sort stat types. "Better" values are at the start of the arrays.
		for (const [statType, allStatsOfType] of Object.entries(allStats)) {
			allStatsOfType.sort((a, b) => {
				// Sort lowest first.
				if (lowerIsBetter.has(statType)) {
					if (a < b) {
						return -1;
					}

					if (a > b) {
						return 1;
					}

					return 0;
				}

				// Sort highest first.
				if (a < b) {
					return 1;
				}

				if (a > b) {
					return -1;
				}

				return 0;
			});
		}

		const { row: averages } = averageTeamStats(
			{ seasonAttrs, stats, teams },
			{
				otl,
				ties,
			},
		);

		return {
			allStats,
			averages,
			playoffs: inputs.playoffs,
			season: inputs.season,
			stats,
			superCols: statsTable.superCols,
			teamOpponent: inputs.teamOpponent,
			teams,
			ties,
			otl,
			usePts,
			userTid: g.get("userTid"),
		};
	}
};

export default updateTeams;
