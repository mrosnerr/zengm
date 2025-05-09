import { bySport, isSport, PHASE, PLAYER } from "../../../common/index.ts";
import addStatsRow from "./addStatsRow.ts";
import develop, { monteCarloPot } from "./develop.ts";
import generate from "./generate.ts";
import heightToRating from "./heightToRating.ts";
import name from "./name.ts";
import ovr from "./ovr.ts";
import pos from "./pos.ts";
import setContract from "./setContract.ts";
import skills from "./skills.ts";
import stats from "./stats.ts";
import { g, helpers, random } from "../../util/index.ts";
import type { MinimalPlayerRatings, Player } from "../../../common/types.ts";

const addStatsRowWrapped = async (
	p: any,
	ignoreJerseyNumberConflicts?: boolean,
) => {
	await addStatsRow(p, g.get("phase") === PHASE.PLAYOFFS, {
		ignoreJerseyNumberConflicts,
	});
};

/**
 * Take a partial player object, such as from an uploaded JSON file, and add everything it needs to be a real player object.
 *
 * @memberOf core.player
 * @param {Object} p Partial player object.
 * @return {Object} p Full player object.
 */
const augmentPartialPlayer = async (
	p: any,
	scoutingLevel: number,
	version: number | undefined,
	ignoreJerseyNumberConflicts?: boolean,
): Promise<Player<MinimalPlayerRatings>> => {
	let age;

	if (p.born === undefined) {
		age = random.randInt(19, 35);
	} else {
		age = g.get("startingSeason") - p.born.year;
	}

	const currentSeason = g.get("season");

	if (
		p.name !== undefined &&
		(p.firstName === undefined || p.lastName === undefined)
	) {
		const parts = p.name.split(" ");
		p.firstName = parts[0];
		p.lastName = parts.slice(1).join(" ");
		delete p.name;
	}

	// This is used to get at default values for various attributes
	const pg = generate(
		p.tid,
		age,
		g.get("startingSeason") - (age - 18),
		true,
		scoutingLevel,
		await name(),
	);

	// Optional things
	const simpleDefaults = [
		"awards",
		"born",
		"college",
		"firstName",
		"gamesUntilTradable",
		"hgt",
		"hof",
		"imgURL",
		"injury",
		"injuries",
		"lastName",
		"moodTraits",
		"numDaysFreeAgent",
		"ptModifier",
		"retiredYear",
		"rosterOrder",
		"watch",
		"weight",
		"yearsFreeAgent",
	] as (keyof typeof pg)[];

	for (const key of simpleDefaults) {
		if (p[key] === undefined) {
			p[key] = pg[key];
		}
	}

	if (!p.face || !p.face.accessories) {
		p.face = pg.face;
	}

	if (p.retiredYear === null) {
		// Because JSON turns Infinity to null
		p.retiredYear = Infinity;
	}

	if (!Array.isArray(p.stats)) {
		p.stats = [];
	}

	if (!p.statsTids) {
		p.statsTids = Array.isArray(p.stats) ? p.stats.map((s: any) => s.tid) : [];

		if (p.tid >= 0 && g.get("phase") <= PHASE.PLAYOFFS) {
			p.statsTids.push(p.tid);
		}

		p.statsTids = Array.from(new Set(p.statsTids));
	}

	if (!p.draft) {
		p.draft = {};
	}

	if (typeof p.draft.year !== "number") {
		if (p.tid === PLAYER.UNDRAFTED) {
			p.draft.year = currentSeason;
		} else {
			p.draft.year = pg.draft.year;
		}
	}

	if (typeof p.draft.tid !== "number") {
		p.draft.tid = -1;
	}

	if (typeof p.draft.originalTid !== "number") {
		p.draft.originalTid = p.draft.tid;
	}

	if (typeof p.draft.round !== "number") {
		p.draft.round = 0;
	}

	if (typeof p.draft.pick !== "number") {
		p.draft.pick = 0;
	}

	// ovr and pot set later, to make overriding from ratings easier

	// Fix always-missing info
	const offset = g.get("phase") >= PHASE.RESIGN_PLAYERS ? 1 : 0;

	if (p.tid === PLAYER.UNDRAFTED && g.get("phase") !== PHASE.FANTASY_DRAFT) {
		if (version === undefined || version <= 32) {
			p.ratings[0].season = currentSeason + offset;
			p.draft.year = p.ratings[0].season;
		} else {
			p.ratings[0].season = p.draft.year;
		}
	} else if (p.tid === PLAYER.UNDRAFTED_2) {
		if (version === undefined || version <= 32) {
			p.tid = PLAYER.UNDRAFTED;
			p.ratings[0].season = currentSeason + 1 + offset;
			p.draft.year = p.ratings[0].season;
		} else {
			throw new Error(
				`Invalid tid ${PLAYER.UNDRAFTED_2} (in version 33 or higher, all undrafted players should have a tid of ${PLAYER.UNDRAFTED})`,
			);
		}
	} else if (p.tid === PLAYER.UNDRAFTED_3) {
		if (version === undefined || version <= 32) {
			p.tid = PLAYER.UNDRAFTED;
			p.ratings[0].season = currentSeason + 2 + offset;
			p.draft.year = p.ratings[0].season;
		} else {
			throw new Error(
				`Invalid tid ${PLAYER.UNDRAFTED_3} (in version 33 or higher, all undrafted players should have a tid of ${PLAYER.UNDRAFTED})`,
			);
		}
	} else if (p.tid === PLAYER.RETIRED) {
		for (const r of p.ratings) {
			if (r.season === undefined) {
				r.season =
					typeof p.retiredYear === "number" ? p.retiredYear : currentSeason;
			}
		}
	} else if (g.get("phase") !== PHASE.FANTASY_DRAFT) {
		if (!Array.isArray(p.ratings)) {
			console.log(p);
		}
		if (p.ratings[0].season === undefined) {
			p.ratings[0].season = currentSeason;
		}

		// Fix improperly-set season in ratings
		if (
			p.ratings.length === 1 &&
			p.ratings[0].season < currentSeason &&
			p.tid !== PLAYER.RETIRED
		) {
			p.ratings[0].season = currentSeason;
		}
	}

	if (!Array.isArray(p.draft.skills)) {
		p.draft.skills = [];
	}

	// Height rescaling
	if (isSport("basketball") && (version === undefined || version <= 23)) {
		for (const r of p.ratings) {
			r.hgt = heightToRating(p.hgt);
		}
	}

	const r2 = p.ratings.at(-1);

	if (
		bySport({
			baseball: true,
			basketball: false,
			football: true,
			hockey: true,
		}) &&
		(!r2.ovrs || !r2.pots || !r2.pos)
	) {
		// Kind of hacky... impose ovrs/pots, but only for latest season. This will also overwrite ovr, pot, and skills - but they may again be overwritten below if fuzz was not present
		await develop(p, 0);
	}

	// Rating rescaling
	if (isSport("basketball") && (version === undefined || version <= 26)) {
		for (const r of p.ratings) {
			let scaleRatings = false;

			// Replace blk/stl with diq
			if (typeof r.diq !== "number") {
				if (typeof r.blk === "number" && typeof r.stl === "number") {
					r.diq = Math.round((r.blk + r.stl) / 2);
					delete r.blk;
					delete r.stl;
				} else {
					r.diq = 50;
				}

				scaleRatings = true;
			}

			// Add oiq
			if (typeof r.oiq !== "number") {
				r.oiq = Math.round((r.drb + r.pss + r.tp + r.ins) / 4);

				if (Number.isNaN(r.oiq)) {
					r.oiq = 50;
				}

				scaleRatings = true;
			}

			if (scaleRatings) {
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

				r.ovr = ovr(r);
				r.skills = skills(r);
				r.pot = await monteCarloPot({
					ratings: r,
					age: r.season - p.born.year,
					srID: p.srID,
				});

				if (p.draft.year === r.season) {
					p.draft.ovr = r.ovr;
					p.draft.skills = r.skills;
					p.draft.pot = r.pot;
				}
			}
		}
	}

	// Handle old format position
	if (p.pos !== undefined) {
		for (let i = 0; i < p.ratings.length; i++) {
			if (p.ratings[i].pos === undefined) {
				p.ratings[i].pos = p.pos;
			}
		}
	}

	for (const r of p.ratings) {
		let appliedFuzz = false;
		if (r.fuzz === undefined) {
			r.fuzz = pg.ratings[0].fuzz;
			appliedFuzz = true;
		}

		if (r.skills === undefined || appliedFuzz) {
			r.skills = skills(r);
		}

		if (r.ovr === undefined || appliedFuzz) {
			r.ovr = ovr(r, r.pos ?? p.pos);
		}

		if (
			isSport("basketball") &&
			(r.pot === undefined || r.pot < r.ovr || appliedFuzz)
		) {
			// Only basketball, in case position is not known at this point
			r.pot = await monteCarloPot({
				ratings: r,
				age: r.season - p.born.year,
				srID: p.srID,

				// Just do a rough estimate for old pot, doesn't matter much
				usePotEstimator: r.season < currentSeason,
			});
		}

		if (r.pos === undefined || appliedFuzz) {
			if (p.pos !== undefined && typeof p.pos === "string") {
				r.pos = p.pos;
			} else {
				r.pos = pos(r);
			}
		}

		if (r.season === p.draft.year) {
			if (typeof p.draft.pot !== "number") {
				p.draft.pot = r.pot;
			}
			if (typeof p.draft.ovr !== "number") {
				p.draft.ovr = r.ovr;
			}
		}
	}

	// Not in initial object, and not in ratings
	if (typeof p.draft.pot !== "number") {
		p.draft.pot = 0;
	}
	if (typeof p.draft.ovr !== "number") {
		p.draft.ovr = 0;
	}

	// Don't delete p.pos because it is used as a marker that this is from a league file and we shouldn't automatically change pos over time

	if (p.salaries === undefined) {
		p.salaries = [];
	}

	if (p.contract === undefined) {
		setContract(
			p,
			{
				amount: g.get("minContract"),
				exp: currentSeason,
			},
			p.tid >= 0,
		);
	} else {
		p.contract.amount = helpers.roundContract(p.contract.amount);

		if (p.contract.exp < g.get("startingSeason")) {
			p.contract.exp = g.get("startingSeason");
		}

		if (p.tid >= 0 && p.salaries.length === 0) {
			setContract(p, p.contract, true);
		}

		// Just in case... we never want this except for internal purposes, cause it means normalizeContractDemands will always overwrite this contract on load
		delete p.contract.temp;
	}

	// If no stats in League File, create blank stats rows for active players if necessary
	if (p.stats.length === 0) {
		if (p.tid >= 0 && g.get("phase") <= PHASE.PLAYOFFS) {
			await addStatsRowWrapped(p, ignoreJerseyNumberConflicts);
		}
	} else {
		let yearsWithTeam = 1;
		let prevTid;
		for (const ps of p.stats) {
			if (ps.yearsWithTeam === undefined) {
				if (ps.tid !== prevTid) {
					prevTid = ps.tid;
					yearsWithTeam = 1;
				} else if (!ps.playoffs) {
					yearsWithTeam += 1;
				}

				ps.yearsWithTeam = yearsWithTeam;
			}

			if (isSport("baseball") && stats.byPos) {
				for (const key of stats.byPos) {
					if (ps[key]) {
						for (let i = 0; i < ps[key].length; i++) {
							// JSON.stringify turns undefined into null
							if (ps[key][i] === null) {
								ps[key][i] = undefined;
							}
						}
					} else {
						ps[key] = [];
					}
				}
			}
		}

		// Add stats row if this is the preseason and all stats are historical, both for people making rosters by hand and for historical rosters
		if (g.get("phase") === PHASE.PRESEASON) {
			const lastSeason = p.stats.at(-1).season;

			if (p.tid >= 0 && lastSeason < currentSeason) {
				await addStatsRowWrapped(p, ignoreJerseyNumberConflicts);
			}
		}
	}

	if (isSport("hockey") && version !== undefined && version <= 60) {
		for (const row of p.stats) {
			if (row.gp > 0) {
				row.gMin = (row.min * row.gpGoalie) / row.gp;
			} else {
				row.gMin = 0;
			}
		}
	}

	if (!Array.isArray(p.relatives)) {
		p.relatives = [];
	}

	delete p.freeAgentMood;

	// Delete mood property that was accidentally saved previously
	delete p.mood;

	// Version 49/50
	for (const key of ["hof", "watch"] as const) {
		if (p[key] === true) {
			p[key] = 1;
		} else if (p[key] === false) {
			delete p[key];
		}
	}
	if (p.note) {
		p.noteBool = 1;
	} else {
		delete p.note;
	}

	// Version 66
	// jerseyNumber should always be defined in version 66+, except for players with no stats entry such as draft prospects. But still check for this just in case there is some weird custom file. Besides that, we need to restrict updates by version because we only want to overwrite an existing value in jerseyNumber if it is possibly stale (which is the case for versions before 66)
	if ((version !== undefined && version < 66) || p.jerseyNumber === undefined) {
		const row = p.stats.at(-1);
		if (
			row?.jerseyNumber !== undefined &&
			row.jerseyNumber !== p.jerseyNumber
		) {
			p.jerseyNumber = row.jerseyNumber;
		}
	}

	return p;
};

export default augmentPartialPlayer;
