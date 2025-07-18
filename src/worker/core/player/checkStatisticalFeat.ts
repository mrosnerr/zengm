import { bySport, PHASE } from "../../../common/index.ts";
import { idb } from "../../db/index.ts";
import { g, helpers, logEvent } from "../../util/index.ts";
import checkStatisticalFeatBaseball from "./checkStatisticalFeat.baseball.ts";
import checkStatisticalFeatBasketball from "./checkStatisticalFeat.basketball.ts";
import checkStatisticalFeatFootball from "./checkStatisticalFeat.football.ts";
import checkStatisticalFeatHockey from "./checkStatisticalFeat.hockey.ts";
import type {
	Conditions,
	GamePlayer,
	GameResults,
} from "../../../common/types.ts";
import getWinner from "../../../common/getWinner.ts";
import formatScoreWithShootout from "../../../common/formatScoreWithShootout.ts";

const checkPlayer = bySport({
	baseball: checkStatisticalFeatBaseball,
	basketball: checkStatisticalFeatBasketball,
	football: checkStatisticalFeatFootball,
	hockey: checkStatisticalFeatHockey,
});

const checkStatisticalFeat = (
	pid: number,
	tid: number,
	p: GamePlayer,
	results: GameResults,
	conditions: Conditions,
) => {
	const minFactor = helpers.quarterLengthFactor();
	if (minFactor <= 0.01) {
		// Skip for very short games
		return;
	}

	const logFeat = async (text: string, score: number) => {
		let allStars;

		if (tid < 0 && results.team[0].id === -1 && results.team[1].id === -2) {
			allStars = await idb.cache.allStars.get(g.get("season"));
		}

		let actualTid = tid;

		if (allStars) {
			// Fix team ID to actual team, not All-Star team
			const indTeam = tid === results.team[0].id ? 0 : 1;
			const entry = allStars.teams[indTeam].find((p2) => p2.pid === pid);

			if (entry) {
				actualTid = entry.tid;
			}
		}

		logEvent(
			{
				type: "playerFeat",
				text,
				showNotification: actualTid === g.get("userTid"),
				pids: [pid],
				tids: [actualTid],
				score,
			},
			conditions,
		);
	};

	const { score, feats } = checkPlayer(p);
	const allStarGame = results.team[0].id === -1 && results.team[1].id === -2;

	const winner = getWinner([results.team[0].stat, results.team[1].stat]);
	if (feats) {
		const [i, j] =
			results.team[0].id === tid ? ([0, 1] as const) : ([1, 0] as const);
		const won = winner === i;
		const tied = winner === -1;
		const featTextArr = Object.keys(feats).map((stat) => {
			// Hacky way to convert "1 assists" into "an assist"
			if (feats[stat] === 1 && stat.endsWith("s")) {
				const singular = stat.slice(0, -1);
				const vowels = ["a", "e", "i", "o", "u"];
				return `${vowels.includes(singular[0]!) ? "an" : "a"} ${singular}`;
			}

			return `${feats[stat]} ${stat}`;
		});
		let featText = `<a href="${helpers.leagueUrl(["player", pid])}">${
			p.name
		}</a> had <a href="${helpers.leagueUrl([
			"game_log",
			tid < 0 ? "special" : g.get("teamInfoCache")[tid]?.abbrev,
			g.get("season"),
			results.gid,
		])}">`;

		for (let k = 0; k < featTextArr.length; k++) {
			if (featTextArr.length > 1 && k === featTextArr.length - 1) {
				featText += " and ";
			}

			featText += featTextArr[k];

			if (featTextArr.length > 2 && k < featTextArr.length - 2) {
				featText += ", ";
			}
		}

		const scoreText = formatScoreWithShootout(
			results.team[i].stat,
			results.team[j].stat,
		);

		const endPart = allStarGame
			? `${tied ? "tie" : won ? "win" : "loss"} in the All-Star Game`
			: `${tied ? "tie with the" : won ? "win over the" : "loss to the"} ${
					g.get("teamInfoCache")[results.team[j].id]?.name
				}`;
		featText += `</a> in ${
			results.team[i].stat.pts.toString().charAt(0) === "8" ? "an" : "a"
		} ${scoreText} ${endPart}.`;

		logFeat(featText, score);

		const result = tied ? "T" : won ? "W" : "L";

		idb.cache.playerFeats.add({
			pid,
			name: p.name,
			pos: p.pos,
			season: g.get("season"),
			tid,
			oppTid: results.team[j].id,
			playoffs: g.get("phase") === PHASE.PLAYOFFS,
			gid: results.gid,
			stats: p.stat,
			score: scoreText,
			overtimes: results.overtimes,
			numPeriods: g.get("numPeriods"),
			result,
		});
	}

	return !!feats;
};

export default checkStatisticalFeat;
