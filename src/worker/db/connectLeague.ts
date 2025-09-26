import { unwrap } from "@dumbmatter/idb";
import {
	DEFAULT_PLAY_THROUGH_INJURIES,
	DEFAULT_STADIUM_CAPACITY,
	DEFAULT_TEAM_COLORS,
	DIFFICULTY,
	gameAttributesArrayToObject,
	isSport,
	LEAGUE_DATABASE_VERSION,
	PHASE,
	PLAYER,
	unwrapGameAttribute,
} from "../../common/index.ts";
import { player, season } from "../core/index.ts";
import { idb } from "./index.ts";
import { defaultGameAttributes, helpers, logEvent } from "../util/index.ts";
import connectIndexedDB from "./connectIndexedDB.ts";
import type {
	DBSchema,
	IDBPDatabase,
	IDBPTransaction,
	StoreNames,
} from "@dumbmatter/idb";
import type {
	DraftLotteryResult,
	ReleasedPlayer,
	AllStars,
	EventBBGM,
	GameAttribute,
	Game,
	Message,
	Negotiation,
	PlayerFeat,
	Player,
	MinimalPlayerRatings,
	PlayoffSeries,
	ScheduleGame,
	TeamSeason,
	TeamStats,
	Team,
	Trade,
	ScheduledEvent,
	HeadToHead,
	DraftPick,
	SeasonLeaders,
	GameAttributeWithHistory,
	GameAttributesLeagueWithHistory,
	SavedTrade,
	SavedTradingBlock,
} from "../../common/types.ts";
import getInitialNumGamesConfDivSettings from "../core/season/getInitialNumGamesConfDivSettings.ts";
import { amountToLevel } from "../../common/budgetLevels.ts";
import { orderBy } from "../../common/utils.ts";
import { actualPhase } from "../util/actualPhase.ts";

export interface LeagueDB extends DBSchema {
	allStars: {
		key: number;
		value: AllStars;
	};
	awards: {
		key: number;
		value: any;
	};
	draftLotteryResults: {
		key: number;
		value: DraftLotteryResult;
	};
	draftPicks: {
		key: number;
		value: DraftPick;
		autoIncrementKeyPath: "dpid";
	};
	events: {
		key: number;
		value: EventBBGM;
		autoIncrementKeyPath: "eid";
		indexes: {
			dpids: number;
			pids: number;
			season: number;
		};
	};
	gameAttributes: {
		key: string;
		value: GameAttribute<any>;
	};
	games: {
		key: number;
		value: Game;
		indexes: {
			noteBool: 1;
			season: number;
		};
	};
	headToHeads: {
		key: number;
		value: HeadToHead;
	};
	messages: {
		key: number;
		value: Message;
		autoIncrementKeyPath: "mid";
	};
	negotiations: {
		key: number;
		value: Negotiation;
	};
	playerFeats: {
		key: number;
		value: PlayerFeat;
		autoIncrementKeyPath: "fid";
	};
	players: {
		key: number;
		value: Player<MinimalPlayerRatings>;
		autoIncrementKeyPath: "pid";
		indexes: {
			"draft.year, retiredYear": [number, number];
			hof: 1;
			noteBool: 1;
			srID: string;
			statsTids: number;
			tid: number;
			watch: 1;
		};
	};
	playoffSeries: {
		key: number;
		value: PlayoffSeries;
	};
	releasedPlayers: {
		key: number;
		value: ReleasedPlayer;
		autoIncrementKeyPath: "rid";
	};
	savedTrades: {
		key: string;
		value: SavedTrade;
	};
	savedTradingBlock: {
		key: 0;
		value: SavedTradingBlock;
	};
	schedule: {
		key: number;
		value: ScheduleGame;
		autoIncrementKeyPath: "gid";
	};
	scheduledEvents: {
		key: number;
		value: ScheduledEvent;
		autoIncrementKeyPath: "id";
		indexes: {
			season: number;
		};
	};
	seasonLeaders: {
		key: number;
		value: SeasonLeaders;
	};
	teamSeasons: {
		key: number;
		value: TeamSeason;
		autoIncrementKeyPath: "rid";
		indexes: {
			"season, tid": [number, number];
			"tid, season": [number, number];
			noteBool: 1;
		};
	};
	teamStats: {
		key: number;
		value: TeamStats;
		autoIncrementKeyPath: "rid";
		indexes: {
			"season, tid": [number, number];
			tid: number;
		};
	};
	teams: {
		key: number;
		value: Team;
	};
	trade: {
		key: 0;
		value: Trade;
	};
}

export type LeagueDBStoreNames = StoreNames<LeagueDB>;

type VersionChangeTransaction = IDBPTransaction<
	LeagueDB,
	LeagueDBStoreNames[],
	"versionchange"
>;

// I did it this way (with the raw IDB API) because I was afraid it would read all players into memory before getting
// the stats and writing them back to the database. Promises/async/await would help, but Firefox before 60 does not like
// that.
const upgrade29 = (tx: IDBTransaction) => {
	let lastCentury = 0; // Iterate over players

	tx.objectStore("players").openCursor().onsuccess = (event: any) => {
		const cursor = event.target.result;

		if (cursor) {
			const p = cursor.value;

			if (!Array.isArray(p.relatives)) {
				p.relatives = [];
			}

			// This can be really slow, so need some UI for progress
			const century = Math.floor(p.draft.year / 100);

			if (century > lastCentury) {
				const text = `Upgrading players drafted in the ${century}00s...`;
				logEvent({
					type: "upgrade",
					text,
					saveToDb: false,
				});
				console.log(text);
				lastCentury = century;
			}

			tx
				.objectStore("playerStats")
				.index("pid, season, tid")
				.getAll(IDBKeyRange.bound([p.pid], [p.pid, ""])).onsuccess = (
				event2: any,
			) => {
				// Index brings them back maybe out of order
				p.stats = orderBy(event2.target.result as any[], [
					"season",
					"playoffs",
					"psid",
				]);
				cursor.update(p);
				cursor.continue();
			};
		} else {
			// This seems to trigger a memory leak in Chrome, so leave playerStats behind...
			// tx.db.deleteObjectStore("playerStats");
		}
	};
};

