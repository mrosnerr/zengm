import { idb } from "../../db/index.ts";

/**
 * Remove all players currently added to the trade.
 *
 * @memberOf core.trade
 * @return {Promise}
 */
const clear = async (
	type: "all" | "other" | "user" | "keepUntradeable" = "all",
) => {
	const tr = await idb.cache.trade.get(0);

	if (tr) {
		for (const [i, t] of tr.teams.entries()) {
			const clearPlayers =
				type === "all" ||
				(type === "user" && i === 0) ||
				(type === "other" && i === 1) ||
				type === "keepUntradeable";

			if (clearPlayers) {
				t.pids = [];
				t.dpids = [];
				if (type !== "keepUntradeable") {
					t.pidsExcluded = [];
					t.dpidsExcluded = [];
				}
			}
		}

		await idb.cache.trade.put(tr);
	}
};

export default clear;
