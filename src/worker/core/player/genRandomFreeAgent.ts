import type { Player } from "../../../common/types.ts";
import { random, g } from "../../util/index.ts";
import develop from "./develop.ts";
import generate from "./generate.ts";
import { PHASE, PLAYER } from "../../../common/index.ts";
import { idb } from "../../db/index.ts";
import name from "./name.ts";
import { DEFAULT_LEVEL } from "../../../common/budgetLevels.ts";

const genRandomFreeAgent = async (): Promise<Player> => {
	let minAge = 25;
	let maxAge = 31;

	// Adjust for age limits
	const forceRetireAge = g.get("forceRetireAge");
	const draftAges = g.get("draftAges");

	const offset = g.get("phase") > PHASE.REGULAR_SEASON ? 0 : 1;

	if (
		forceRetireAge > minAge ||
		forceRetireAge > maxAge ||
		(forceRetireAge < maxAge && forceRetireAge >= draftAges[1])
	) {
		minAge = draftAges[1] + offset;
		maxAge = forceRetireAge - 1 + offset;
	} else if (draftAges[0] > minAge) {
		minAge = draftAges[0] + offset;
		if (maxAge > forceRetireAge) {
			maxAge = forceRetireAge - 1 + offset;
		}
		if (minAge > maxAge) {
			maxAge = draftAges[1] + offset;
		}
	}

	for (let i = 0; i < 1000; i++) {
		const age = random.randInt(minAge, maxAge);
		const draftYear = g.get("season") - (age - 22);
		const p = generate(
			PLAYER.FREE_AGENT,
			age,
			draftYear,
			false,
			DEFAULT_LEVEL,
			await name(),
		);
		p.ratings[0].season = g.get("season"); // HACK!!!
		await develop(p, 0);
		if (p.ratings[0].ovr <= 40) {
			await idb.cache.players.add(p); // Create pid
			return p as Player;
		}
	}

	throw new Error("genRandomFreeAgent failed");
};

export default genRandomFreeAgent;