const upgrade31 = (tx: IDBTransaction) => {
	tx.objectStore("gameAttributes").get("season").onsuccess = (event: any) => {
		if (event.target.result === undefined) {
			throw new Error("Missing season in gameAttributes during upgrade");
		}

		const season = event.target.result.value;

		if (typeof season !== "number") {
			throw new Error("Invalid season in gameAttributes during upgrade");
		}

		tx.objectStore("gameAttributes").get("phase").onsuccess = (event2: any) => {
			if (event2.target.result === undefined) {
				throw new Error("Missing phase in gameAttributes during upgrade");
			}

			const phase = event2.target.result.value;

			if (typeof phase !== "number") {
				throw new Error("Invalid phase in gameAttributes during upgrade");
			}

			tx.objectStore("draftOrder").get(0).onsuccess = (event3: any) => {
				if (event3.target.result === undefined) {
					throw new Error(
						"Missing draftOrder in gameAttributes during upgrade",
					);
				}

				const draftOrder = event3.target.result.draftOrder;

				if (!Array.isArray(draftOrder)) {
					throw new Error(
						"Invalid draftOrder in gameAttributes during upgrade",
					);
				}

				tx.objectStore("draftPicks").openCursor().onsuccess = (event4: any) => {
					const cursor = event4.target.result;

					if (cursor) {
						const dp = cursor.value;
						dp.pick = 0;
						cursor.update(dp);
						cursor.continue();
					} else {
						for (const dp2 of draftOrder) {
							if (phase === PHASE.FANTASY_DRAFT) {
								dp2.season = "fantasy";
							} else {
								dp2.season = season;
							}

							tx.objectStore("draftPicks").put(dp2);
						}
					}
				};
			};
		};
	};
};

const upgrade33 = (transaction: VersionChangeTransaction) => {
	const tx = unwrap(transaction);
	tx.objectStore("gameAttributes").get("season").onsuccess = (event: any) => {
		if (event.target.result === undefined) {
			throw new Error("Missing season in gameAttributes during upgrade");
		}

		const season = event.target.result.value;

		if (typeof season !== "number") {
			throw new Error("Invalid season in gameAttributes during upgrade");
		}

		tx.objectStore("gameAttributes").get("phase").onsuccess = async (
			event2: any,
		) => {
			if (event2.target.result === undefined) {
				throw new Error("Missing phase in gameAttributes during upgrade");
			}

			const phase = event2.target.result.value;

			if (typeof phase !== "number") {
				throw new Error("Invalid phase in gameAttributes during upgrade");
			}

			const offset = phase >= PHASE.RESIGN_PLAYERS ? 1 : 0;
			for await (const cursor of transaction.objectStore("players")) {
				const p = cursor.value;
				if (p.tid === PLAYER.UNDRAFTED) {
					const draftYear = season + offset;

					if (p.ratings[0].season !== draftYear || p.draft.year !== draftYear) {
						p.ratings[0].season = draftYear;
						p.draft.year = draftYear;
						await cursor.update(p);
					}
				} else if (p.tid === PLAYER.UNDRAFTED_2) {
					p.tid = PLAYER.UNDRAFTED;
					p.ratings[0].season = season + 1 + offset;
					p.draft.year = p.ratings[0].season;
					await cursor.update(p);
				} else if (p.tid === PLAYER.UNDRAFTED_3) {
					p.tid = PLAYER.UNDRAFTED;
					p.ratings[0].season = season + 2 + offset;
					p.draft.year = p.ratings[0].season;
					await cursor.update(p);
				}
			}
		};
	};
};

const upgrade38 = (transaction: VersionChangeTransaction) => {
	const tx = unwrap(transaction);
	const scheduleStore = tx.objectStore("schedule");
	scheduleStore.getAll().onsuccess = (event: any) => {
		const schedule = event.target.result;

		const updated = season.addDaysToSchedule(schedule);

		scheduleStore.clear().onsuccess = () => {
			for (const game of updated) {
				scheduleStore.put(game);
			}
		};
	};
};

const upgrade45 = (transaction: VersionChangeTransaction) => {
	const tx = unwrap(transaction);

	const gameAttributesStore = tx.objectStore("gameAttributes");

	gameAttributesStore.getAll().onsuccess = (event: any) => {
		const gameAttributes = gameAttributesArrayToObject(event.target.result);

		const settings = {
			divs: unwrapGameAttribute(gameAttributes, "divs"),
			numGames: gameAttributes.numGames,
			numGamesConf: defaultGameAttributes.numGamesConf,
			numGamesDiv: defaultGameAttributes.numGamesDiv,
		};

		tx.objectStore("teams").getAll().onsuccess = (event2: any) => {
			const teams = event2.target.result;

			let numGamesDiv = null;
			let numGamesConf = null;

			try {
				const response = getInitialNumGamesConfDivSettings(teams, settings);
				numGamesDiv = response.numGamesDiv;
				numGamesConf = response.numGamesConf;
			} catch (error) {
				console.error(error);
			}

			gameAttributesStore.put({
				key: "numGamesDiv",
				value: numGamesDiv,
			});

			gameAttributesStore.put({
				key: "numGamesConf",
				value: numGamesConf,
			});
		};
	};
};

