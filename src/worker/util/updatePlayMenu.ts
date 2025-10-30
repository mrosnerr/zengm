import {
	PHASE,
	NO_LOTTERY_DRAFT_TYPES,
	bySport,
	ALL_STAR_GAME_ONLY,
} from "../../common/index.ts";
import { draft, season } from "../core/index.ts";
import g from "./g.ts";
import helpers from "./helpers.ts";
import local from "./local.ts";
import lock from "./lock.ts";
import toUI from "./toUI.ts";
import type { Option } from "../../common/types.ts";
import { idb } from "../db/index.ts";

const updatePlayMenu = async () => {
	if (process.env.NODE_ENV === "test") {
		return;
	}

	const autoPlaySeasonsLeft = local.autoPlayUntil
		? local.autoPlayUntil.season - g.get("season")
		: 0;

	const allOptions = {
		stop: {
			label: "Stop",
			key: "s",
		},
		day: {
			label: "One day",
			key: "y",
		},
		week: {
			label: "One week",
			key: "w",
		},
		month: {
			label: "One month",
			key: "m",
		},
		untilAllStarGame: {
			label: `Until All-Star ${ALL_STAR_GAME_ONLY ? "game" : "events"}`,
			key: "a",
		},
		untilTradeDeadline: {
			label: "Until trade deadline",
			key: "r",
		},
		viewAllStar: {
			url: helpers.leagueUrl(
				ALL_STAR_GAME_ONLY ? ["all_star", "teams"] : ["all_star"],
			),
			label: `All-Star ${ALL_STAR_GAME_ONLY ? "teams" : "events"}`,
		},
		viewSlam: {
			url: helpers.leagueUrl(["slam"]),
			label: "Slam dunk contest",
		},
		untilPlayoffs: {
			label: "Until playoffs",
			key: "y",
		},
		untilEndOfRound: {
			label: "Until end of round",
			key: "w",
		},
		untilEndOfPlayIn: {
			label: "Until end of play-in tournament",
			key: "m",
		},
		throughPlayoffs: {
			label: "Through playoffs",
			key: "y",
		},
		dayLive: {
			url: helpers.leagueUrl(["daily_schedule", "today"]),
			label: "One day (live)",
			key: "l",
		},
		weekLive: {
			url: helpers.leagueUrl(["daily_schedule", "today"]),
			label: "One week (live)",
			key: "l",
		},
		viewDraftLottery: {
			url: helpers.leagueUrl(["draft_lottery"]),
			label: "View draft lottery",
		},
		untilDraft: {
			label: "Until draft",
			key: "y",
		},
		onePick: {
			label: "One pick",
		},
		untilYourNextPick: {
			label: "Until your next pick",
		},
		untilEnd: {
			label: "Until end of draft",
		},
		viewDraft: {
			url: helpers.leagueUrl(["draft"]),
			label: "View draft",
		},
		untilResignPlayers: {
			label:
				g.get("salaryCapType") === "hard" || !g.get("draftPickAutoContract")
					? "Re-sign players and sign rookies"
					: "Re-sign players with expiring contracts",
		},
		untilFreeAgency: {
			label: "Until free agency",
			key: "y",
		},
		untilPreseason: {
			label: "Until preseason",
			key: "y",
		},
		untilRegularSeason: {
			label: "Until regular season",
		},
		contractNegotiation: {
			url: helpers.leagueUrl(["negotiation"]),
			label: "Continue contract negotiation",
		},
		contractNegotiationList: {
			url: helpers.leagueUrl(["negotiation"]),
			label: "Continue re-signing players",
		},
		message: {
			url: helpers.leagueUrl(["message"]),
			label: "Read new message",
		},
		newLeague: {
			url: "/new_league",
			label: "Try again in a new league",
		},
		newTeam: {
			url: helpers.leagueUrl(["new_team"]),
			label: "Try again with a new team",
		},
		newTeamGood: {
			url: helpers.leagueUrl(["new_team"]),
			label: "Other teams want to hire you!",
		},
		seasonSummary: {
			url: helpers.leagueUrl(["history"]),
			label: "View season summary",
		},
		stopAuto: {
			label: `Stop auto play (${autoPlaySeasonsLeft} season${
				autoPlaySeasonsLeft === 1 ? "" : "s"
			} left)`,
		},
		expansionDraft: {
			url: helpers.leagueUrl(["expansion_draft"]),
			label: "Continue expansion draft setup",
		},
		autoRelocate: {
			url: helpers.leagueUrl(["auto_relocate"]),
			label: "Vote on proposed team relocation",
		},
		autoExpand: {
			url: helpers.leagueUrl(["auto_expand"]),
			label: "Vote on proposed league expansion",
		},
	} satisfies Record<
		string,
		{
			id?: string;
			label: string;
			url?: string;
			key?: string;
		}
	>;

	let keys: (keyof typeof allOptions)[] = [];

	if (
		g.get("phase") === PHASE.DRAFT ||
		g.get("phase") === PHASE.FANTASY_DRAFT ||
		g.get("phase") === PHASE.EXPANSION_DRAFT
	) {
		const draftPicks = await draft.getOrder();
		const nextPick = draftPicks[0];

		if (
			nextPick &&
			g.get("userTids").includes(nextPick.tid) &&
			!g.get("spectator")
		) {
			keys = ["viewDraft"];
		} else if (draftPicks.some((dp) => g.get("userTids").includes(dp.tid))) {
			keys = ["onePick", "untilYourNextPick", "viewDraft"];
		} else {
			keys = ["onePick", "untilEnd", "viewDraft"];
		}
	} else if (g.get("phase") === PHASE.PRESEASON) {
		// Preseason
		keys = ["untilRegularSeason"];
	} else if (
		g.get("phase") === PHASE.REGULAR_SEASON ||
		g.get("phase") === PHASE.AFTER_TRADE_DEADLINE
	) {
		const untilMore: typeof keys = [];

		const schedule = await season.getSchedule();
		const tradeDeadlineIndex = schedule.findIndex(
			(game) => game.awayTid === -3 && game.homeTid === -3,
		);
		const allStarIndex = schedule.findIndex(
			(game) => game.awayTid === -2 && game.homeTid === -1,
		);

		// > rather than >= because if it's the next game already, no need to "play until"
		if (tradeDeadlineIndex > 0 && allStarIndex > 0) {
			if (tradeDeadlineIndex < allStarIndex) {
				untilMore.push("untilTradeDeadline", "untilAllStarGame");
			} else {
				untilMore.push("untilAllStarGame", "untilTradeDeadline");
			}
		} else if (tradeDeadlineIndex > 0) {
			untilMore.push("untilTradeDeadline");
		} else if (allStarIndex > 0) {
			untilMore.push("untilAllStarGame");
		}

		// Regular season - pre trading deadline
		keys = bySport<typeof keys>({
			football: ["week", "weekLive", "month", ...untilMore, "untilPlayoffs"],
			default: [
				"day",
				"dayLive",
				"week",
				"month",
				...untilMore,
				"untilPlayoffs",
			],
		});

		if (allStarIndex === 0) {
			keys.unshift("viewAllStar");
		}
	} else if (g.get("phase") === PHASE.PLAYOFFS) {
		// Playoffs
		if (
			bySport({
				baseball: true,
				basketball: true,
				football: false,
				hockey: true,
			})
		) {
			keys = [
				"day",
				"dayLive",
				"untilEndOfRound",
				"untilEndOfPlayIn",
				"throughPlayoffs",
			];
		} else {
			keys = [
				"week",
				"weekLive",
				"untilEndOfRound",
				"untilEndOfPlayIn",
				"throughPlayoffs",
			];
		}

		// If playoff contains no rounds with more than one game, then untilEndOfRound is not needed
		const maxGames = Math.max(...g.get("numGamesPlayoffSeries", "current"));
		if (maxGames <= 1) {
			keys = keys.filter((key) => key !== "untilEndOfRound");
		}

		if (g.get("playIn")) {
			const playoffSeries = await idb.cache.playoffSeries.get(g.get("season"));
			if (!playoffSeries || playoffSeries.currentRound > -1) {
				keys = keys.filter((key) => key !== "untilEndOfPlayIn");
			}
		} else {
			keys = keys.filter((key) => key !== "untilEndOfPlayIn");
		}

		const schedule = await season.getSchedule();
		const allStarIndex = schedule.findIndex(
			(game) => game.awayTid === -2 && game.homeTid === -1,
		);
		if (allStarIndex === 0) {
			keys.unshift("viewAllStar");
		}
	} else if (g.get("phase") === PHASE.DRAFT_LOTTERY) {
		const repeatSeasonType = g.get("repeatSeason")?.type;
		if (
			repeatSeasonType === "playersAndRosters" ||
			g.get("forceHistoricalRosters")
		) {
			keys = ["untilPreseason"];
		} else {
			if (
				g.get("draftType") === "freeAgents" ||
				repeatSeasonType === "players"
			) {
				// For draftType freeAgents - special case in actions.ts will call the draft phases before this automatically
				// For repeatSeasonType players - there is no draft
				keys = ["untilResignPlayers"];
			} else {
				// Offseason - pre draft
				keys = !NO_LOTTERY_DRAFT_TYPES.includes(g.get("draftType"))
					? ["viewDraftLottery", "untilDraft"]
					: ["untilDraft"];
			}

			if (g.get("otherTeamsWantToHire")) {
				keys.push("newTeamGood");
			}
		}
	} else if (g.get("phase") === PHASE.AFTER_DRAFT) {
		// Offseason - post draft
		keys = ["untilResignPlayers"];
	} else if (g.get("phase") === PHASE.RESIGN_PLAYERS) {
		// Offseason - re-sign players
		keys = ["contractNegotiationList", "untilFreeAgency"];
	} else if (g.get("phase") === PHASE.FREE_AGENCY) {
		// Offseason - free agency
		keys = ["day", "week", "untilPreseason"];
	}

	const unreadMessage = await lock.unreadMessage();
	const negotiationInProgress = await lock.negotiationInProgress();

	if (g.get("autoRelocate")) {
		keys = ["autoRelocate"];
	}

	if (g.get("autoExpand")) {
		keys = ["autoExpand"];
	}

	if (g.get("expansionDraft").phase === "protection") {
		keys = ["expansionDraft"];
	}

	if (unreadMessage) {
		keys = ["message"];
	}

	if (local.unviewedSeasonSummary) {
		keys = ["seasonSummary"];
	}

	if (lock.get("gameSim")) {
		keys = ["stop"];
	}

	// AFTER_DRAFT check is because if there is any negotiation then, it's very likely because a prior advance to RESIGN_PLAYERS failed after starting negotiations with some players, in which case we'd rather not block the UI in the case that advancing again somehow succeeds. (Would rather have phase updates be transactional, but oh well.)
	if (
		negotiationInProgress &&
		g.get("phase") !== PHASE.RESIGN_PLAYERS &&
		g.get("phase") !== PHASE.AFTER_DRAFT
	) {
		keys = ["contractNegotiation"];
	}

	if (lock.get("newPhase")) {
		keys = [];
	}

	// If there is an unread message, it's from the owner saying the player is fired, so let the user see that first.
	if (g.get("gameOver") && !unreadMessage) {
		keys = ["newTeam", "newLeague"];
	}

	if (local.autoPlayUntil) {
		keys = ["stopAuto"];
	}

	const someOptions: Option[] = keys.map((id) => {
		let code;
		// @ts-expect-error
		if (allOptions[id].key) {
			// @ts-expect-error
			code = `Key${allOptions[id].key.toUpperCase()}`;
		}

		return {
			...allOptions[id],
			code,
			id,
		};
	});

	// Set first key to always be p
	if (someOptions[0]) {
		someOptions[0].key = "p";
		someOptions[0].code = "KeyP";
	}

	toUI("updateLocal", [
		{
			playMenuOptions: someOptions,
		},
	]);
};

export default updatePlayMenu;
