import { maybeDeepCopy, mergeByPk } from "./helpers.ts";
import { team } from "../../core/index.ts";
import { idb } from "../index.ts";
import { g, helpers } from "../../util/index.ts";
import type {
	Team,
	TeamAttr,
	TeamFiltered,
	TeamSeasonAttr,
	TeamStatAttr,
	TeamStatType,
	TeamStats,
	GetCopyType,
} from "../../../common/types.ts";
import { DEFAULT_POINTS_FORMULA } from "../../../common/index.ts";
import { orderBy } from "../../../common/utils.ts";

const processAttrs = <
	Attrs extends Readonly<TeamAttr[]>,
	SeasonAttrs extends Readonly<TeamSeasonAttr[]> | undefined,
	StatAttrs extends Readonly<TeamStatAttr[]> | undefined,
	Season extends number | undefined,
>(
	output: TeamFiltered<Attrs, SeasonAttrs, StatAttrs, Season>,
	t: Team,
	attrs: Attrs,
) => {
	for (const attr of attrs) {
		if (attr === "budget") {
			output.budget = helpers.deepCopy(t.budget);
		} else {
			// @ts-expect-error
			output[attr] = t[attr];
		}
	}
};

const processSeasonAttrs = async <
	Attrs extends Readonly<TeamAttr[]> | undefined,
	SeasonAttrs extends Readonly<TeamSeasonAttr[]>,
	StatAttrs extends Readonly<TeamStatAttr[]> | undefined,
	Season extends number | undefined,