export const upgradeGamesVersion65 = async ({
	transaction,
	stopIfTooMany,
	lid,
}: {
	transaction: IDBPTransaction<
		LeagueDB,
		("games" | "playerFeats" | "playoffSeries")[],
		"readwrite"
	>;
	stopIfTooMany: boolean;
	lid: number;
}) => {
	const gamesStore = transaction.objectStore("games");

	// cursor is null if there are no saved box scores. Using IDBObjectStore.count() is slower if there are a lot of games
	const cursor = await gamesStore.openKeyCursor();
	if (!cursor) {
		return;
	}

	const LIMIT_PLAYOFF_SERIES = 1000;
	const LIMIT_PLAYER_FEATS = 10000;

	const tooMany = async () => {
		logEvent({
			type: "error",
			text: `<div class="mt-2">League upgrade is taking too long, so skipping some stuff doesn't matter unless you want to save box scores from finals games or games with statistical feats.</div><div class="mt-2">If you want to finish the upgrade and use those features, <a href="/l/${lid}/upgrade65">click here</a>.</div>`,
			saveToDb: false,
			persistent: true,
		});
	};

	// Add finals to game objects
	let countPlayoffSeries = 0;
	for await (const { value: playoffSeries } of transaction.objectStore(
		"playoffSeries",
	)) {
		if (stopIfTooMany) {
			countPlayoffSeries += 1;
			if (countPlayoffSeries >= LIMIT_PLAYOFF_SERIES) {
				tooMany();
				return;
			}
		}

		const lastRound = playoffSeries.series.at(-1);

		// Finals is the only one where there is only one series in the round
		const finalsSeries = lastRound?.[0];
		if (finalsSeries) {
			const gids = finalsSeries.gids;
			if (gids) {
				for (const gid of gids) {
					const game = await gamesStore.get(gid);
					if (game && !game.finals) {
						game.finals = true;
						await gamesStore.put(game);
					}
				}
			}
		}
	}

	// Add playerFeat to game objects
	let countPlayerFeats = 0;
	for await (const { value: feat } of transaction.objectStore("playerFeats")) {
		if (stopIfTooMany) {
			countPlayerFeats += 1;
			if (countPlayerFeats >= LIMIT_PLAYER_FEATS) {
				tooMany();
				return;
			}
		}

		const game = await gamesStore.get(feat.gid);
		if (game) {
			let updated;
			for (const t of game.teams) {
				if (t.tid === feat.tid && !t.playerFeat) {
					t.playerFeat = true;
					updated = true;
				}
			}

			if (updated) {
				await gamesStore.put(game);
			}
		}
	}
};

/**
 * Create a new league database with the latest structure.
 *
 * @param {Object} event Event from onupgradeneeded, with oldVersion 0.
 * @param {number} lid Integer league ID number for new league.
 */
const create = (db: IDBPDatabase<LeagueDB>) => {
	// rid ("row id") is used as the keyPath for objects without an innate unique identifier
	db.createObjectStore("awards", {
		keyPath: "season",
	});
	db.createObjectStore("draftPicks", {
		keyPath: "dpid",
		autoIncrement: true,
	});
	const eventStore = db.createObjectStore("events", {
		keyPath: "eid",
		autoIncrement: true,
	});
	db.createObjectStore("gameAttributes", {
		keyPath: "key",
	});
	const gameStore = db.createObjectStore("games", {
		keyPath: "gid",
	});
	db.createObjectStore("headToHeads", {
		keyPath: "season",
	});
	db.createObjectStore("messages", {
		keyPath: "mid",
		autoIncrement: true,
	});
	db.createObjectStore("negotiations", {
		keyPath: "pid",
	});
	db.createObjectStore("playerFeats", {
		keyPath: "fid",
		autoIncrement: true,
	});
	const playerStore = db.createObjectStore("players", {
		keyPath: "pid",
		autoIncrement: true,
	});
	db.createObjectStore("playoffSeries", {
		keyPath: "season",
	});
	db.createObjectStore("releasedPlayers", {
		keyPath: "rid",
		autoIncrement: true,
	});
	db.createObjectStore("schedule", {
		keyPath: "gid",
		autoIncrement: true,
	});
	db.createObjectStore("seasonLeaders", {
		keyPath: "season",
	});
	const teamSeasonsStore = db.createObjectStore("teamSeasons", {
		keyPath: "rid",
		autoIncrement: true,
	});
	const teamStatsStore = db.createObjectStore("teamStats", {
		keyPath: "rid",
		autoIncrement: true,
	});
	db.createObjectStore("teams", {
		keyPath: "tid",
	});
	db.createObjectStore("trade", {
		keyPath: "rid",
	});
	db.createObjectStore("draftLotteryResults", {
		keyPath: "season",
	});
	db.createObjectStore("allStars", {
		keyPath: "season",
	});
	eventStore.createIndex("season", "season");
	eventStore.createIndex("pids", "pids", {
		multiEntry: true,
	});
	eventStore.createIndex("dpids", "dpids", {
		multiEntry: true,
	});
	gameStore.createIndex("noteBool", "noteBool");
	gameStore.createIndex("season", "season");
	playerStore.createIndex("draft.year, retiredYear", [
		"draft.year",
		"retiredYear",
	]);
	playerStore.createIndex("statsTids", "statsTids", {
		multiEntry: true,
	});
	playerStore.createIndex("tid", "tid");
	playerStore.createIndex("hof", "hof");
	playerStore.createIndex("noteBool", "noteBool");
	playerStore.createIndex("srID", "srID");
	playerStore.createIndex("watch", "watch");
	teamSeasonsStore.createIndex("season, tid", ["season", "tid"], {
		unique: true,
	});
	teamSeasonsStore.createIndex("tid, season", ["tid", "season"], {
		unique: true,
	});
	teamSeasonsStore.createIndex("noteBool", "noteBool");
	teamStatsStore.createIndex("season, tid", ["season", "tid"]);
	teamStatsStore.createIndex("tid", "tid");

	const scheduledEventsStore = db.createObjectStore("scheduledEvents", {
		keyPath: "id",
		autoIncrement: true,
	});
	scheduledEventsStore.createIndex("season", "season");

	db.createObjectStore("savedTrades", {
		keyPath: "hash",
	});

	db.createObjectStore("savedTradingBlock", {
		keyPath: "rid",
	});
};

