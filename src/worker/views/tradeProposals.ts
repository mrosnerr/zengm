import { idb } from "../db/index.ts";
import { g, helpers, random } from "../util/index.ts";
import type { TradeTeams, UpdateEvents } from "../../common/types.ts";
import isUntradable from "../core/trade/isUntradable.ts";
import makeItWork from "../core/trade/makeItWork.ts";
import summary from "../core/trade/summary.ts";
import { augmentOffers } from "../api/index.ts";

const getOffers = async (seed: number) => {
	const NUM_OFFERS = 5;
	const NUM_TRIES_PER_TEAM = 10;

	const userTid = g.get("userTid");

	const teams = (await idb.cache.teams.getAll()).filter(
		(t) => !t.disabled && t.tid !== userTid,
	);
	random.shuffle(teams, seed);

	const players = (
		await idb.cache.players.indexGetAll("playersByTid", userTid)
	).filter((p) => !isUntradable(p).untradable);
	const draftPicks = await idb.cache.draftPicks.indexGetAll(
		"draftPicksByTid",
		userTid,
	);

	if (players.length === 0 && draftPicks.length === 0) {
		return [];
	}

	const offers: TradeTeams[] = [];

	const valueChangeKey = Math.random();

	for (const t of teams) {
		for (let i = 0; i < NUM_TRIES_PER_TEAM; i++) {
			const seedBase = seed + NUM_TRIES_PER_TEAM * t.tid + i;
			const r = random.uniformSeed(seedBase);
			const pids: number[] = [];
			const dpids: number[] = [];

			if ((r < 0.7 || draftPicks.length === 0) && players.length > 0) {
				// Weight by player value - good player more likely to be in trade
				pids.push(random.choice(players, (p) => p.value, seedBase + 1).pid);
			} else if ((r < 0.85 || players.length === 0) && draftPicks.length > 0) {
				dpids.push(random.choice(draftPicks, undefined, seedBase + 2).dpid);
			} else {
				pids.push(random.choice(players, (p) => p.value, seedBase + 3).pid);
				dpids.push(random.choice(draftPicks, undefined, seedBase + 4).dpid);
			}

			const teams0: TradeTeams = [
				{
					dpids,
					dpidsExcluded: [],
					pids,
					pidsExcluded: [],
					tid: userTid,
				},
				{
					dpids: [],
					dpidsExcluded: [],
					pids: [],
					pidsExcluded: [],
					tid: t.tid,
				},
			];

			const teams = await makeItWork(teams0, {
				holdUserConstant: false,
				maxAssetsToAdd: 5,
				valueChangeKey,
			});

			if (!teams) {
				continue;
			}

			// Don't do trades of just picks, it's weird usually
			if (teams[0].pids.length === 0 && teams[1].pids.length === 0) {
				continue;
			}

			// Don't do trades for nothing, it's weird usually
			if (teams[1].pids.length === 0 && teams[1].dpids.length === 0) {
				continue;
			}

			const tradeSummary = await summary(teams);

			// Try to find a no warning one
			if (tradeSummary.warning && i < NUM_TRIES_PER_TEAM - 1) {
				continue;
			}

			offers.push(teams);
			break;
		}

		if (offers.length >= NUM_OFFERS) {
			break;
		}
	}

	return augmentOffers(offers);
};

// offers[number].summary.trade includes players with no stats, and offers[number].players includes players with stats. Make them the same. Plus ratings and age!
export const fixPlayers = (
	offer: Awaited<ReturnType<typeof getOffers>>[number],
	summaryTeamsIndex: number,
	playersWithStats: any[],
) => {
	const t = offer.summary.teams[summaryTeamsIndex];
	if (!t) {
		throw new Error("Should never happen");
	}

	for (const p of t.trade) {
		const p2 = playersWithStats.find((p2) => p2.pid === p.pid);
		p.stats = p2.stats;
		p.ratings = p2.ratings;
		p.age = p2.age;
	}
};

const updateTradeProposals = async (
	inputs: unknown,
	updateEvents: UpdateEvents,
) => {
	if (
		updateEvents.includes("firstRun") ||
		updateEvents.includes("playerMovement") ||
		updateEvents.includes("gameSim") ||
		updateEvents.includes("newPhase") ||
		updateEvents.includes("g.tradeProposalsSeed")
	) {
		const teamSeason = await idb.cache.teamSeasons.indexGet(
			"teamSeasonsByTidSeason",
			[g.get("userTid"), g.get("season")],
		);
		const gp = teamSeason ? helpers.getTeamSeasonGp(teamSeason) : 0;

		const NUM_GAMES_BEFORE_NEW_OFFERS = 10;

		const seed =
			Math.floor(gp / NUM_GAMES_BEFORE_NEW_OFFERS) +
			g.get("season") +
			g.get("phase") +
			g.get("tradeProposalsSeed");

		const offers = await getOffers(seed);

		for (const offer of offers) {
			fixPlayers(offer, 1, offer.players);
			fixPlayers(offer, 0, offer.playersUser);
		}

		return {
			challengeNoRatings: g.get("challengeNoRatings"),
			challengeNoTrades: g.get("challengeNoTrades"),
			gameOver: g.get("gameOver"),
			luxuryPayroll: g.get("luxuryPayroll"),
			luxuryTax: g.get("luxuryTax"),
			offers,
			phase: g.get("phase"),
			salaryCap: g.get("salaryCap"),
			salaryCapType: g.get("salaryCapType"),
			spectator: g.get("spectator"),
		};
	}
};

export default updateTradeProposals;