>(
	output: TeamFiltered<Attrs, SeasonAttrs, StatAttrs, Season>,
	t: Team,
	seasonAttrs: SeasonAttrs,
	addDummySeason: boolean,
	season: Season,
	type: GetCopyType | undefined,
) => {
	let seasons;

	if (season === undefined) {
		// All seasons
		seasons = await idb.getCopies.teamSeasons(
			{
				tid: t.tid,
			},
			type,
		);
	} else {
		// Single season, from database
		seasons = await idb.getCopies.teamSeasons(
			{
				season,
				tid: t.tid,
			},
			type,
		);
	}

	// If a season is requested but not in the database, make a fake season so at least some dummy values are returned
	if (season !== undefined && seasons.length === 0 && addDummySeason) {
		const dummySeason = team.genSeasonRow(t);
		dummySeason.season = season as number;
		seasons = [dummySeason];
	}

	// 2020-05-02 - these were moved into TeamSeason, but I'm wary of doing an IDB upgrade, so here we are.
	const copyFromTeamIfUndefined = [
		"cid",
		"did",
		"region",
		"name",
		"abbrev",
		"imgURL",
		"colors",
	];

	// @ts-expect-error
	output.seasonAttrs = await Promise.all(
		seasons.map(async (ts) => {
			const row: any = {}; // Revenue and expenses calculation

			const revenue = helpers
				.keys(ts.revenues)
				.reduce((memo, rev) => memo + ts.revenues[rev], 0);
			const expense = helpers
				.keys(ts.expenses)
				.reduce((memo, rev) => memo + ts.expenses[rev], 0);

			for (const temp of seasonAttrs) {
				const attr: string = temp;
				if (attr === "winp") {
					row.winp = helpers.calcWinp(ts);
				} else if (attr === "att") {
					row.att = ts.gpHome > 0 ? ts.att / ts.gpHome : 0;
				} else if (attr === "cash") {
					row.cash = ts.cash / 1000; // [millions of dollars]
				} else if (attr === "revenue") {
					row.revenue = revenue / 1000; // [millions of dollars]
				} else if (attr === "profit") {
					row.profit = (revenue - expense) / 1000; // [millions of dollars]
				} else if (attr === "salaryPaid") {
					row.salaryPaid = ts.expenses.salary / 1000; // [millions of dollars]
				} else if (attr === "payroll") {
					if (season === g.get("season")) {
						row.payroll = (await team.getPayroll(t.tid)) / 1000;
					} else {
						row.payroll = undefined;
					}
				} else if (attr === "payrollOrSalaryPaid") {
					if (season === g.get("season")) {
						row.payrollOrSalaryPaid = (await team.getPayroll(t.tid)) / 1000;
					} else {
						row.payrollOrSalaryPaid = ts.expenses.salary / 1000; // [millions of dollars]
					}
				} else if (attr === "lastTen") {
					let lastTenWon = 0;
					let lastTenLost = 0;
					let lastTenOTL = 0;
					let lastTenTied = 0;
					for (const x of ts.lastTen) {
						if (x === 1) {
							lastTenWon += 1;
						} else if (x === 0) {
							lastTenLost += 1;
						} else if (x === "OTL") {
							lastTenOTL += 1;
						} else if (x === -1) {
							lastTenTied += 1;
						}
					}
					row.lastTen = `${lastTenWon}-${lastTenLost}`;

					if (lastTenOTL > 0) {
						row.lastTen += `-${lastTenOTL}`;
					}
					if (lastTenTied > 0) {
						row.lastTen += `-${lastTenTied}`;
					}
				} else if (attr === "streak") {
					// For standings
					if (ts.streak === 0) {
						row.streak = "None";
					} else if (ts.streak > 0) {
						row.streak = `Won ${ts.streak}`;
					} else if (ts.streak < 0) {
						row.streak = `Lost ${Math.abs(ts.streak)}`;
					}
				} else if (attr === "pts") {
					row.pts = team.evaluatePointsFormula(ts, {
						season: ts.season,
					});
				} else if (attr === "ptsMax") {
					row.ptsMax = team.ptsMax(ts);
				} else if (attr === "ptsPct") {
					row.ptsPct = team.ptsPct(ts);
				} else if (attr === "ptsDefault") {
					row.ptsDefault = team.evaluatePointsFormula(ts, {
						formula: DEFAULT_POINTS_FORMULA,
						season: ts.season,
					});
				} else if (attr === "avgAge") {
					// Will be undefined if not cached, in which case will need to be dynamically computed elsewhere
					row.avgAge = ts[attr];
				} else if (attr === "expenseLevels") {
					if (ts.season === g.get("season")) {
						// For current season, we want the current values, not what we spent this season. That's what we want on League Finances at least, which is the only place this is used for now.
						row.expenseLevels = {
							coaching: t.budget.coaching,
							facilities: t.budget.facilities,
							health: t.budget.health,
							scouting: t.budget.scouting,
						};
					} else {
						const gp = helpers.getTeamSeasonGp(ts);
						if (gp > 0) {
							row.expenseLevels = {
								coaching: Math.round(ts.expenseLevels.coaching / gp),
								facilities: Math.round(ts.expenseLevels.facilities / gp),
								health: Math.round(ts.expenseLevels.health / gp),
								scouting: Math.round(ts.expenseLevels.scouting / gp),
							};
						} else {
							row.expenseLevels = {
								coaching: 0,
								facilities: 0,
								health: 0,
								scouting: 0,
							};
						}
					}
				} else {
					// @ts-expect-error
					row[attr] = ts[attr];
				}

				if (row[attr] === undefined && copyFromTeamIfUndefined.includes(attr)) {
					// @ts-expect-error
					row[attr] = t[attr];
				}
			}

			return row;
		}),
	);

	if (season !== undefined) {
		// @ts-expect-error
		output.seasonAttrs = output.seasonAttrs[0];
	}
};

// Indexes can't handle playoffs/regularSeason and different ones can come back inconsistently sorted
const filterOrderStats = (
	stats: TeamStats[],
	playoffs: boolean,
	regularSeason: boolean,
	type: GetCopyType | undefined,
): TeamStats[] => {
	return orderBy(
		maybeDeepCopy(
			stats.filter((ts) => {
				if (playoffs && ts.playoffs) {
					return true;
				}

				if (regularSeason && !ts.playoffs) {
					return true;
				}

				return false;
			}),
			type,
		),
		["season", "playoffs", "rid"],
	);
};

