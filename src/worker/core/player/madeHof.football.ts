import { g, helpers } from "../../util/index.ts";
import type { Player, PlayerWithoutKey } from "../../../common/types.ts";
import type { PlayerRatings } from "../../../common/types.football.ts";

const getMostCommonPos = (ratings: PlayerRatings[]) => {
	const counts = new Map<string, number>();

	for (const { pos } of ratings) {
		let count = counts.get(pos) ?? 0;
		count += 1;
		counts.set(pos, count);
	}

	let maxCount = -Infinity;
	let maxPos;

	for (const [pos, count] of counts.entries()) {
		if (count > maxCount) {
			maxCount = count;
			maxPos = pos;
		}
	}

	return maxPos;
};

/**
 * Goals
 * QB: 100 per 100 yrs
 * RB: 25 per 100 yrs
 * WR: 50 per 100 yrs
 * TE: 25 per 100 yrs
 * OL: 25 per 100 yrs
 * DL: 50 per 100 yrs
 * LB: 50 per 100 yrs
 * S: 25 per 100 yrs
 * CB: 25 per 100 yrs
 */
export const getThreshold = (pos?: string) => {
	let threshold = 100;

	if (pos === "QB") {
		threshold = 160;
	} else if (pos === "RB") {
		threshold = 80;
	} else if (pos === "WR") {
		threshold = 110;
	} else if (pos === "TE") {
		threshold = 110;
	} else if (pos === "OL") {
		threshold = 70;
	} else if (pos === "DL") {
		threshold = 90;
	} else if (pos === "LB") {
		threshold = 70;
	} else if (pos === "S") {
		threshold = 44;
	} else if (pos === "CB") {
		threshold = 40;
	}

	return threshold;
};

const madeHof = (
	p: Player<PlayerRatings> | PlayerWithoutKey<PlayerRatings>,
): boolean => {
	const avs: number[] = p.stats
		.filter((ps) => {
			// No playoff stats, because AV is scaled strangely there
			return !ps.playoffs;
		})
		.map((ps) => ps.av); // Calculate career WS and "dominance factor" DF (top 5 years WS - 35)

	avs.sort((a, b) => b - a); // Descending order

	let total = 0;
	let df = -35;

	for (const [i, av] of avs.entries()) {
		total += av;

		if (i < 5) {
			df += av;
		}
	}

	// Fudge factor for players generated when the league started
	const fudgeSeasons = g.get("startingSeason") - p.draft.year - 7;

	if (fudgeSeasons > 0 && avs[0] !== undefined) {
		total += avs[0] * fudgeSeasons;
	}

	const pos = getMostCommonPos(p.ratings);
	const threshold = getThreshold(pos);

	// Final formula
	return (
		total + df >
		threshold * helpers.gameAndSeasonLengthScaleFactor() * g.get("hofFactor")
	);
};

export default madeHof;
