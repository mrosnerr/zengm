import { PLAYER, PHASE } from "../../common/index.ts";
import { finances, player } from "../core/index.ts";
import { idb } from "../db/index.ts";
import { face, g } from "../util/index.ts";
import type {
	UpdateEvents,
	ViewInput,
	PlayerWithoutKey,
	Player,
} from "../../common/types.ts";
import { orderBy } from "../../common/utils.ts";

export const formatPlayerRelativesList = (p: Player) => {
	const firstSeason = p.ratings[0].season as number;
	const lastSeason = p.ratings.at(-1)!.season as number;

	return {
		pid: p.pid,
		firstName: p.firstName,
		lastName: p.lastName,
		firstSeason,
		lastSeason,
	};
};

export const finalizePlayersRelativesList = (
	players: ReturnType<typeof formatPlayerRelativesList>[],
) => {
	return orderBy(players, [
		"lastName",
		"firstName",
		"firstSeason",
		"lastSeason",
	]);
};

let faceCount = 0;

const updateCustomizePlayer = async (
	inputs: ViewInput<"customizePlayer">,
	updateEvents: UpdateEvents,
) => {
	if (!g.get("godMode") && inputs.pid === null) {
		// https://stackoverflow.com/a/59923262/786644
		const returnValue = {
			errorMessage: "You can't create new players unless you enable God Mode.",
		};
		return returnValue;
	}

	if (updateEvents.includes("firstRun")) {
		const teams = (await idb.cache.teams.getAll())
			.filter((t) => !t.disabled)
			.map((t) => {
				return {
					tid: t.tid,
					text: `${t.region} ${t.name}`,
				};
			});

		let appearanceOption;
		let originalTid;

		let p: PlayerWithoutKey;
		if (inputs.pid === null) {
			// Generate new player as basis
			const scoutingLevel = await finances.getLevelLastThree("scouting", {
				tid: g.get("userTid"),
			});
			const name = await player.name();
			p = player.generate(
				PLAYER.FREE_AGENT,
				20,
				g.get("phase") <= PHASE.PLAYOFFS
					? g.get("season") - 1
					: g.get("season"),
				false,
				scoutingLevel,
				name,
			);
			appearanceOption = "Cartoon Face";
			p.imgURL = "http://";
		} else {
			// Load a player to edit
			const p2 = await idb.getCopy.players({
				pid: inputs.pid,
			});

			if (!p2) {
				// https://stackoverflow.com/a/59923262/786644
				const returnValue = {
					errorMessage: "Player not found.",
				};
				return returnValue;
			}

			p = p2;

			await face.upgrade(p);

			if (p.imgURL.length > 0) {
				appearanceOption = "Image URL";
			} else {
				appearanceOption = "Cartoon Face";
				p.imgURL = "http://";
			}

			originalTid = p.tid;

			if (inputs.type === "clone") {
				delete p.pid;
				p.awards = [];
				p.stats = [];
				p.draft = {
					...p.draft,
					round: 0,
					pick: 0,
					tid: -1,
					originalTid: -1,
					pot: 0,
					ovr: 0,
					skills: [],
				};
				p.salaries = p.salaries.filter((row) => row.season >= g.get("season"));
			}
		}

		const currentPlayers = await idb.cache.players.getAll();
		const pids = new Set(currentPlayers.map((p) => p.pid));

		for (const relative of p.relatives) {
			if (!pids.has(relative.pid)) {
				const pRelative = await idb.getCopy.players(
					{ pid: relative.pid },
					"noCopyCache",
				);
				if (pRelative) {
					currentPlayers.push(pRelative);
				}
			}
		}

		const playersRelativesList = finalizePlayersRelativesList(
			currentPlayers.map(formatPlayerRelativesList),
		);

		const initialAutoPos = player.pos(p.ratings.at(-1));

		faceCount += 1;

		return {
			appearanceOption,
			challengeNoRatings: g.get("challengeNoRatings"),
			faceCount,
			gender: g.get("gender"),
			godMode: g.get("godMode"),
			initialAutoPos,
			minContract: g.get("minContract"),
			originalTid,
			p,
			playerMoodTraits: g.get("playerMoodTraits"),
			playersRelativesList,
			phase: g.get("phase"),
			season: g.get("season"),
			teams,
		};
	}
};

export default updateCustomizePlayer;