const processStats = async <
	Attrs extends Readonly<TeamAttr[]> | undefined,
	SeasonAttrs extends Readonly<TeamSeasonAttr[]> | undefined,
	StatAttrs extends Readonly<TeamStatAttr[]>,
	Season extends number | undefined,
>(
	output: TeamFiltered<Attrs, SeasonAttrs, StatAttrs, Season>,
	t: Team,
	stats: StatAttrs,
	playoffs: boolean,
	regularSeason: boolean,
	statType: TeamStatType,
	addDummySeason: boolean,
	showNoStats: boolean,
	season: Season | undefined,
	type: GetCopyType | undefined,
) => {
	let teamStats;

	const teamStatsFromCache = async () => {
		// Single season, from cache
		let teamStats2: TeamStats[] = [];

		if (regularSeason) {
			teamStats2 = teamStats2.concat(
				await idb.cache.teamStats.indexGetAll("teamStatsByPlayoffsTid", [
					[false, t.tid],
					[false, t.tid],
				]),
			);
		}

		if (playoffs) {
			teamStats2 = teamStats2.concat(
				await idb.cache.teamStats.indexGetAll("teamStatsByPlayoffsTid", [
					[true, t.tid],
					[true, t.tid],
				]),
			);
		}

		return teamStats2;
	};

	if (season === undefined) {
		// All seasons
		teamStats = mergeByPk(
			await idb.league
				.transaction("teamStats")
				.store.index("tid")
				.getAll(t.tid),
			await teamStatsFromCache(),
			"teamStats",
			type,
		);
	} else if (season === g.get("season")) {
		teamStats = await teamStatsFromCache();
	} else {
		// Single season, from database
		teamStats = await idb.league
			.transaction("teamStats")
			.store.index("season, tid")
			.getAll([season as number, t.tid]);
	}

	// Handle playoffs/regularSeason
	teamStats = filterOrderStats(teamStats, playoffs, regularSeason, type);

	if (teamStats.length === 0 && (addDummySeason || showNoStats)) {
		teamStats.push({});
	}

	// @ts-expect-error
	output.stats = teamStats.map((ts) => {
		return team.processStats(ts, stats, playoffs, statType);
	});

	if (
		season !== undefined &&
		((playoffs && !regularSeason) || (!playoffs && regularSeason))
	) {
		// @ts-expect-error
		output.stats = output.stats[0];
	}
};

const processTeam = async <
	Attrs extends Readonly<TeamAttr[]> | undefined,
	SeasonAttrs extends Readonly<TeamSeasonAttr[]> | undefined,
	StatAttrs extends Readonly<TeamStatAttr[]> | undefined,
	Season extends number | undefined,
>(
	t: Team,
	{
		season,
		attrs,
		seasonAttrs,
		stats,
		playoffs,
		regularSeason,
		statType,
		addDummySeason,
		showNoStats,
		type,
	}: {
		season?: number;
		attrs?: Attrs;
		seasonAttrs?: SeasonAttrs;
		stats?: StatAttrs;
		playoffs: boolean;
		regularSeason: boolean;
		statType: TeamStatType;
		addDummySeason: boolean;
		showNoStats: boolean;
		type: GetCopyType | undefined;
	},
) => {
	// @ts-expect-error
	const output: TeamFiltered<Attrs, SeasonAttrs, StatAttrs, Season> = {};

	if (attrs) {
		// @ts-expect-error
		processAttrs(output, t, attrs);
	}

	const promises: Promise<any>[] = [];

	if (seasonAttrs) {
		promises.push(
			// @ts-expect-error
			processSeasonAttrs(output, t, seasonAttrs, addDummySeason, season, type),
		);
	}

	if (stats) {
		promises.push(
			processStats(
				// @ts-expect-error
				output,
				t,
				stats,
				playoffs,
				regularSeason,
				statType,
				addDummySeason,
				showNoStats,
				season,
				type,
			),
		);
	}

	await Promise.all(promises);

	if (seasonAttrs && (output as never as any).seasonAttrs === undefined) {
		return;
	}
	if (stats && (output as never as any).stats === undefined) {
		return;
	}

	return output;
};

