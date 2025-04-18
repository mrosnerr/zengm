import { assert, test } from "vitest";
import { PHASE } from "../../../common/index.ts";
import getLeagueInfo from "./getLeagueInfo.ts";

test("returns correct number of teams", async () => {
	assert.strictEqual(
		(
			await getLeagueInfo({
				type: "real",
				season: 1956,
				phase: PHASE.PRESEASON,
				randomDebuts: false,
				randomDebutsKeepCurrent: false,
				realDraftRatings: "rookie",
				realStats: "none",
				includePlayers: true,
			})
		).teams.length,
		8,
	);

	assert.strictEqual(
		(
			await getLeagueInfo({
				type: "real",
				season: 2021,
				phase: PHASE.PRESEASON,
				randomDebuts: false,
				randomDebutsKeepCurrent: false,
				realDraftRatings: "rookie",
				realStats: "none",
				includePlayers: true,
			})
		).teams.length,
		30,
	);
});

test("returns correct number of teams after an expansion draft", async () => {
	assert.strictEqual(
		(
			await getLeagueInfo({
				type: "real",
				season: 2004,
				phase: PHASE.PRESEASON,
				randomDebuts: false,
				randomDebutsKeepCurrent: false,
				realDraftRatings: "rookie",
				realStats: "none",
				includePlayers: true,
			})
		).teams.length,
		29,
	);
	assert.strictEqual(
		(
			await getLeagueInfo({
				type: "real",
				season: 2004,
				phase: PHASE.DRAFT_LOTTERY,
				randomDebuts: false,
				randomDebutsKeepCurrent: false,
				realDraftRatings: "rookie",
				realStats: "none",
				includePlayers: true,
			})
		).teams.length,
		30,
	);
});

test("returns correct number of teams after contraction", async () => {
	assert.strictEqual(
		(
			await getLeagueInfo({
				type: "real",
				season: 1950,
				phase: PHASE.PRESEASON,
				randomDebuts: false,
				randomDebutsKeepCurrent: false,
				realDraftRatings: "rookie",
				realStats: "none",
				includePlayers: true,
			})
		).teams.length,
		17,
	);
	assert.strictEqual(
		(
			await getLeagueInfo({
				type: "real",
				season: 1950,
				phase: PHASE.DRAFT_LOTTERY,
				randomDebuts: false,
				randomDebutsKeepCurrent: false,
				realDraftRatings: "rookie",
				realStats: "none",
				includePlayers: true,
			})
		).teams.length,
		11,
	);
});