const migrate = async ({
	db,
	lid,
	oldVersion,
	transaction,
}: {
	db: IDBPDatabase<LeagueDB>;
	lid: number;
	oldVersion: number;
	transaction: VersionChangeTransaction;
}) => {
	console.log(db, lid, oldVersion, transaction);
	let upgradeMsg = `Upgrading league${lid} database from version ${oldVersion} to version ${db.version}.`;
	let slowUpgradeCalled = false;

	const slowUpgrade = () => {
		if (slowUpgradeCalled) {
			return;
		}

		slowUpgradeCalled = true;
		upgradeMsg += " For large leagues, this can take several minutes or more.";
		console.log(upgradeMsg);
		logEvent({
			type: "upgrade",
			text: upgradeMsg,
			saveToDb: false,
		});
	};

	if (isSport("basketball") || isSport("football")) {
		if (oldVersion < 16) {
			throw new Error(`League is too old to upgrade (version ${oldVersion})`);
		}

		if (oldVersion < 17) {
			const teamSeasonsStore = db.createObjectStore("teamSeasons", {
				keyPath: "rid",
				autoIncrement: true,
			});
			const teamStatsStore = db.createObjectStore("teamStats", {
				keyPath: "rid",
				autoIncrement: true,
			});
			teamSeasonsStore.createIndex("tid, season", ["tid", "season"], {
				unique: true,
			});
			teamSeasonsStore.createIndex("season, tid", ["season", "tid"], {
				unique: true,
			});
			teamStatsStore.createIndex("tid", "tid");
			teamStatsStore.createIndex("season, tid", ["season", "tid"]);

			for await (const cursor of transaction.objectStore("teams")) {
				const t = cursor.value;
				for (const teamStats of (t as any).stats) {
					teamStats.tid = t.tid;

					if (!Object.hasOwn(teamStats, "ba")) {
						teamStats.ba = 0;
					}

					teamStatsStore.add(teamStats);
				}

				for (const teamSeason of (t as any).seasons) {
					teamSeason.tid = t.tid;
					teamSeasonsStore.add(teamSeason);
				}

				delete (t as any).stats;
				delete (t as any).seasons;
				await cursor.update(t);
			}
		}

		if (oldVersion < 18) {
			// This used to upgrade team logos to the new ones, but Firefox
		}

		if (oldVersion < 19) {
			// Split old single string p.name into two names
			for await (const cursor of transaction.objectStore("players")) {
				const p = cursor.value;
				if ((p as any).name) {
					const bothNames = (p as any).name.split(" ");
					p.firstName = bothNames[0];
					p.lastName = bothNames[1];
					delete (p as any).name;

					await cursor.update(p);
				}
			}
		}

		if (oldVersion < 20) {
			// New best records format in awards
			for await (const cursor of transaction.objectStore("awards")) {
				const a = cursor.value;
				if (a.bre && a.brw) {
					a.bestRecordConfs = [a.bre, a.brw];
					a.bestRecord = a.bre.won >= a.brw.won ? a.bre : a.brw;
					delete a.bre;
					delete a.brw;
					await cursor.update(a);
				}
			}
		}

		if (oldVersion < 21) {
			// Removing indexes when upgrading to cache version
			transaction.objectStore("draftPicks").deleteIndex("season");
			transaction.objectStore("draftPicks").deleteIndex("tid");
			transaction.objectStore("playerFeats").deleteIndex("pid");
			transaction.objectStore("playerFeats").deleteIndex("tid");
			transaction.objectStore("players").deleteIndex("draft.year");
			transaction.objectStore("players").deleteIndex("retiredYear");
			transaction.objectStore("releasedPlayers").deleteIndex("tid");
			transaction.objectStore("releasedPlayers").deleteIndex("contract.exp");
		}

		if (oldVersion < 22) {
			transaction
				.objectStore("players")
				.createIndex("draft.year, retiredYear", ["draft.year", "retiredYear"]);
			for await (const cursor of transaction.objectStore("players")) {
				const p = cursor.value;
				if (p.retiredYear === null || p.retiredYear === undefined) {
					p.retiredYear = Infinity;
					await cursor.update(p);
				}
			}
		}

		if (oldVersion < 23) {
			db.createObjectStore("draftLotteryResults", {
				keyPath: "season",
			});
		}

		if (oldVersion < 24) {
			for await (const cursor of transaction.objectStore("players")) {
				const p = cursor.value;
				for (const r of p.ratings) {
					r.hgt = player.heightToRating(p.hgt);
				}

				await cursor.update(p);
			}
		}

		if (oldVersion < 25) {
			for await (const cursor of transaction.objectStore("teamStats")) {
				const ts = cursor.value;
				ts.oppBlk = ts.ba;
				delete ts.ba;
				await cursor.update(ts);
			}
		}

		if (oldVersion < 26) {
			for await (const cursor of transaction.objectStore("games")) {
				const gm = cursor.value;
				for (const t of gm.teams) {
					delete t.trb;

					for (const p of t.players) {
						delete p.trb;
					}
				}

				await cursor.update(gm);
			}
			for await (const cursor of transaction.objectStore(
				"playerStats" as any,
			)) {
				const ps = cursor.value;
				delete ps.trb;
				await cursor.update(ps);
			}
			for await (const cursor of transaction.objectStore("teamStats")) {
				const ts = cursor.value;
				delete ts.trb;
				delete ts.oppTrb;
				await cursor.update(ts);
			}
		}

		if (oldVersion < 27) {
			slowUpgrade();

			// Only non-retired players, for efficiency
			for await (const cursor of transaction.objectStore("players")) {
				const p = cursor.value;
				for (const r of p.ratings as any[]) {
					// Replace blk/stl with diq
					if (typeof r.diq !== "number") {
						if (typeof r.blk === "number" && typeof r.stl === "number") {
							r.diq = Math.round((r.blk + r.stl) / 2);
							delete r.blk;
							delete r.stl;
						} else {
							r.diq = 50;
						}
					}

					// Add oiq
					if (typeof r.oiq !== "number") {
						r.oiq = Math.round((r.drb + r.pss + r.tp + r.ins) / 4);

						if (typeof r.oiq !== "number") {
							r.oiq = 50;
						}
					}

					// Scale ratings
					const ratingKeys = [
						"stre",
						"spd",
						"jmp",
						"endu",
						"ins",
						"dnk",
						"ft",
						"fg",
						"tp",
						"oiq",
						"diq",
						"drb",
						"pss",
						"reb",
					];

					for (const key of ratingKeys) {
						if (typeof r[key] === "number") {
							// 100 -> 80
							// 0 -> 20
							// Linear in between
							r[key] -= (20 * (r[key] - 50)) / 50;
						} else {
							console.log(p);
							throw new Error(`Missing rating: ${key}`);
						}
					}

					r.ovr = player.ovr(r);
					r.skills = player.skills(r);

					// Don't want to deal with monteCarloPot now being async
					r.pot = r.ovr;

					if (p.draft.year === r.season) {
						p.draft.ovr = r.ovr;
						p.draft.skills = r.skills;
						p.draft.pot = r.pot;
					}
				}

				if (!Array.isArray(p.relatives)) {
					p.relatives = [];
				}

				await cursor.update(p);
			}
		}

		if (oldVersion < 28) {
			for await (const cursor of transaction.objectStore("teamSeasons")) {
				const ts = cursor.value;
				if (typeof ts.stadiumCapacity !== "number") {
					ts.stadiumCapacity = 25000;
					await cursor.update(ts);
				}
			}
		}

		if (oldVersion < 30) {
			slowUpgrade();
			upgrade29(unwrap(transaction));
		}

		if (oldVersion === 29) {
			// === rather than <= is to prevent the 30 and 27/29 upgrades from having a race condition on updating players
			for await (const cursor of transaction.objectStore("players")) {
				const p = cursor.value;
				if (!Array.isArray(p.relatives)) {
					p.relatives = [];
					await cursor.update(p);
				}
			}
		}

		if (oldVersion < 31) {
			upgrade31(unwrap(transaction));
		}

		if (oldVersion < 32) {
			// Gets need to use raw IDB API because Firefox < 60
			const tx = unwrap(transaction);

			tx.objectStore("gameAttributes").get("difficulty").onsuccess = (
				event: any,
			) => {
				let difficulty =
					event.target.result !== undefined
						? event.target.result.value
						: undefined;

				if (typeof difficulty === "number") {
					// Migrating from initial test implementation
					difficulty -= 0.5;
				} else {
					difficulty = 0;
				}

				tx.objectStore("gameAttributes").put({
					key: "difficulty",
					value: difficulty,
				});

				idb.meta.transaction("leagues").then((transaction) => {
					unwrap(transaction.objectStore("leagues")).get(lid).onsuccess = (
						event2: any,
					) => {
						const l = event2.target.result;
						l.difficulty = difficulty;
						idb.meta.put("leagues", l);
					};
				});
			};
		}

		if (oldVersion < 33) {
			upgrade33(transaction);
		}

		if (oldVersion < 34) {
			db.createObjectStore("allStars", {
				keyPath: "season",
			});
		}

		if (oldVersion < 35) {
			const teamsDefault = helpers.getTeamsDefault();
			for await (const cursor of transaction.objectStore("teams")) {
				const t = cursor.value;
				if (!(t as any).colors) {
					const td = teamsDefault[t.tid];
					if (td?.region === t.region && td.name === t.name) {
						t.colors = td.colors;
					} else {
						t.colors = DEFAULT_TEAM_COLORS;
					}

					await cursor.update(t);
				}
			}
		}

		if (oldVersion < 36) {
			slowUpgrade();
			for await (const cursor of transaction.objectStore("players")) {
				const p = cursor.value;
				if (!(p as any).injuries) {
					p.injuries = [];
					await cursor.update(p);
				}
			}
		}

		if (oldVersion < 37) {
			const scheduledEventsStore = db.createObjectStore("scheduledEvents", {
				keyPath: "id",
				autoIncrement: true,
			});
			scheduledEventsStore.createIndex("season", "season");
		}

		if (oldVersion < 38) {
			upgrade38(transaction);
		}

		if (oldVersion < 39) {
			slowUpgrade();

			let lastCentury = 0; // Iterate over players

			for await (const cursor of transaction.objectStore("players")) {
				const p = cursor.value;
				// This can be really slow, so need some UI for progress
				const century = Math.floor(p.draft.year / 100);
				if (century > lastCentury) {
					const text = `Upgrading players drafted in the ${century}00s...`;
					logEvent({
						type: "upgrade",
						text,
						saveToDb: false,
					});
					console.log(text);
					lastCentury = century;
				}

				delete (p as any).freeAgentMood;
				p.moodTraits = player.genMoodTraits();
				p.numDaysFreeAgent = 0;
				await cursor.update(p);
			}
			for await (const cursor of transaction.objectStore("teamStats")) {
				const ts = cursor.value;
				ts.numPlayersTradedAway = 0;
				await cursor.update(ts);
			}
		}

		if (oldVersion < 40) {
			transaction.objectStore("events").createIndex("dpids", "dpids", {
				multiEntry: true,
			});
		}

		if (oldVersion < 41) {
			const tx = unwrap(transaction);
			tx.objectStore("gameAttributes").get("userTids").onsuccess = (
				event: any,
			) => {
				let userTids: number[] = [];
				console.log("userTids result", event.target.result);
				if (event.target.result) {
					userTids = event.target.result.value;
				}

				tx.objectStore("gameAttributes").get("keepRosterSorted").onsuccess =
					async (event: any) => {
						let keepRosterSorted = true;
						if (event.target.result) {
							keepRosterSorted = !!event.target.result.value;
						}

						for await (const cursor of transaction.objectStore("teams")) {
							const t = cursor.value;
							t.keepRosterSorted = userTids.includes(t.tid)
								? keepRosterSorted
								: true;

							if (t.adjustForInflation === undefined) {
								t.adjustForInflation = true;
							}
							if (t.disabled === undefined) {
								t.disabled = false;
							}

							await cursor.update(t);
						}
					};
			};
		}

		if (oldVersion < 42) {
			db.createObjectStore("headToHeads", {
				keyPath: "season",
			});
		}

		if (oldVersion < 43) {
			const tx = unwrap(transaction);
			tx.objectStore("gameAttributes").get("season").onsuccess = (
				event: any,
			) => {
				if (event.target.result === undefined) {
					throw new Error("Missing season in gameAttributes during upgrade");
				}

				const season = event.target.result.value;

				if (typeof season !== "number") {
					throw new Error("Invalid season in gameAttributes during upgrade");
				}

				tx.objectStore("gameAttributes").get("phase").onsuccess = (
					event2: any,
				) => {
					if (event2.target.result === undefined) {
						throw new Error("Missing phase in gameAttributes during upgrade");
					}

					const phase = event2.target.result.value;

					if (typeof phase !== "number") {
						throw new Error("Invalid phase in gameAttributes during upgrade");
					}

					tx.objectStore("gameAttributes").get("nextPhase").onsuccess = (
						event3: any,
					) => {
						if (event3.target.result === undefined) {
							throw new Error(
								"Missing nextPhase in gameAttributes during upgrade",
							);
						}

						const nextPhase = event3.target.result.value;

						let currentSeason = season;
						if (actualPhase(phase as any, nextPhase) >= PHASE.PLAYOFFS) {
							currentSeason += 1;
						}

						// Apply default tiebreakers, while keeping track of when that happened
						const tiebreakers = [
							{
								start: -Infinity,
								value: ["coinFlip"],
							},
							{
								start: currentSeason,
								value: defaultGameAttributes.tiebreakers[0].value,
							},
						];

						transaction.objectStore("gameAttributes").put({
							key: "tiebreakers",
							value: tiebreakers,
						});
					};
				};
			};
		}
	}

	if (oldVersion < 44) {
		for await (const cursor of transaction.objectStore("teams")) {
			const t = cursor.value;
			if (!t.playThroughInjuries) {
				t.playThroughInjuries = DEFAULT_PLAY_THROUGH_INJURIES;
				await cursor.update(t);
			}
		}
	}

	if (oldVersion < 45) {
		upgrade45(transaction);
	}

	if (oldVersion < 46) {
		transaction.objectStore("gameAttributes").put({
			key: "playIn",
			value: false,
		});
	}

	if (oldVersion < 47) {
		slowUpgrade();

		for await (const cursor of transaction.objectStore("players")) {
			const p = cursor.value;
			if ((p as any).mood) {
				// Delete mood property that was accidentally saved previously
				delete (p as any).mood;
				await cursor.update(p);
			}
		}
	}

	if (oldVersion < 49) {
		// Gets need to use raw IDB API because Firefox < 60
		const tx = unwrap(transaction);

		tx.objectStore("gameAttributes").get("difficulty").onsuccess = (
			event: any,
		) => {
			let difficulty =
				event.target.result !== undefined
					? event.target.result.value
					: undefined;

			tx.objectStore("gameAttributes").get("easyDifficultyInPast").onsuccess = (
				event: any,
			) => {
				let easyDifficultyInPast =
					event.target.result !== undefined
						? event.target.result.value
						: undefined;

				if (typeof difficulty !== "number") {
					difficulty = 0;
				}
				if (typeof easyDifficultyInPast !== "boolean") {
					easyDifficultyInPast = false;
				}

				let lowestDifficulty = difficulty;
				if (easyDifficultyInPast && lowestDifficulty > DIFFICULTY.Easy) {
					lowestDifficulty = DIFFICULTY.Easy;
				}

				console.log(difficulty, easyDifficultyInPast, lowestDifficulty);

				tx.objectStore("gameAttributes").put({
					key: "lowestDifficulty",
					value: lowestDifficulty,
				});
			};
		};
	}

	if (oldVersion < 48) {
		slowUpgrade();

		for await (const cursor of transaction.objectStore("players")) {
			const p = cursor.value;
			for (const key of ["hof", "watch"] as const) {
				if (p[key]) {
					p[key] = 1;
				} else {
					delete p[key];
				}
			}

			if (p.note) {
				p.noteBool = 1;
			} else {
				delete p.note;
			}

			await cursor.update(p);
		}

		const playerStore = transaction.objectStore("players");

		// Had hof index in version 49, others in 50. Merged together here so the upgrade could happen together for people who have not yet upgraded to 49
		if (oldVersion < 50) {
			playerStore.createIndex("hof", "hof");
		}
		playerStore.createIndex("noteBool", "noteBool");
		playerStore.createIndex("watch", "watch");
	}

	if (oldVersion < 51) {
		const store = transaction.objectStore("gameAttributes");
		const hardCap = await store.get("hardCap");

		if (hardCap) {
			const newValue = hardCap.value ? "hard" : "soft";
			await store.put({
				key: "salaryCapType",
				value: newValue,
			});
			await store.delete("hardCap");
		}
	}

	if (oldVersion < 52) {
		// Non-basketball sports may have had a basketball pace stored in gameAttributes if they were created before gameAttributesKeysSportSpecific
		if (!isSport("basketball")) {
			const store = transaction.objectStore("gameAttributes");
			const pace = await store.get("pace");

			if (pace?.value === 100) {
				await store.put({
					key: "pace",
					value: 1,
				});
			}
		}
	}

	if (oldVersion < 53) {
		db.createObjectStore("seasonLeaders", {
			keyPath: "season",
		});
	}

	if (oldVersion < 54) {
		const store = transaction.objectStore("gameAttributes");
		const challengeThanosMode = await store.get("challengeThanosMode");

		await store.put({
			key: "challengeThanosMode",
			value: challengeThanosMode?.value ? 20 : 0,
		});
	}

	if (oldVersion < 55) {
		type OldBudgetItem = {
			amount: number;
			rank: number;
		};

		const store = transaction.objectStore("gameAttributes");
		const salaryCap: number =
			(await store.get("salaryCap"))?.value ?? defaultGameAttributes.salaryCap;

		const budgetsByTid: Record<number, Team["budget"]> = {};

		for await (const cursor of transaction.objectStore("teams")) {
			const t = cursor.value;

			// Compute equivalent levels for the budget values
			for (const key of helpers.keys(t.budget)) {
				const value = t.budget[key] as unknown as OldBudgetItem;
				if (typeof value !== "number") {
					if (key === "ticketPrice") {
						t.budget[key] = value.amount;
					} else {
						t.budget[key] = amountToLevel(value.amount, salaryCap);
					}
				}
			}

			t.initialBudget = {
				coaching: t.budget.coaching,
				facilities: t.budget.facilities,
				health: t.budget.health,
				scouting: t.budget.scouting,
			};

			budgetsByTid[t.tid] = t.budget;

			await cursor.update(t);
		}

		for await (const cursor of transaction.objectStore("teamSeasons")) {
			const ts = cursor.value;
			if (ts.tied === undefined) {
				ts.tied = 0;
			}
			if (ts.otl === undefined) {
				ts.otl = 0;
			}
			const gp = helpers.getTeamSeasonGp(ts);
			if (ts.gpHome === undefined) {
				ts.gpHome = Math.round(gp / 2);
			}

			// Move the amount to root, no more storing rank
			for (const key of helpers.keys(ts.revenues)) {
				const value = ts.revenues[key] as unknown as OldBudgetItem;
				if (typeof value !== "number") {
					ts.revenues[key] = value.amount;
				}
			}
			for (const key of helpers.keys(ts.expenses)) {
				const value = ts.expenses[key] as unknown as OldBudgetItem;
				if (typeof value !== "number") {
					ts.expenses[key] = value.amount;
				}
			}

			// Compute historical expense levels, assuming budget was the same as it is now. In theory could come up wtih a better estimate from expenses, but historical salary cap data is not stored so it wouldn't be perfect, and also who cares
			const expenseLevelsKeys = [
				"coaching",
				"facilities",
				"health",
				"scouting",
			] as const;
			ts.expenseLevels = {} as any;
			for (const key of expenseLevelsKeys) {
				ts.expenseLevels[key] = gp * budgetsByTid[ts.tid]![key];
			}

			await cursor.update(ts);
		}
	}

	// Bug here! But leave so upgrade below works
	if (oldVersion < 56) {
		const store = transaction.objectStore("gameAttributes");
		const repeatSeason = await store.get("repeatSeason");

		if (repeatSeason) {
			await store.put({
				key: "repeatSeason",
				value: {
					type: "playersAndRosters",
					...repeatSeason,
				},
			});
		}
	}

	// Fix old broken upgrade
	if (oldVersion < 57) {
		const store = transaction.objectStore("gameAttributes");
		const repeatSeason = (await store.get("repeatSeason"))?.value;

		if (repeatSeason && repeatSeason.type === "playersAndRosters") {
			if (repeatSeason.value === undefined) {
				await store.put({
					key: "repeatSeason",
					value: undefined,
				});
			} else {
				await store.put({
					key: "repeatSeason",
					value: {
						type: "playersAndRosters",
						...repeatSeason.value,
					},
				});
			}
		}
	}

	if (oldVersion < 58) {
		const store = transaction.objectStore("gameAttributes");
		const ties = (await store.get("ties"))?.value as
			| boolean
			| GameAttributeWithHistory<boolean>
			| undefined;

		if (ties !== undefined) {
			let maxOvertimes: GameAttributesLeagueWithHistory["maxOvertimes"];

			if (ties === true || ties === false) {
				maxOvertimes = [
					{
						start: -Infinity,
						value: ties ? 1 : null,
					},
				];
			} else {
				maxOvertimes = ties.map((row) => {
					return {
						start: row.start,
						value: row.value ? 1 : null,
					};
				}) as any;
			}

			await store.put({
				key: "maxOvertimes",
				value: maxOvertimes,
			});
		}

		await store.delete("ties");
	}

	if (oldVersion < 59) {
		db.createObjectStore("savedTrades", {
			keyPath: "hash",
		});
	}

	if (oldVersion < 60) {
		for await (const cursor of transaction.objectStore("playerFeats")) {
			const feat = cursor.value;

			const pts = feat.score.split("-").map((x) => Number.parseInt(x)) as [
				number,
				number,
			];
			let diff = -Infinity;
			if (!Number.isNaN(pts[0]) && !Number.isNaN(pts[1])) {
				diff = pts[0] - pts[1];
			}

			feat.result = diff === 0 ? "T" : (feat as any).won ? "W" : "L";

			delete (feat as any).won;

			await cursor.update(feat);
		}
	}

	if (oldVersion < 61) {
		if (isSport("hockey")) {
			for await (const cursor of transaction.objectStore("players")) {
				const p = cursor.value;
				for (const row of p.stats) {
					if (row.gp > 0) {
						// Glitchy because a goalie generally plays the whole game but a skater doesn't. Maybe `60 * row.gpGoalie` would have been better. https://discord.com/channels/290013534023057409/290015591216054273/1252453706679582741
						row.gMin = (row.min * row.gpGoalie) / row.gp;
					} else {
						row.gMin = 0;
					}
				}
				await cursor.update(p);
			}
		}
	}

	if (oldVersion < 62) {
		const teamSeasonsStore = transaction.objectStore("teamSeasons");
		teamSeasonsStore.createIndex("noteBool", "noteBool");
	}

	if (oldVersion < 63) {
		db.createObjectStore("savedTradingBlock", {
			keyPath: "rid",
		});
	}

	if (oldVersion < 64) {
		transaction.objectStore("games").createIndex("noteBool", "noteBool");
	}

	if (oldVersion < 65) {
		slowUpgrade();

		// Convert autoDeleteOldBoxScores to saveOldBoxScores
		const gameAttributesStore = transaction.objectStore("gameAttributes");
		const autoDeleteOldBoxScores = (
			await gameAttributesStore.get("autoDeleteOldBoxScores")
		)?.value;
		// If autoDeleteOldBoxScores was true, just let the new default apply. Only override if it was false
		if (autoDeleteOldBoxScores === false) {
			const saveOldBoxScores = {
				pastSeasons: "all",
				pastSeasonsType: "all",
			};
			await gameAttributesStore.put({
				key: "saveOldBoxScores",
				value: saveOldBoxScores,
			});
			await gameAttributesStore.delete("autoDeleteOldBoxScores");
		}

		await upgradeGamesVersion65({
			transaction: transaction as any,
			stopIfTooMany: true,
			lid,
		});
	}

	if (oldVersion < 66) {
		for await (const cursor of transaction
			.objectStore("players")
			.index("tid")
			.iterate(IDBKeyRange.lowerBound(PLAYER.FREE_AGENT))) {
			const p = cursor.value;
			const row = p.stats.at(-1);
			if (
				row?.jerseyNumber !== undefined &&
				row.jerseyNumber !== p.jerseyNumber
			) {
				// Previously, p.jerseyNumber was only used for new players (new real players league, relative, or custom league file) so it'd be stale in existing leagues. Now we need it to match the current value, because it is the actual source of truth.
				p.jerseyNumber = row.jerseyNumber;
				await cursor.update(p);
			}
		}
	}

	if (oldVersion < 67) {
		slowUpgrade();

		transaction.objectStore("players").createIndex("srID", "srID");
	}

	if (oldVersion < 68) {
		const keys = ["imgURL", "imgURLSmall"] as const;
		const stores = ["teams", "teamSeasons"] as const;
		for (const store of stores) {
			for await (const cursor of transaction.objectStore(store)) {
				const t = cursor.value;

				let updated;
				for (const key of keys) {
					if (t[key] === "/img/logos-primary/CHI.svg") {
						t[key] = "/img/logos-primary/CHW.svg";
						updated = true;
					} else if (t[key] === "/img/logos-secondary/CHI.svg") {
						t[key] = "/img/logos-secondary/CHW.svg";
						updated = true;
					}
				}

				if (updated) {
					await cursor.update(t);
				}
			}
		}
	}

	if (oldVersion < 69) {
		// By thorough with recent Team change, even though it only affects very old leagues
		for await (const cursor of transaction.objectStore("teams").iterate()) {
			const t = cursor.value;
			if (t.pop === undefined || t.stadiumCapacity === undefined) {
				// Get most recent teamSeason
				const cursor2 = await transaction
					.objectStore("teamSeasons")
					.index("tid, season")
					.openCursor(IDBKeyRange.bound([t.tid], [t.tid, []]), "prev");
				const teamSeason = cursor2?.value;

				t.pop = teamSeason?.pop ?? 1;
				t.stadiumCapacity = teamSeason?.pop ?? DEFAULT_STADIUM_CAPACITY;
				await cursor.update(t);
			}
		}

		for await (const cursor of transaction
			.objectStore("playoffSeries")
			.iterate()) {
			const row = cursor.value;
			if ((row as any).byConf === true) {
				// This setting only worked with 2 conferences in the past, so 2 is what `true` used to mean
				row.byConf = 2;
				await cursor.update(row);
			}
		}
	}
};

const connectLeague = (lid: number) =>
	connectIndexedDB<LeagueDB>({
		name: `league${lid}`,
		version: LEAGUE_DATABASE_VERSION,
		lid,
		create,
		migrate,
	});

export default connectLeague;
