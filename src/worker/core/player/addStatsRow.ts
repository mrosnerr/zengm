import stats from "./stats.ts";
import { g, helpers } from "../../util/index.ts";
import type { Player, PlayerWithoutKey } from "../../../common/types.ts";
import genJerseyNumber from "./genJerseyNumber.ts";
import { isSport } from "../../../common/index.ts";
import statsRowIsCurrent from "./statsRowIsCurrent.ts";

/**
 * Add a new row of stats to the playerStats database.
 *
 * A row contains stats for unique values of (pid, team, season, playoffs). So new rows need to be added when a player joins a new team, when a new season starts, or when a player's team makes the playoffs. The team ID in p.tid and player ID in p.pid will be used in the stats row, so if a player is changing teams, update p.tid before calling this.
 *
 * `p.stats` and `p.statsTids` are mutated to reflect the new row, but `p` is NOT saved to the database! So make sure you do that after calling this function. (Or before would be fine too probably, it'd still get marked dirty and flush from cache).
 *
 * @memberOf core.player
 * @param {Object} p Player object.
 * @param {=boolean} playoffs Is this stats row for the playoffs or not? Default false.
 */
const addStatsRow = async (
	p: Player | PlayerWithoutKey,
	playoffs: boolean = false,
	jerseyNumbers: {
		ignoreJerseyNumberConflicts?: boolean;
		team?: string[];
		retired?: string[];
	} = {},
) => {
	// Never add duplicate row, such as player beign signed as FA by team who released him
	const ps = p.stats.at(-1);
	const hasStats = statsRowIsCurrent(ps, p.tid, playoffs);
	if (hasStats) {
		return;
	}

	const statsRow: any = {
		playoffs,
		season: g.get("season"),
		tid: p.tid,
		yearsWithTeam: 1,
	};

	for (const key of stats.derived) {
		statsRow[key] = 0;
	}

	for (const key of stats.raw) {
		statsRow[key] = 0;
	}

	for (const key of stats.max) {
		// Will be set to [max, gid] later. Needs to be null rather than undefined so it persists in JSON, otherwise playersPlus career totals will not know about these fields.
		statsRow[key] = null;
	}

	if (stats.byPos) {
		for (const key of stats.byPos) {
			// Will get one entry per position
			statsRow[key] = [];
		}
	}
	if (isSport("baseball")) {
		statsRow.rfld = [];
	}

	p.statsTids.push(p.tid);
	p.statsTids = Array.from(new Set(p.statsTids)); // Calculate yearsWithTeam

	const playerStats = p.stats.filter((ps) => !ps.playoffs);

	if (playerStats.length > 0) {
		const i = playerStats.length - 1;

		if (
			playerStats[i].season === g.get("season") - 1 &&
			playerStats[i].tid === p.tid
		) {
			statsRow.yearsWithTeam = playerStats[i].yearsWithTeam + 1;
		}
	}

	if (jerseyNumbers.ignoreJerseyNumberConflicts) {
		// Just carry over the previous jersey number. This is intended for situations where we'll check for conflicts later, like augmentPartialPlayer in a new league from a file. There is another pass of genJerseyNumber in league/createStream.ts that will clean up any conflicts. Don't want to call genJerseyNumber here because it'll generate random numbers for players with no jersey number, which could conflict with manually specified jersey numbers for other players, and the wrong one could be keypt in league/createStream.ts.
		p.jerseyNumber = helpers.getJerseyNumber(p); // Undefined for rookies just drafted!
	} else {
		p.jerseyNumber = await genJerseyNumber(
			p,
			jerseyNumbers.team,
			jerseyNumbers.retired,
		);
	}
	statsRow.jerseyNumber = p.jerseyNumber; // Undefined for rookies just drafted!

	p.stats.push(statsRow);
};

export default addStatsRow;
