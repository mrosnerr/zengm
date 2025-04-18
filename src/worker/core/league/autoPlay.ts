import { PHASE } from "../../../common/index.ts";
import {
	draft,
	freeAgents,
	game,
	phase,
	season,
	expansionDraft,
	team,
} from "../index.ts";
import { g, random } from "../../util/index.ts";
import type { Conditions } from "../../../common/types.ts";
import { idb } from "../../db/index.ts";

// Depending on phase, initiate action that will lead to the next phase
const autoPlay = async (conditions: Conditions = {}) => {
	let currentPhase = g.get("phase");

	// No newPhase call is triggered after expansion/fantasy draft, so this check comes first
	if (currentPhase === PHASE.EXPANSION_DRAFT) {
		if (g.get("expansionDraft").phase === "protection") {
			await expansionDraft.start();
		}
		if (g.get("expansionDraft").phase === "draft") {
			await draft.runPicks({ type: "untilEnd" }, conditions);
		}
	} else if (currentPhase === PHASE.FANTASY_DRAFT) {
		await draft.runPicks({ type: "untilEnd" }, conditions);
	}

	// If game over and user's team is disabled, need to pick a new team or there will be errors
	if (g.get("gameOver")) {
		const t = await idb.cache.teams.get(g.get("userTid"));
		if (!t || t.disabled) {
			// If multi team mode was enabled, a new team would have already been picked in team.disable(). So go with a random team here.
			const teams = (await idb.cache.teams.getAll()).filter((t) => !t.disabled);
			if (teams.length === 0) {
				throw new Error("No active teams");
			}
			await team.switchTo(random.choice(teams).tid);
		}
	}

	const autoRelocate = g.get("autoRelocate");
	if (autoRelocate) {
		await team.relocateVote({
			override: false,
			realign: g.get("autoRelocateRealign"),
			rebrandTeam: g.get("autoRelocateRebrand"),
			userVote: Math.random() < 0.5,
		});
	}

	const autoExpand = g.get("autoExpand");
	if (autoExpand) {
		await team.expandVote(
			{
				override: false,
				userVote: Math.random() < 0.5,
			},
			conditions,
		);
	}

	// In case anything above changed it
	currentPhase = g.get("phase");

	if (currentPhase === PHASE.PRESEASON) {
		await phase.newPhase(PHASE.REGULAR_SEASON, conditions);
	} else if (
		currentPhase === PHASE.REGULAR_SEASON ||
		currentPhase === PHASE.AFTER_TRADE_DEADLINE
	) {
		const numDays = await season.getDaysLeftSchedule();
		await game.play(numDays, conditions);
	} else if (currentPhase === PHASE.PLAYOFFS) {
		await game.play(100, conditions);
	} else if (currentPhase === PHASE.DRAFT_LOTTERY) {
		const type = g.get("repeatSeason")?.type;
		if (type === "playersAndRosters") {
			await phase.newPhase(PHASE.PRESEASON, conditions);
		} else if (type === "players") {
			await phase.newPhase(PHASE.RESIGN_PLAYERS, conditions);
		} else {
			await phase.newPhase(PHASE.DRAFT, conditions);
		}
	} else if (currentPhase === PHASE.DRAFT) {
		if (g.get("draftType") === "freeAgents") {
			await phase.newPhase(PHASE.AFTER_DRAFT, conditions);
		} else {
			await draft.runPicks({ type: "untilEnd" }, conditions);
		}
	} else if (currentPhase === PHASE.AFTER_DRAFT) {
		await phase.newPhase(PHASE.RESIGN_PLAYERS, conditions);
	} else if (currentPhase === PHASE.RESIGN_PLAYERS) {
		await phase.newPhase(PHASE.FREE_AGENCY, conditions);
	} else if (currentPhase === PHASE.FREE_AGENCY) {
		// Purposely call without await, to break up the promise chain. Otherwise (at least in Chrome 85) causes a memory leak after playing like 50 seasons.
		freeAgents.play(g.get("daysLeft"), conditions);
	} else {
		throw new Error(`Unknown phase: ${currentPhase}`);
	}
};

export default autoPlay;