/**
 * Retrieve a filtered copy of a team object, or an array of all team objects.
 *
 * This can be used to retrieve information about a certain season, compute average statistics from the raw data, etc.
 *
 * If you request just one season (so, explicitly set season and then only one of playoffs and regularSeason is true), then stats and seasonAttrs will be returned as an object. Otherwise, they will be arrays of objects.
 *
 * @memberOf core.team
 * @param {Object} options Options, as described below.
 * @param {number=} options.tid Team ID. Set this if you want to return only one team object. If undefined, an array of all teams is returned, ordered by tid.
 * @param {number=} options.season Season to retrieve stats/seasonAttrs for. If undefined, all seasons will be returned.
 * @param {Array.<string>=} options.attrs List of team attributes to include in output (e.g. region, abbrev, name, ...).
 * @param {Array.<string>=} options.seasonAttrs List of seasonal team attributes to include in output (e.g. won, lost, payroll, ...).
 * @param {Array.<string=>} options.stats List of team stats to include in output (e.g. fg, orb, ast, blk, ...).
 * @param {boolean=} options.playoffs Boolean representing whether to return playoff stats or not; default is false.
 * @param {boolean=} options.regularSeason Boolean representing whether to return playoff stats or not; default is false.
 * @param {string=} options.statType What type of stats to return, 'perGame' or 'totals' (default is 'perGame).
 * @param {boolean=} options.addDummySeason If season is specified, should we return data for this team if it is missing a TeamStats or TeamSeasons entry?
 * @param {boolean=} options.showNoStats If season is specified, should we return data for this team if it is missing a TeamStats entry, but has a TeamSeason entry? Since TeamStats is now lazily created, this is needed to return anything in preseason or regular season before games are played.
 * @return {Promise.(Object|Array.<Object>)} Filtered team object or array of filtered team objects, depending on the inputs.
 */
async function getCopies<
	Attrs extends Readonly<TeamAttr[]> | undefined,
	SeasonAttrs extends Readonly<TeamSeasonAttr[]> | undefined,
	StatAttrs extends Readonly<TeamStatAttr[]> | undefined,
	Season extends number | undefined = undefined,
>(
	{
		tid,
		season,
		attrs,
		seasonAttrs,
		stats,
		playoffs = false,
		regularSeason = true,
		statType = "perGame",
		addDummySeason = false,
		active,
		showNoStats = false,
	}: {
		tid?: number;
		season?: Season;
		attrs?: Attrs;
		seasonAttrs?: SeasonAttrs;
		stats?: StatAttrs;
		playoffs?: boolean;
		regularSeason?: boolean;
		statType?: TeamStatType;
		addDummySeason?: boolean;
		active?: boolean;
		showNoStats?: boolean;
	} = {},
	type?: GetCopyType,
): Promise<TeamFiltered<Attrs, SeasonAttrs, StatAttrs, Season>[]> {
	const options = {
		season,
		attrs,
		seasonAttrs,
		stats,
		playoffs,
		regularSeason,
		statType,
		addDummySeason,
		showNoStats,
		type,
	};

	if (tid === undefined) {
		let teams = await idb.cache.teams.getAll();
		if (active) {
			if (season !== undefined && season !== g.get("season")) {
				throw new Error(
					"Don't call teamsPlus with active=true for any season other than the current season",
				);
			}
			teams = teams.filter((t) => !t.disabled);
		}

		// @ts-expect-error
		return (
			await Promise.all(teams.map((t) => processTeam(t, options)))
		).filter((x) => x !== undefined);
	}

	const t = await idb.cache.teams.get(tid);
	if (t) {
		const val = await processTeam(t, options);
		if (val) {
			// @ts-expect-error
			return [val];
		}
	}

	return [];
}

export default getCopies;
