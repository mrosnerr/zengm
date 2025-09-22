import { g, helpers, random } from "../../util/index.ts";
import { POSITIONS } from "../../../common/constants.football.ts";
import PlayByPlayLogger, {
	type PlayByPlayEventScore,
} from "./PlayByPlayLogger.ts";
import getCompositeFactor from "./getCompositeFactor.ts";
import getPlayers from "./getPlayers.ts";
import formations from "./formations.ts";
import penalties from "./penalties.ts";
import type { Position } from "../../../common/types.football.ts";
import type {
	CompositeRating,
	PenaltyPlayType,
	PlayerGameSim,
	PlayersOnField,
	TeamGameSim,
	TeamNum,
	Formation,
} from "./types.ts";
import getInjuryRate from "../GameSim.basketball/getInjuryRate.ts";
import Play, {
	SCRIMMAGE_EXTRA_POINT,
	SCRIMMAGE_KICKOFF,
	SCRIMMAGE_TWO_POINT_CONVERSION,
} from "./Play.ts";
import LngTracker from "./LngTracker.ts";
import GameSimBase from "../GameSimBase.ts";
import { STARTING_NUM_TIMEOUTS } from "../../../common/index.ts";

const teamNums: [TeamNum, TeamNum] = [0, 1];

const FIELD_GOAL_DISTANCE_YARDS_ADDED_FROM_SCRIMMAGE = 17;

/**
 * Convert energy into fatigue, which can be multiplied by a rating to get a fatigue-adjusted value.
 *
 * @param {number} energy A player's energy level, from 0 to 1 (0 = lots of energy, 1 = none).
 * @return {number} Fatigue, from 0 to 1 (0 = lots of fatigue, 1 = none).
 */
const fatigue = (energy: number, injured: boolean): number => {
	if (injured) {
		return 0;
	}

	energy += 0.05;

	if (energy > 1) {
		energy = 1;
	}

	return energy;
};

class GameSim extends GameSimBase {
	team: [TeamGameSim, TeamGameSim];

	playersOnField: [PlayersOnField, PlayersOnField];

	/**
	 * "initialKickoff" -> (right after kickoff) "firstPossession" -> (after next call to possessionChange) -> "secondPossession" -> (after next call to possessionChange) -> "bothTeamPossessed" -> (based on conditions below) "over"
	 * - "initialKickoff", "firstPossession": when touchdown or safety is scored, set state to "over"
	 * - "secondPossession": when any points are scored, if scoring team is winning, set state to "over"
	 * - "bothTeamsPossessed": after each play, if (!this.awaitingAfterTouchdown or point differential is more than 2) then end game if score is not equal, set state to "over"
	 */
	overtimeState:
		| undefined
		| "initialKickoff"
		| "firstPossession"
		| "secondPossession"
		| "bothTeamsPossessed"
		| "over";

	clock: number;

	numPeriods: number;

	isClockRunning = false;

	o: TeamNum;

	d: TeamNum;

	playByPlay: PlayByPlayLogger;

	awaitingAfterTouchdown = false;

	awaitingAfterSafety = false;

	awaitingKickoff: TeamNum | undefined;
	lastHalfAwaitingKickoff: TeamNum;

	scrimmage = SCRIMMAGE_KICKOFF;

	down = 1;

	toGo = 10;

	timeouts: [number, number] = [STARTING_NUM_TIMEOUTS!, STARTING_NUM_TIMEOUTS!];

	twoMinuteWarningHappened = false;

	currentPlay: Play;

	lngTracker: LngTracker;

	// For penalties at the end of a half
	playUntimedPossession = false;

	twoPointConversionTeam: TeamNum | undefined;

	constructor({
		gid,
		day,
		teams,
		doPlayByPlay,
		homeCourtFactor,
		neutralSite,
		baseInjuryRate,
	}: {
		gid: number;
		day?: number;
		teams: [TeamGameSim, TeamGameSim];
		doPlayByPlay: boolean;
		homeCourtFactor: number;
		neutralSite: boolean;
		baseInjuryRate: number;
	}) {
		super({
			gid,
			day,
			allStarGame: false,
			baseInjuryRate,
			neutralSite,
		});

		this.playByPlay = new PlayByPlayLogger(doPlayByPlay);
		this.team = teams; // If a team plays twice in a day, this needs to be a deep copy

		this.playersOnField = [{}, {}];

		// Record "gs" stat for starters
		this.o = 0;
		this.d = 1;
		this.updatePlayersOnField("starters");
		this.o = 1;
		this.d = 0;
		this.updatePlayersOnField("starters");

		this.clock = g.get("quarterLength"); // Game clock, in minutes
		this.numPeriods = g.get("numPeriods");

		this.awaitingKickoff = Math.random() < 0.5 ? 0 : 1;
		this.d = this.awaitingKickoff;
		this.o = this.awaitingKickoff === 0 ? 1 : 0;
		this.lastHalfAwaitingKickoff = this.awaitingKickoff;
		this.currentPlay = new Play(this);
		this.lngTracker = new LngTracker();

		if (!neutralSite) {
			this.homeCourtAdvantage(homeCourtFactor);
		}
	}

	homeCourtAdvantage(homeCourtFactor: number) {
		const homeCourtModifier =
			homeCourtFactor *
			helpers.bound(1 + g.get("homeCourtAdvantage") / 100, 0.01, Infinity);

		for (const t of [0, 1] as const) {
			let factor;

			if (t === 0) {
				factor = homeCourtModifier; // Bonus for home team
			} else {
				factor = 1.0 / homeCourtModifier; // Penalty for away team
			}

			for (const p of this.team[t].player) {
				for (const r of Object.keys(p.compositeRating)) {
					if (r !== "endurance") {
						p.compositeRating[r] *= factor;
					}
				}
			}
		}
	}

	run() {
		// Simulate the game up to the end of regulation
		this.simRegulation();

		let numOvertimes = 0;
		while (
			this.team[0].stat.pts === this.team[1].stat.pts &&
			numOvertimes < this.maxOvertimes
		) {
			this.simOvertime();
			numOvertimes += 1;
		}

		this.doShootout();

		this.playByPlay.logEvent({
			type: "gameOver",
			clock: this.clock,
		});

		// Delete stuff that isn't needed before returning
		for (const t of [0, 1] as const) {
			delete this.team[t].compositeRating;
			// @ts-expect-error
			delete this.team[t].pace;

			for (const p of this.team[t].player) {
				// @ts-expect-error
				delete p.age;
				// @ts-expect-error
				delete p.valueNoPot;
				delete p.compositeRating;
				// @ts-expect-error
				delete p.ptModifier;
				delete p.stat.benchTime;
				delete p.stat.courtTime;
				delete p.stat.energy;
			}
		}

		const scoringSummary: PlayByPlayEventScore[] = [];

		// Remove any scores that were negated by penalties
		for (const [i, current] of this.playByPlay.scoringSummary.entries()) {
			const next = this.playByPlay.scoringSummary[i + 1];

			// Must have been reversed by a penalty
			if (next?.type === "removeLastScore") {
				continue;
			}

			// No longer need to store this
			if (current.type === "removeLastScore") {
				continue;
			}

			scoringSummary.push(current);
		}

		const out = {
			gid: this.id,
			day: this.day,
			overtimes: this.overtimes,
			team: this.team,
			clutchPlays: [],
			playByPlay: this.playByPlay.getPlayByPlay(this.team),
			neutralSite: this.neutralSite,
			scoringSummary,
		};
		return out;
	}

	doShootoutShot(t: TeamNum) {
		this.o = t;
		this.d = t === 0 ? 1 : 0;

		this.updatePlayersOnField("fieldGoal");

		const distance = 50;

		const p = this.getTopPlayerOnField(this.o, "K");
		this.scrimmage = distance + FIELD_GOAL_DISTANCE_YARDS_ADDED_FROM_SCRIMMAGE;

		// Don't let it ever be 0% or 100%
		const probMake = helpers.bound(this.probMadeFieldGoal(p), 0.01, 0.99);

		const made = Math.random() < probMake;

		this.recordStat(t, undefined, "sAtt");
		if (made) {
			this.recordStat(t, undefined, "sPts");
		}

		this.playByPlay.logEvent({
			type: "shootoutShot",
			t,
			names: [p.name],
			made,
			att: this.team[t].stat.sAtt,
			yds: distance,
			clock: this.clock,
		});
	}

	doShootout() {
		if (
			this.shootoutRounds <= 0 ||
			this.team[0].stat.pts !== this.team[1].stat.pts
		) {
			return;
		}

		this.shootout = true;
		this.clock = 1; // So fast-forward to end of period stops before the shootout
		this.team[0].stat.sPts = 0;
		this.team[0].stat.sAtt = 0;
		this.team[1].stat.sPts = 0;
		this.team[1].stat.sAtt = 0;

		const reversedTeamNums = [1, 0] as const;

		this.playByPlay.logEvent({
			type: "shootoutStart",
			rounds: this.shootoutRounds,
			clock: this.clock,
		});

		SHOOTOUT_ROUNDS: for (let i = 0; i < this.shootoutRounds; i++) {
			for (const t of reversedTeamNums) {
				this.doShootoutShot(t);

				if (
					this.shouldEndShootoutEarly(t, i, [
						this.team[0].stat.sPts,
						this.team[1].stat.sPts,
					])
				) {
					break SHOOTOUT_ROUNDS;
				}
			}
		}

		if (this.team[0].stat.sPts === this.team[1].stat.sPts) {
			this.playByPlay.logEvent({
				type: "shootoutTie",
				clock: this.clock,
			});

			while (this.team[0].stat.sPts === this.team[1].stat.sPts) {
				for (const t of reversedTeamNums) {
					this.doShootoutShot(t);
				}
			}
		}
	}

	isFirstPeriodAfterHalftime(quarter: number) {
		return this.numPeriods % 2 === 0 && quarter === this.numPeriods / 2 + 1;
	}

	kickoffAfterEndOfPeriod(quarter: number) {
		return (
			this.isFirstPeriodAfterHalftime(quarter + 1) || quarter >= this.numPeriods
		);
	}

	logTimeouts() {
		this.playByPlay.logEvent({
			type: "timeouts",
			timeouts: [...this.timeouts],
		});
	}

	simRegulation() {
		let quarter = 1;

		while (true) {
			while (
				this.clock > 0 ||
				this.awaitingAfterTouchdown ||
				this.playUntimedPossession
			) {
				this.simPlay();
			}

			// Who gets the ball after halftime?
			if (this.isFirstPeriodAfterHalftime(quarter + 1)) {
				this.timeouts = [3, 3];
				this.logTimeouts();
				this.twoMinuteWarningHappened = false;

				this.d = this.lastHalfAwaitingKickoff === 0 ? 1 : 0;
				this.o = this.lastHalfAwaitingKickoff;
				this.awaitingKickoff = this.d;
				this.lastHalfAwaitingKickoff = this.d;
				this.scrimmage = SCRIMMAGE_KICKOFF;
			} else if (quarter === this.numPeriods) {
				break;
			}

			quarter += 1;

			this.team[0].stat.ptsQtrs.push(0);
			this.team[1].stat.ptsQtrs.push(0);
			this.clock = g.get("quarterLength");
			this.playByPlay.logEvent({
				type: "quarter",
				clock: this.clock,
				quarter,
				startsWithKickoff: this.kickoffAfterEndOfPeriod(quarter - 1),
			});
		}
	}

	simOvertime() {
		this.clock = this.getOvertimeLength();

		this.overtime = true;
		this.overtimes += 1;
		if (this.overtimeState === undefined) {
			// Only set this in first overtime
			this.overtimeState = "initialKickoff";

			// Coin flip in initial overtime
			this.awaitingKickoff = Math.random() < 0.5 ? 0 : 1;
			this.lastHalfAwaitingKickoff = this.awaitingKickoff;
			this.scrimmage = SCRIMMAGE_KICKOFF;
		}
		this.team[0].stat.ptsQtrs.push(0);
		this.team[1].stat.ptsQtrs.push(0);
		this.timeouts = [2, 2];
		this.logTimeouts();
		this.twoMinuteWarningHappened = false;
		this.playByPlay.logEvent({
			type: "overtime",
			clock: this.clock,
			overtimes: this.overtimes,
			startsWithKickoff: this.kickoffAfterEndOfPeriod(
				this.numPeriods + this.overtimes - 1,
			),
		});

		this.d = this.lastHalfAwaitingKickoff === 0 ? 1 : 0;
		this.o = this.lastHalfAwaitingKickoff;
		this.awaitingKickoff = this.d;
		this.lastHalfAwaitingKickoff = this.d;
		this.scrimmage = SCRIMMAGE_KICKOFF;

		while (
			(this.clock > 0 || this.playUntimedPossession) &&
			this.overtimeState !== "over"
		) {
			this.simPlay();
		}
	}

	getTopPlayerOnField(t: TeamNum, pos: Position) {
		const players = this.playersOnField[t][pos];

		if (!players || !players[0]) {
			throw new Error(`No player found at position ${pos}`);
		}

		return players[0];
	}

	probPass() {
		// Hack!! Basically, we want to see what kind of talent we have before picking if it's a run or pass play, so put the starter (minus fatigue) out there and compute these
		this.updatePlayersOnField("starters");
		this.updateTeamCompositeRatings();

		const ptsDown = this.team[this.d].stat.pts - this.team[this.o].stat.pts;
		const quarter = this.team[0].stat.ptsQtrs.length;
		const desperation =
			this.scrimmage < 97 &&
			quarter >= this.numPeriods &&
			((quarter > this.numPeriods && ptsDown > 0) ||
				(ptsDown > 0 && this.clock <= 2) ||
				(ptsDown > 8 && this.clock <= 3) ||
				(ptsDown > 16 && this.clock <= 4) ||
				(ptsDown > 24 && this.clock <= 6));
		if (desperation) {
			return 0.98 * g.get("passFactor");
		}

		let offPassing = 0;
		let offRushing = 0;
		let defPassing = 0;
		let defRushing = 0;

		// Calculate offPassing only if there is a quarterback in the formation
		if (this.playersOnField[this.o].QB) {
			const qb = this.getTopPlayerOnField(this.o, "QB");
			const qbFactor = qb ? qb.ovrs.QB / 100 : 0;
			offPassing =
				(5 * qbFactor +
					this.team[this.o].compositeRating.receiving +
					this.team[this.o].compositeRating.passBlocking) /
				7;
		}

		offRushing =
			(this.team[this.o].compositeRating.rushing +
				this.team[this.o].compositeRating.runBlocking) /
			2;
		defPassing =
			(this.team[this.d].compositeRating.passRushing +
				this.team[this.d].compositeRating.passCoverage) /
			2;
		defRushing = this.team[this.d].compositeRating.runStopping;

		// Arbitrary rescale - .45-.7 -> .25-.75
		offPassing = helpers.bound((offPassing - 0.45) * (0.5 / 0.25) + 0.25, 0, 1);

		// Arbitrary rescale - .5-.7 -> .25-.75
		offRushing = helpers.bound((offRushing - 0.5) * (0.5 / 0.2) + 0.25, 0, 1);

		// Arbitrary rescale - .4-.65 -> .25-.75
		defPassing = helpers.bound((defPassing - 0.4) * (0.5 / 0.25) + 0.25, 0, 1);

		// Arbitrary rescale - .4-.6 -> .25-.75
		defRushing = helpers.bound((defRushing - 0.4) * (0.5 / 0.2) + 0.25, 0, 1);

		const passingTendency =
			1.075 * helpers.bound(offPassing - 0.25 * defPassing, 0, 1);
		const rushingTendency =
			0.925 * helpers.bound(offRushing - 0.25 * defRushing, 0, 1);

		let passOdds = 0.57;
		if (passingTendency > 0 || rushingTendency > 0) {
			// Always pass at least 45% of the time, and always rush at least 35% of the time
			passOdds = helpers.bound(
				(1.5 * passingTendency) / (1.5 * passingTendency + rushingTendency),
				0.45,
				0.65,
			);
		}

		if (this.scrimmage >= 95) {
			// 5 for 1 yd to go, 1 for 5 yds to go
			const runAtGoallineWeight = this.scrimmage - 94;

			passOdds = passOdds / runAtGoallineWeight;
		}

		return passOdds * g.get("passFactor");
	}

	// Probability that a kickoff should be an onside kick
	probOnside() {
		if (this.awaitingAfterSafety) {
			return 0;
		}

		// Random onside kick, but never in the 4th quarter because some of those could be really stupid
		if (this.team[0].stat.ptsQtrs.length < this.numPeriods) {
			return 0.001 * g.get("onsideFactor");
		}

		// Does game situation dictate an onside kick in the 4th quarter?
		if (this.team[0].stat.ptsQtrs.length !== this.numPeriods) {
			return 0;
		}

		const numScoresDown = Math.ceil(
			(this.team[this.d].stat.pts - this.team[this.o].stat.pts) / 8,
		);

		if (numScoresDown <= 0 || numScoresDown >= 4) {
			// Either winning, or being blown out so there's no point
			return 0;
		}

		if (this.clock < 2) {
			return 1;
		}

		if (numScoresDown >= 2 && this.clock < 2.5) {
			return 0.9;
		}

		if (numScoresDown >= 3 && this.clock < 3.5) {
			return 0.8;
		}

		if (numScoresDown >= 2 && this.clock < 5) {
			return numScoresDown / 20;
		}

		return 0;
	}

	hurryUp() {
		const ptsDown = this.team[this.d].stat.pts - this.team[this.o].stat.pts;
		const quarter = this.team[0].stat.ptsQtrs.length;
		return (
			((this.kickoffAfterEndOfPeriod(quarter) && this.scrimmage >= 50) ||
				(quarter === this.numPeriods && ptsDown >= 0)) &&
			this.clock <= 2
		);
	}

	getPlayType() {
		if (this.awaitingKickoff !== undefined) {
			return Math.random() < this.probOnside() ? "onsideKick" : "kickoff";
		}

		const ptsDown = this.team[this.d].stat.pts - this.team[this.o].stat.pts;
		const quarter = this.team[0].stat.ptsQtrs.length;

		if (this.awaitingAfterTouchdown) {
			if (ptsDown === 2 && Math.random() < 0.7) {
				return "twoPointConversion";
			}

			if (quarter >= this.numPeriods - 1) {
				if (ptsDown === 0) {
					return "extraPoint";
				}
				if (ptsDown === 1) {
					return "extraPoint";
				}
				if (ptsDown === 2) {
					return "twoPointConversion";
				}
				if (ptsDown === 4) {
					return "extraPoint";
				}
				if (ptsDown === 5) {
					return "twoPointConversion";
				}
				if (ptsDown === 7) {
					return "extraPoint";
				}
				if (ptsDown === 8) {
					return "extraPoint";
				}
				if (ptsDown === 10) {
					return "twoPointConversion";
				}
				if (ptsDown === 11) {
					return "extraPoint";
				}
				if (ptsDown === 13) {
					return "twoPointConversion";
				}
				if (ptsDown === 14) {
					return "extraPoint";
				}
				if (ptsDown === 15) {
					return "extraPoint";
				}
				if (ptsDown === 18) {
					return "twoPointConversion";
				}
				if (ptsDown === -1) {
					return "twoPointConversion";
				}
				if (ptsDown === -2) {
					return "extraPoint";
				}
				if (ptsDown === -3) {
					return "extraPoint";
				}
				if (ptsDown === -5) {
					return "twoPointConversion";
				}
				if (ptsDown === -6) {
					return "extraPoint";
				}
				if (ptsDown === -7) {
					return "extraPoint";
				}
				if (ptsDown === -8) {
					return "extraPoint";
				}
				if (ptsDown === -9) {
					return "extraPoint";
				}
				if (ptsDown === -10) {
					return "extraPoint";
				}
				if (ptsDown === -12) {
					return "twoPointConversion";
				}
				if (ptsDown === -13) {
					return "extraPoint";
				}
				if (ptsDown === -14) {
					return "extraPoint";
				}
			}

			return Math.random() < 0.95 ? "extraPoint" : "twoPointConversion";
		}

		if (quarter >= this.numPeriods && ptsDown < 0 && this.scrimmage > 10) {
			// Does it make sense to kneel? Depends on clock time and opponent timeouts
			const downsRemaining = 4 - this.down;
			const timeoutDownsRemaining = Math.min(
				this.timeouts[this.d] + (this.clock > 2 ? 1 : 0),
				downsRemaining,
			);
			const clockRunningDownsRemaining = downsRemaining - timeoutDownsRemaining;

			const timeRemainingAfterKeels =
				this.clock -
				(timeoutDownsRemaining * 2 + clockRunningDownsRemaining * 42) / 60;
			if (timeRemainingAfterKeels < 0) {
				return "kneel";
			}
		}

		// Don't kick a FG when we really need a touchdown! secondPossession check is for playoff overtime rules
		const needTouchdown =
			quarter >= this.numPeriods &&
			ptsDown > 3 &&
			(this.clock <= 2 || this.overtimeState === "secondPossession");

		const neverPunt =
			(quarter === this.numPeriods && ptsDown > 0 && this.clock <= 2) ||
			(quarter > this.numPeriods && ptsDown > 0);

		// If there are under 10 seconds left in the half/overtime, maybe try a field goal
		if (
			this.clock <= 10 / 60 &&
			this.kickoffAfterEndOfPeriod(quarter) &&
			!needTouchdown &&
			this.probMadeFieldGoal() >= 0.02
		) {
			return "fieldGoalLate";
		}

		// If a field goal will win it in overtime and odds of success are high, go for it
		if (
			(this.overtimeState === "secondPossession" ||
				this.overtimeState === "bothTeamsPossessed") &&
			ptsDown < 3 &&
			this.probMadeFieldGoal() >= 0.9
		) {
			return "fieldGoal";
		}

		if (this.down === 4) {
			// Don't kick a FG when we really need a touchdown!
			if (!needTouchdown) {
				const probMadeFieldGoal = this.probMadeFieldGoal();

				// If it's late in the 4th quarter, some scores heavily favor kicking a FG - the FG will take the lead, or when the FG will make the "number of scores" lead much better (like going from up 4 to up 7, or up 6 to up 9)
				if (
					probMadeFieldGoal >= 0.5 &&
					quarter === this.numPeriods &&
					this.clock <= 6 &&
					((ptsDown >= 0 && ptsDown <= 2) || (ptsDown <= -4 && ptsDown >= -8))
				) {
					return "fieldGoal";
				}

				// If it's 4th and short, maybe go for it
				let probGoForIt =
					(() => {
						// In overtime, if tied and a field goal would win, try it
						if (
							this.overtimeState !== "firstPossession" &&
							ptsDown === 0 &&
							probMadeFieldGoal >= 0.7
						) {
							return 0;
						}
						if (this.scrimmage < 40) {
							return 0;
						}
						if (this.toGo <= 1) {
							return 0.75;
						}
						if (this.toGo <= 2) {
							return 0.5;
						}
						if (this.toGo <= 3) {
							return 0.35;
						}
						if (this.toGo <= 4) {
							return 0.2;
						}
						if (this.toGo <= 5) {
							return 0.05;
						}
						if (this.toGo <= 7) {
							return 0.01;
						}
						if (this.toGo <= 10) {
							return 0.001;
						}
						return 0;
					})() * g.get("fourthDownFactor");
				if (probGoForIt > 0.99) {
					probGoForIt = 0.99;
				}

				if (Math.random() > probGoForIt) {
					// If it's a makeable field goal, take it
					if (probMadeFieldGoal >= 0.7) {
						return "fieldGoal";
					}

					// If it's a hard field goal, maybe take it
					const probTryFieldGoal = helpers.bound(
						(probMadeFieldGoal - 0.3) / 0.5,
						0,
						1,
					);

					if (Math.random() < probTryFieldGoal) {
						return "fieldGoal";
					}

					// Default option - punt
					if (!neverPunt) {
						return "punt";
					}
				}
			}
		}

		if (Math.random() < this.probPass()) {
			return "pass";
		}

		return "run";
	}

	simPlay() {
		// Reset before calling Play, so Play can set to true if necessary for the next play
		this.playUntimedPossession = false;

		const playType = this.getPlayType();

		// Set these before creating a new Play so they are updated in there too
		if (playType === "extraPoint") {
			this.scrimmage = SCRIMMAGE_EXTRA_POINT;
			this.down = 1;
			this.toGo = 100 - this.scrimmage;
		} else if (playType === "twoPointConversion") {
			this.scrimmage = SCRIMMAGE_TWO_POINT_CONVERSION;
			this.down = 1;
			this.toGo = 100 - this.scrimmage;
		}

		this.currentPlay = new Play(this);

		this.playByPlay.logClock({
			awaitingKickoff: this.awaitingKickoff,
			awaitingAfterTouchdown: this.awaitingAfterTouchdown,
			clock: this.clock,
			down: this.down,
			scrimmage: this.scrimmage,
			t: this.o,
			toGo: this.toGo,
		});

		let dt;

		if (playType === "kickoff") {
			dt = this.doKickoff();
		} else if (playType === "onsideKick") {
			dt = this.doKickoff(true);
		} else if (
			playType === "extraPoint" ||
			playType === "fieldGoal" ||
			playType === "fieldGoalLate"
		) {
			dt = this.doFieldGoal(playType);
		} else if (playType === "twoPointConversion") {
			dt = this.doTwoPointConversion();
		} else if (playType === "punt") {
			dt = this.doPunt();
		} else if (playType === "pass") {
			if (this.down === 4) {
				this.playByPlay.logEvent({
					type: "goingForItOn4th",
					clock: this.clock,
					t: this.o,
				});
			}
			dt = this.doPass();
		} else if (playType === "run") {
			if (this.down === 4) {
				this.playByPlay.logEvent({
					type: "goingForItOn4th",
					clock: this.clock,
					t: this.o,
				});
			}
			dt = this.doRun();
		} else if (playType === "kneel") {
			dt = this.doKneel();
		} else {
			throw new Error(`Unknown playType "${playType}"`);
		}

		dt /= 60;
		const quarter = this.team[0].stat.ptsQtrs.length;

		const clockAtEndOfPlay = this.clock - dt;

		const timeExpiredAtEndOfHalf =
			clockAtEndOfPlay <= 0 && this.kickoffAfterEndOfPeriod(quarter);

		this.currentPlay.commit(timeExpiredAtEndOfHalf);

		// Two minute warning
		let twoMinuteWarningHappening = false;
		if (
			this.kickoffAfterEndOfPeriod(quarter) &&
			clockAtEndOfPlay <= 2 &&
			!this.twoMinuteWarningHappened
		) {
			this.twoMinuteWarningHappened = true;
			this.isClockRunning = false;
			this.playByPlay.logEvent({
				type: "twoMinuteWarning",
				clock: clockAtEndOfPlay,
			});

			// So we know it happened this possession, and no random timeout should be used
			twoMinuteWarningHappening = true;
		}

		if (clockAtEndOfPlay > 0 && !twoMinuteWarningHappening) {
			// Timeouts - small chance at any time
			if (Math.random() < 0.01) {
				this.doTimeout(this.o);
			} else if (Math.random() < 0.003) {
				this.doTimeout(this.d);
			}

			// Timeouts - late in game when clock is running
			if (this.kickoffAfterEndOfPeriod(quarter) && this.isClockRunning) {
				const diff = this.team[this.o].stat.pts - this.team[this.d].stat.pts;

				// No point in the 4th quarter of a blowout
				if (diff < 24 || quarter < this.numPeriods) {
					if (diff > 0) {
						// If offense is winning, defense uses timeouts when near the end
						if (this.clock < 2.5) {
							this.doTimeout(this.d);
						}
					} else if (this.clock < 1.5) {
						// If offense is losing or tied, offense uses timeouts when even nearer the end
						this.doTimeout(this.o);
					}
				}
			}
		}

		// Time between plays (can be more than 40 seconds because there is time before the play clock starts)
		let dtClockRunning = 0;

		if (this.isClockRunning) {
			if (this.hurryUp()) {
				dtClockRunning = random.randInt(5, 13) / 60;

				// Leave some time for a FG attempt!
				if (this.clock - dt - dtClockRunning < 0) {
					dtClockRunning = random.randInt(0, 4) / 60;
				}
			} else {
				dtClockRunning = random.randInt(37, 62) / 60;
			}

			dtClockRunning /= g.get("pace");
		}

		// Check two minute warning again
		if (
			this.kickoffAfterEndOfPeriod(quarter) &&
			clockAtEndOfPlay - dtClockRunning <= 2 &&
			!this.twoMinuteWarningHappened
		) {
			this.twoMinuteWarningHappened = true;
			this.isClockRunning = false;
			this.playByPlay.logEvent({
				type: "twoMinuteWarning",
				clock: 2,
			});

			// Clock only runs until it hits 2 minutes exactly
			dtClockRunning = helpers.bound(clockAtEndOfPlay - 2, 0, Infinity);
		}

		// Clock
		dt += dtClockRunning;
		this.clock -= dt;

		if (this.clock < 0) {
			dt += this.clock;
			this.clock = 0;
		}

		this.updatePlayingTime(dt);
		if (playType !== "kneel") {
			this.injuries();
		}

		if (
			this.overtimeState === "bothTeamsPossessed" &&
			this.team[0].stat.pts !== this.team[1].stat.pts &&
			(!this.awaitingAfterTouchdown ||
				Math.abs(this.team[0].stat.pts - this.team[1].stat.pts) > 2)
		) {
			this.overtimeState = "over";
		}
	}

	doTackle({ ydsFromScrimmage }: { ydsFromScrimmage: number | undefined }) {
		const d = this.currentPlay.state.current.d;

		// For non-sacks, record tackler(s)
		if (Math.random() < 0.9) {
			let playersDefense: PlayerGameSim[] = [];

			for (const playersAtPos of Object.values(this.playersOnField[d])) {
				if (playersAtPos) {
					playersDefense = playersDefense.concat(playersAtPos);
				}
			}

			// Bias position of tackler based on how far from scrimmage the play is
			let positions: Position[] | undefined;
			if (ydsFromScrimmage !== undefined) {
				const r = Math.random();
				if (ydsFromScrimmage < 2) {
					if (r < 0) {
						positions = ["DL"];
					} else if (r < 0.4) {
						positions = ["DL", "LB"];
					}
				} else if (ydsFromScrimmage < 7) {
					if (r < 0.2) {
						positions = ["LB"];
					} else if (r < 0.4) {
						positions = ["LB", "S"];
					}
				} else if (ydsFromScrimmage < 15) {
					if (r < 0.3) {
						positions = ["LB", "S"];
					} else if (r < 0.95) {
						positions = ["LB", "S", "CB"];
					}
				} else {
					if (r < 0.3) {
						positions = ["S"];
					} else if (r < 0.9) {
						positions = ["S", "CB"];
					} else {
						positions = ["S", "CB", "LB"];
					}
				}
			}

			const tacklers =
				Math.random() < 0.25
					? new Set([
							this.pickPlayer(d, "tackling", positions, 1.5),
							this.pickPlayer(d, "tackling", positions, 1.5),
						])
					: new Set([this.pickPlayer(d, "tackling", positions, 1.5)]);

			this.currentPlay.addEvent({
				type: "tck",
				tacklers,
				loss: ydsFromScrimmage !== undefined && ydsFromScrimmage < 0,
			});
		}
	}

	updateTeamCompositeRatings() {
		// Top 3 receivers, plus a bit more for others
		this.team[this.o].compositeRating.receiving = getCompositeFactor({
			playersOnField: this.playersOnField[this.o],
			positions: ["WR", "TE", "RB"],
			orderFunc: (p) => p.ovrs.WR,
			weightsMain: [5, 3, 2],
			weightsBonus: [0.5, 0.25],
			valFunc: (p) => p.ovrs.WR / 100,
		});
		this.team[this.o].compositeRating.rushing = getCompositeFactor({
			playersOnField: this.playersOnField[this.o],
			positions: ["RB", "WR", "QB"],
			orderFunc: (p) => p.ovrs.RB,
			weightsMain: [1],
			weightsBonus: [0.1],
			valFunc: (p) => (p.ovrs.RB / 100 + p.compositeRating.rushing) / 2,
		});

		// Top 5 blockers, plus a bit more from TE/RB if they exist
		this.team[this.o].compositeRating.passBlocking = getCompositeFactor({
			playersOnField: this.playersOnField[this.o],
			positions: ["OL", "TE", "RB"],
			orderFunc: (p) => p.ovrs.OL,
			weightsMain: [5, 4, 3, 3, 3],
			weightsBonus: [1, 0.5],
			valFunc: (p) => (p.ovrs.OL / 100 + p.compositeRating.passBlocking) / 2,
		});
		this.team[this.o].compositeRating.runBlocking = getCompositeFactor({
			playersOnField: this.playersOnField[this.o],
			positions: ["OL", "TE", "RB"],
			orderFunc: (p) => p.ovrs.OL,
			weightsMain: [5, 4, 3, 3, 3],
			weightsBonus: [1, 0.5],
			valFunc: (p) => (p.ovrs.OL / 100 + p.compositeRating.runBlocking) / 2,
		});
		this.team[this.d].compositeRating.passRushing = getCompositeFactor({
			playersOnField: this.playersOnField[this.d],
			positions: ["DL", "LB"],
			orderFunc: (p) => p.ovrs.DL,
			weightsMain: [5, 4, 3, 2, 1],
			weightsBonus: [],
			valFunc: (p) => (p.ovrs.DL / 100 + p.compositeRating.passRushing) / 2,
		});
		this.team[this.d].compositeRating.runStopping = getCompositeFactor({
			playersOnField: this.playersOnField[this.d],
			positions: ["DL", "LB", "S"],
			orderFunc: (p) => p.ovrs.DL,
			weightsMain: [5, 4, 3, 2, 2, 1, 1],
			weightsBonus: [0.5, 0.5],
			valFunc: (p) => (p.ovrs.DL / 100 + p.compositeRating.runStopping) / 2,
		});
		this.team[this.d].compositeRating.passCoverage = getCompositeFactor({
			playersOnField: this.playersOnField[this.d],
			positions: ["CB", "S", "LB"],
			orderFunc: (p) => p.ovrs.CB,
			weightsMain: [5, 4, 3, 2],
			weightsBonus: [1, 0.5],
			valFunc: (p) => (p.ovrs.CB / 100 + p.compositeRating.passCoverage) / 2,
		});
	}

	updatePlayersOnField(
		playType:
			| "starters"
			| "run"
			| "pass"
			| "extraPoint"
			| "fieldGoal"
			| "punt"
			| "kickoff",
	) {
		let formation: Formation;

		if (playType === "starters") {
			formation = formations.normal[0]!;
		} else if (playType === "run" || playType === "pass") {
			formation = random.choice(formations.normal);
		} else if (playType === "extraPoint" || playType === "fieldGoal") {
			formation = random.choice(formations.fieldGoal);
		} else if (playType === "punt") {
			formation = random.choice(formations.punt);
		} else if (playType === "kickoff") {
			formation = random.choice(formations.kickoff);
		} else {
			throw new Error(`Unknown playType "${playType}"`);
		}

		const sides = ["off", "def"] as const;

		for (const i of [0, 1] as const) {
			const t = i === 0 ? this.o : this.d;
			const side = sides[i];

			// Don't let one player be used at two positions!
			const pidsUsed = new Set();
			this.playersOnField[t] = {};

			for (const pos of helpers.keys(formation[side])) {
				const numPlayers = formation[side][pos]!;
				const players = this.team[t].depth[pos]
					.filter((p) => !p.injured)
					.filter((p) => !pidsUsed.has(p.id))
					.filter((p) => {
						// For some positions, filter out some players based on fatigue
						const positions = ["RB", "WR", "TE", "DL", "LB", "CB", "S"];

						if (!positions.includes(pos)) {
							return true;
						}

						return Math.random() < fatigue(p.stat.energy, p.injured);
					});
				this.playersOnField[t][pos] = players.slice(0, numPlayers);
				for (const p of this.playersOnField[t][pos]) {
					pidsUsed.add(p.id);
				}

				if (this.playersOnField[t][pos].length < numPlayers) {
					// Retry without ignoring fatigued players
					const players = this.team[t].depth[pos]
						.filter((p) => !p.injured)
						.filter((p) => !pidsUsed.has(p.id));
					this.playersOnField[t][pos].push(
						...players.slice(
							0,
							numPlayers - this.playersOnField[t][pos].length,
						),
					);
					for (const p of this.playersOnField[t][pos]) {
						pidsUsed.add(p.id);
					}

					// Retry without ignoring injured players
					if (this.playersOnField[t][pos].length < numPlayers) {
						const players = this.team[t].depth[pos].filter(
							(p) => !pidsUsed.has(p.id),
						);
						this.playersOnField[t][pos].push(
							...players.slice(
								0,
								numPlayers - this.playersOnField[t][pos].length,
							),
						);
						for (const p of this.playersOnField[t][pos]) {
							pidsUsed.add(p.id);
						}
					}
				}

				for (const p of this.playersOnField[t][pos]) {
					if (playType === "starters") {
						this.recordStat(t, p, "gs");
					}
					this.recordStat(t, p, "gp");
				}
			}
		}

		this.updateTeamCompositeRatings();
	}

	doTimeout(t: TeamNum) {
		if (this.timeouts[t] <= 0) {
			return;
		}

		this.timeouts[t] -= 1;
		this.logTimeouts();
		this.isClockRunning = false;
		this.playByPlay.logEvent({
			type: "timeout",
			clock: this.clock,
			offense: t === this.o,
			numLeft: this.timeouts[t],
			t,
		});
	}

	doKickoff(onside: boolean = false) {
		this.updatePlayersOnField("kickoff");
		const kicker = this.getTopPlayerOnField(this.o, "K");
		let dt = 0;

		if (onside) {
			dt = random.randInt(2, 5);
			const kickTo = random.randInt(40, 55);
			this.currentPlay.addEvent({
				type: "onsideKick",
				kickTo,
			});
			this.playByPlay.logEvent({
				type: "onsideKick",
				clock: this.clock,
				names: [kicker.name],
				t: this.o,
			});
			const success = Math.random() < 0.1 * g.get("onsideRecoveryFactor");

			const p = success ? this.pickPlayer(this.o) : this.pickPlayer(this.d);

			let yds = 0;
			if (!success) {
				this.currentPlay.addEvent({
					type: "possessionChange",
					yds: 0,
					kickoff: true,
				});

				const rawLength = Math.random() < 0.003 ? 100 : random.randInt(0, 5);
				yds = this.currentPlay.boundedYds(rawLength);
				dt += Math.abs(yds) / 8;
			}

			const { td } = this.currentPlay.addEvent({
				type: "onsideKickRecovery",
				success,
				p,
				yds,
			});

			if (td) {
				this.currentPlay.addEvent({
					type: "krTD",
					p,
				});
			} else {
				this.doTackle({
					ydsFromScrimmage: undefined,
				});
			}

			this.playByPlay.logEvent({
				type: "onsideKickRecovery",
				clock: this.clock,
				names: [p.name],
				success,
				t: this.currentPlay.state.current.o,
				td,
			});
		} else {
			const kickReturner = this.getTopPlayerOnField(this.d, "KR");
			const kickTo = this.awaitingAfterSafety
				? random.randInt(15, 35)
				: random.randInt(-10, 10);
			const touchback = kickTo <= -10 || (kickTo < 0 && Math.random() < 0.8);
			this.currentPlay.addEvent({
				type: "k",
				kickTo,
			});
			this.playByPlay.logEvent({
				type: "kickoff",
				clock: this.clock,
				names: [kicker.name],
				t: this.o,
				touchback,
				yds: kickTo,
			});

			this.currentPlay.addEvent({
				type: "possessionChange",
				yds: 0,
				kickoff: true,
			});
			if (touchback) {
				this.currentPlay.addEvent({
					type: "touchbackKick",
				});
			} else {
				let ydsRaw = Math.round(random.truncGauss(20, 5, -10, 109));

				if (Math.random() < 0.02) {
					ydsRaw += random.randInt(0, 109);
				}

				const returnLength = this.currentPlay.boundedYds(ydsRaw);
				dt = Math.abs(returnLength) / 8;

				this.checkPenalties("kickoffReturn", {
					ballCarrier: kickReturner,
					playYds: returnLength,
				});

				const { td } = this.currentPlay.addEvent({
					type: "kr",
					p: kickReturner,
					yds: returnLength,
				});

				if (td) {
					this.currentPlay.addEvent({
						type: "krTD",
						p: kickReturner,
					});
				} else {
					this.doTackle({
						ydsFromScrimmage: undefined,
					});
				}

				this.playByPlay.logEvent({
					type: "kickoffReturn",
					clock: this.clock,
					names: [kickReturner.name],
					t: this.currentPlay.state.current.o,
					td,
					yds: returnLength,
				});
			}
		}

		this.recordStat(this.currentPlay.state.current.o, undefined, "drives");
		this.recordStat(
			this.currentPlay.state.current.o,
			undefined,
			"totStartYds",
			this.currentPlay.state.current.scrimmage,
		);

		return dt;
	}

	doPunt() {
		this.playByPlay.logEvent({
			type: "puntTeam",
			clock: this.clock,
			t: this.o,
		});

		this.updatePlayersOnField("punt");
		const penInfo = this.checkPenalties("beforeSnap");

		if (penInfo) {
			return 0;
		}

		const punter = this.getTopPlayerOnField(this.o, "P");
		const puntReturner = this.getTopPlayerOnField(this.d, "PR");
		const adjustment = (punter.compositeRating.punting - 0.6) * 20; // 100 ratings - 8 yd bonus. 0 ratings - 12 yard penalty

		const maxDistance = 109 - this.scrimmage;
		const distance = Math.min(
			Math.round(random.truncGauss(44 + adjustment, 8, 25, 90)),
			maxDistance,
		);
		let dt = random.randInt(5, 9);

		this.checkPenalties("punt");

		const { touchback } = this.currentPlay.addEvent({
			type: "p",
			p: punter,
			yds: distance,
		});

		this.playByPlay.logEvent({
			type: "punt",
			clock: this.clock,
			names: [punter.name],
			t: this.o,
			touchback,
			yds: distance,
		});

		this.currentPlay.addEvent({
			type: "possessionChange",
			yds: 0,
		});

		if (touchback) {
			this.currentPlay.addEvent({
				type: "touchbackPunt",
				p: punter,
			});
		} else {
			const maxReturnLength = 100 - this.currentPlay.state.current.scrimmage;
			let ydsRaw = Math.round(random.truncGauss(10, 10, -10, 109));

			if (Math.random() < 0.03) {
				ydsRaw += random.randInt(0, 109);
			}

			const returnLength = helpers.bound(ydsRaw, 0, maxReturnLength);
			dt += Math.abs(returnLength) / 8;
			this.checkPenalties("puntReturn", {
				ballCarrier: puntReturner,
				playYds: returnLength,
			});

			const { td } = this.currentPlay.addEvent({
				type: "pr",
				p: puntReturner,
				yds: returnLength,
			});

			if (td) {
				this.currentPlay.addEvent({
					type: "prTD",
					p: puntReturner,
				});
			} else {
				this.doTackle({
					ydsFromScrimmage: undefined,
				});
			}

			this.playByPlay.logEvent({
				type: "puntReturn",
				clock: this.clock,
				names: [puntReturner.name],
				t: this.currentPlay.state.current.o,
				td,
				yds: returnLength,
			});
		}

		this.recordStat(this.currentPlay.state.current.o, undefined, "drives");
		this.recordStat(
			this.currentPlay.state.current.o,
			undefined,
			"totStartYds",
			this.currentPlay.state.current.scrimmage,
		);

		return dt;
	}

	probMadeFieldGoal(kickerInput?: PlayerGameSim) {
		const kicker =
			kickerInput !== undefined
				? kickerInput
				: this.team[this.o].depth.K.find((p) => !p.injured);
		let baseProb = 0;
		let distance =
			100 - this.scrimmage + FIELD_GOAL_DISTANCE_YARDS_ADDED_FROM_SCRIMMAGE;

		if (!kicker) {
			// Would take an absurd amount of injuries to get here, but technically possible
			return 0;
		}

		// Kickers with strong/weak legs effectively have adjusted distances: -5 yds for 100, +15 yds for 0
		distance += -(kicker.compositeRating.kickingPower - 0.75) * 20;

		if (distance < 20) {
			baseProb = 0.99;
		} else if (distance < 30) {
			baseProb = 0.98;
		} else if (distance < 35) {
			baseProb = 0.95;
		} else if (distance < 37) {
			baseProb = 0.94;
		} else if (distance < 38) {
			baseProb = 0.93;
		} else if (distance < 39) {
			baseProb = 0.92;
		} else if (distance < 40) {
			baseProb = 0.91;
		} else if (distance < 41) {
			baseProb = 0.89;
		} else if (distance < 42) {
			baseProb = 0.87;
		} else if (distance < 43) {
			baseProb = 0.85;
		} else if (distance < 44) {
			baseProb = 0.83;
		} else if (distance < 45) {
			baseProb = 0.81;
		} else if (distance < 46) {
			baseProb = 0.79;
		} else if (distance < 47) {
			baseProb = 0.77;
		} else if (distance < 48) {
			baseProb = 0.75;
		} else if (distance < 49) {
			baseProb = 0.73;
		} else if (distance < 50) {
			baseProb = 0.71;
		} else if (distance < 51) {
			baseProb = 0.69;
		} else if (distance < 52) {
			baseProb = 0.65;
		} else if (distance < 53) {
			baseProb = 0.61;
		} else if (distance < 54) {
			baseProb = 0.59;
		} else if (distance < 55) {
			baseProb = 0.55;
		} else if (distance < 56) {
			baseProb = 0.51;
		} else if (distance < 57) {
			baseProb = 0.47;
		} else if (distance < 58) {
			baseProb = 0.43;
		} else if (distance < 59) {
			baseProb = 0.39;
		} else if (distance < 60) {
			baseProb = 0.35;
		} else if (distance < 61) {
			baseProb = 0.3;
		} else if (distance < 62) {
			baseProb = 0.25;
		} else if (distance < 63) {
			baseProb = 0.2;
		} else if (distance < 64) {
			baseProb = 0.1;
		} else if (distance < 65) {
			baseProb = 0.05;
		} else if (distance < 70) {
			baseProb = 0.005;
		} else if (distance < 75) {
			baseProb = 0.0001;
		} else if (distance < 80) {
			baseProb = 0.000001;
		} else {
			baseProb = 0;
		}

		baseProb *= g.get("fgAccuracyFactor");
		if (baseProb > 0.99) {
			baseProb = 0.99;
		}

		// Accurate kickers get a boost. Max boost is the min of (.1, (1-baseProb)/2, and baseProb/2)
		const baseBoost = (kicker.compositeRating.kickingAccuracy - 0.7) / 3;
		const boost = Math.min(baseBoost, (1 - baseProb) / 2, baseProb / 2);

		return baseProb + boost;
	}

	doFieldGoal(playType: "extraPoint" | "fieldGoal" | "fieldGoalLate") {
		this.updatePlayersOnField("fieldGoal");

		const extraPoint = playType === "extraPoint";
		const distance =
			100 - this.scrimmage + FIELD_GOAL_DISTANCE_YARDS_ADDED_FROM_SCRIMMAGE;
		const kicker = this.getTopPlayerOnField(this.o, "K");

		this.playByPlay.logEvent({
			type: extraPoint ? "extraPointAttempt" : "fieldGoalAttempt",
			clock: this.clock,
			names: [kicker.name],
			t: this.o,
			yds: distance,
		});

		if (!extraPoint) {
			const penInfo = this.checkPenalties("beforeSnap");

			if (penInfo) {
				return 0;
			}
		}

		const made = Math.random() < this.probMadeFieldGoal(kicker);
		const dt = extraPoint ? 0 : random.randInt(4, 6);
		if (!extraPoint) {
			this.checkPenalties("fieldGoal");
		}

		if (extraPoint) {
			this.currentPlay.addEvent({
				type: "xp",
				p: kicker,
				made,
				distance,
			});
		} else {
			this.currentPlay.addEvent({
				type: "fg",
				p: kicker,
				made,
				distance,
				late: playType === "fieldGoalLate",
			});

			if (!made) {
				this.currentPlay.addEvent({
					type: "possessionChange",
					yds: -7,
				});
			}
		}

		this.playByPlay.logEvent({
			type: extraPoint ? "extraPoint" : "fieldGoal",
			clock: this.clock,
			made,
			names: [kicker.name],
			t: this.o,
			yds: distance,
		});

		return dt;
	}

	doTwoPointConversion() {
		const getPts = () =>
			this.currentPlay.state.current.pts[0] +
			this.currentPlay.state.current.pts[1];

		const twoPointConversionTeam = this.o;

		this.currentPlay.addEvent({
			type: "twoPointConversion",
			t: twoPointConversionTeam,
		});

		this.twoPointConversionTeam = twoPointConversionTeam;

		this.playByPlay.logEvent({
			type: "twoPointConversion",
			clock: this.clock,
			t: twoPointConversionTeam,
		});

		const ptsBefore = getPts();

		const probPass = 0.5 * g.get("passFactor");

		if (Math.random() < probPass) {
			this.doPass();
		} else {
			this.doRun();
		}

		const ptsAfter = getPts();

		const made = ptsAfter > ptsBefore;

		this.currentPlay.addEvent({
			type: "twoPointConversionDone",
			t: twoPointConversionTeam,
			made,
		});

		if (!made) {
			// Must have failed!
			this.playByPlay.logEvent({
				type: "twoPointConversionFailed",
				clock: this.clock,
				t: twoPointConversionTeam,
			});
		}

		this.twoPointConversionTeam = undefined;

		return 0;
	}

	probFumble(p: PlayerGameSim) {
		return (
			0.0125 * (1.5 - p.compositeRating.ballSecurity) * g.get("fumbleFactor")
		);
	}

	doFumble(pFumbled: PlayerGameSim, spotYds: number) {
		const { o, d } = this.currentPlay.state.current;
		const pForced = this.pickPlayer(d, "tackling");
		this.currentPlay.addEvent({
			type: "fmb",
			pFumbled,
			pForced,
			yds: spotYds,
		});

		this.playByPlay.logEvent({
			type: "fumble",
			clock: this.clock,
			names: [pFumbled.name, pForced.name],
			t: o,
		});

		const lost = Math.random() > 0.5;
		const tRecovered = lost ? d : o;
		const pRecovered = this.pickPlayer(tRecovered);

		let ydsRaw = Math.round(random.truncGauss(2, 6, -5, 15));

		if (Math.random() < (lost ? 0.01 : 0.0001)) {
			ydsRaw += random.randInt(0, 109);
		}

		if (lost) {
			this.currentPlay.addEvent({
				type: "possessionChange",
				yds: 0,
			});
		}

		const yds = this.currentPlay.boundedYds(ydsRaw);

		const { safety, td, touchback } = this.currentPlay.addEvent({
			type: "fmbRec",
			pFumbled,
			pRecovered,
			yds,
			lost,
		});

		let dt = Math.abs(yds) / 6;

		let fumble = false;

		if (!touchback) {
			if (td) {
				this.currentPlay.addEvent({
					type: "fmbTD",
					p: pRecovered,
				});
			} else if (safety) {
				this.doSafety();
			} else if (Math.random() < this.probFumble(pRecovered)) {
				fumble = true;
			} else {
				this.doTackle({
					ydsFromScrimmage: undefined,
				});
			}
		}

		this.playByPlay.logEvent({
			type: "fumbleRecovery",
			clock: this.clock,
			lost,
			names: [pRecovered.name],
			safety,
			t: tRecovered,
			td,
			touchback,
			twoPointConversionTeam: this.twoPointConversionTeam,
			yds,
			ydsBefore: spotYds,
		});

		if (fumble) {
			dt += this.doFumble(pRecovered, 0);
		}

		return dt;
	}

	doInterception(qb: PlayerGameSim, ydsPass: number, p: PlayerGameSim) {
		this.playByPlay.logEvent({
			type: "interception",
			clock: this.clock,
			names: [p.name],
			t: this.currentPlay.state.current.d,
			twoPointConversionTeam: this.twoPointConversionTeam,
			yds: ydsPass,
		});

		this.currentPlay.addEvent({
			type: "possessionChange",
			yds: ydsPass,
		});

		let ydsRaw = Math.round(random.truncGauss(4, 6, -5, 15));

		if (Math.random() < 0.075) {
			ydsRaw += random.randInt(0, 109);
		}

		const yds = this.currentPlay.boundedYds(ydsRaw);
		let dt = Math.abs(yds) / 8;

		const { td, touchback } = this.currentPlay.addEvent({
			type: "int",
			qb,
			defender: p,
			ydsReturn: yds,
		});

		let fumble = false;

		if (touchback) {
			this.currentPlay.addEvent({
				type: "touchbackInt",
			});
		} else if (td) {
			this.currentPlay.addEvent({
				type: "intTD",
				p,
			});
		} else if (Math.random() < this.probFumble(p)) {
			fumble = true;
		} else {
			this.doTackle({
				ydsFromScrimmage: undefined,
			});
		}

		this.playByPlay.logEvent({
			type: "interceptionReturn",
			clock: this.clock,
			names: [p.name],
			t: this.currentPlay.state.current.o,
			td,
			touchback,
			twoPointConversionTeam: this.twoPointConversionTeam,
			yds,
		});

		if (fumble) {
			dt += this.doFumble(p, 0);
		}

		return dt;
	}

	doSafety(p?: PlayerGameSim) {
		if (!p) {
			p = this.pickPlayer(
				this.d,
				Math.random() < 0.5 ? "passRushing" : "runStopping",
			);
		}

		this.currentPlay.addEvent({
			type: "defSft",
			p,
		});
	}

	doSack(qb: PlayerGameSim) {
		const p = this.pickPlayer(
			this.currentPlay.state.initial.d,
			"passRushing",
			undefined,
			5,
		);
		const ydsRaw = random.randInt(-1, -12);
		const yds = this.currentPlay.boundedYds(ydsRaw);

		const { safety } = this.currentPlay.addEvent({
			type: "sk",
			qb,
			p,
			yds,
		});

		if (safety) {
			this.doSafety(p);
		}

		this.playByPlay.logEvent({
			type: "sack",
			clock: this.clock,
			names: [qb.name, p.name],
			safety,
			t: this.currentPlay.state.initial.o,
			yds,
		});

		return random.randInt(3, 8);
	}

	probSack(qb: PlayerGameSim) {
		return (
			((0.06 * this.team[this.d].compositeRating.passRushing) /
				(0.5 *
					(qb.compositeRating.avoidingSacks +
						this.team[this.o].compositeRating.passBlocking))) *
			g.get("sackFactor")
		);
	}

	probInt(qb: PlayerGameSim, defender: PlayerGameSim) {
		return (
			((((0.004 * this.team[this.d].compositeRating.passCoverage +
				0.022 * defender.compositeRating.passCoverage) /
				(0.5 *
					(qb.compositeRating.passingVision +
						qb.compositeRating.passingAccuracy))) *
				this.team[this.d].compositeRating.passRushing) /
				this.team[this.o].compositeRating.passBlocking) *
			g.get("intFactor")
		);
	}

	probComplete(
		qb: PlayerGameSim,
		target: PlayerGameSim,
		defender: PlayerGameSim,
	) {
		const factor =
			((0.2 *
				(target.compositeRating.catching +
					target.compositeRating.gettingOpen +
					qb.compositeRating.passingAccuracy +
					qb.compositeRating.passingDeep +
					qb.compositeRating.passingVision)) /
				(0.5 *
					(defender.compositeRating.passCoverage +
						this.team[this.d].compositeRating.passCoverage))) *
			Math.sqrt(
				this.team[this.o].compositeRating.passBlocking /
					this.team[this.d].compositeRating.passRushing,
			);
		const p = (0.24 + 0.4 * factor ** 1.25) * g.get("completionFactor");
		return helpers.bound(p, 0, 0.95);
	}

	probScramble(qb?: PlayerGameSim) {
		const qbOvrRB = qb?.ovrs.RB ?? 0;
		return (
			(0.01 + Math.max(0, (0.35 * (qbOvrRB - 30)) / 100)) *
			g.get("scrambleFactor")
		);
	}

	doPass() {
		const o = this.o;
		const d = this.d;

		this.updatePlayersOnField("pass");
		const penInfo = this.checkPenalties("beforeSnap");

		if (penInfo) {
			return 0;
		}

		const qb = this.getTopPlayerOnField(o, "QB");
		this.currentPlay.addEvent({
			type: "dropback",
		});
		this.playByPlay.logEvent({
			type: "dropback",
			clock: this.clock,
			names: [qb.name],
			t: o,
		});
		let dt = random.randInt(2, 6);

		if (Math.random() < 0.75 && Math.random() < this.probFumble(qb)) {
			const yds = this.currentPlay.boundedYds(random.randInt(-1, -10));
			return dt + this.doFumble(qb, yds);
		}

		const sack = Math.random() < this.probSack(qb);

		if (sack) {
			return this.doSack(qb);
		}

		if (this.probScramble(this.playersOnField[o].QB?.[0]) > Math.random()) {
			return this.doRun(true);
		}

		const target = this.pickPlayer(
			o,
			Math.random() < 0.2 ? "catching" : "gettingOpen",
			["WR", "TE", "RB"],
		);

		// RB passes are often short, so 50% chance of a decrease in yardage, which is more severe for players with low gettingOpen
		const rbFactor =
			this.playersOnField[o].RB?.includes(target) && Math.random() < 0.75
				? target.compositeRating.gettingOpen
				: 1;

		let ydsRaw = Math.round(
			random.truncGauss(
				// Bound is so (in extreme contrived cases like 0 ovr teams) meanYds can't go too far above/below the truncGauss limits
				helpers.bound(
					rbFactor *
						8.3 *
						(this.team[o].compositeRating.passBlocking /
							this.team[d].compositeRating.passRushing),
					-5,
					100,
				),
				rbFactor * 7,
				-5,
				100,
			),
		);

		if (Math.random() < qb.compositeRating.passingDeep * 0.05) {
			ydsRaw += random.randInt(0, 109);
		}

		// Adjust for receiver speed
		ydsRaw += Math.round((target.compositeRating.speed - 0.5) * 10);
		if (Math.random() < target.compositeRating.speed * 0.03) {
			ydsRaw += random.randInt(0, 109);
		}

		// Fewer TFL
		if (ydsRaw < 0) {
			ydsRaw += random.randInt(0, 5);
		}

		ydsRaw = Math.round(ydsRaw * g.get("passYdsFactor"));

		const yds = this.currentPlay.boundedYds(ydsRaw);

		const defender = this.pickPlayer(d, "passCoverage", undefined, 2);
		const complete = Math.random() < this.probComplete(qb, target, defender);
		const interception = Math.random() < this.probInt(qb, defender);

		this.checkPenalties("pass", {
			ballCarrier: target,
			playYds: yds,
			incompletePass: !complete && !interception,
		});

		this.currentPlay.addEvent({
			type: "pss",
			qb,
			target,
		});

		if (interception) {
			dt += this.doInterception(qb, yds, defender);
		} else {
			dt += Math.abs(yds) / 20;

			if (complete) {
				const { td, safety } = this.currentPlay.addEvent({
					type: "pssCmp",
					qb,
					target,
					yds,
				});

				// Don't log here, because we need to log all the stats first, otherwise live box score will update slightly out of order
				const completeEvent = {
					type: "passComplete",
					clock: this.clock,
					names: [qb.name, target.name] as string[],
					safety,
					t: o,
					td,
					twoPointConversionTeam: this.twoPointConversionTeam,
					yds,
				} as const;

				// Fumble after catch... only if nothing else is going on, too complicated otherwise
				if (!td && !safety) {
					if (Math.random() < this.probFumble(target)) {
						this.playByPlay.logEvent(completeEvent);
						return dt + this.doFumble(target, 0);
					}
				}

				if (td) {
					this.currentPlay.addEvent({
						type: "pssTD",
						qb,
						target,
					});
				}

				// Do safety before logging event, otherwise pts for safety show up on the next play (kickoff)
				if (safety) {
					this.doSafety();
				}

				this.playByPlay.logEvent(completeEvent);

				if (!td && !safety) {
					this.doTackle({
						ydsFromScrimmage: yds,
					});
				}
			} else {
				this.currentPlay.addEvent({
					type: "pssInc",
					defender: Math.random() < 0.28 ? defender : undefined,
				});

				this.playByPlay.logEvent({
					type: "passIncomplete",
					clock: this.clock,
					names: [qb.name, target.name],
					t: o,
					yds,
				});
			}
		}

		return dt;
	}

	doRun(qbScramble: boolean = false) {
		const o = this.o;
		const d = this.d;

		if (!qbScramble) {
			this.updatePlayersOnField("run");
			const penInfo = this.checkPenalties("beforeSnap");

			if (penInfo) {
				return 0;
			}
		}

		// Usually do normal run, but sometimes do special stuff
		let positions: Position[];
		if (qbScramble) {
			positions = ["QB"];
		} else {
			positions = ["RB"];
			const rand = Math.random();

			const rbs = this.playersOnField[o].RB || [];

			if (rand < 0.5 || rbs.length === 0) {
				positions.push("QB");
			} else if (rand < 0.59 || rbs.length === 0) {
				positions.push("WR");
			}
		}

		// Scrambles tend to be longer runs
		const scrambleModifier = qbScramble ? 3 : 1;

		const p = this.pickPlayer(o, "rushing", positions);
		const qb = this.getTopPlayerOnField(o, "QB");
		this.playByPlay.logEvent({
			type: "handoff",
			clock: this.clock,
			t: o,
			names: p === qb ? [qb.name] : [qb.name, p.name],
		});

		// Bound is so (in extreme contrived cases like 0 ovr teams) meanYds can't go too far above/below the truncGauss limits
		const meanYds = helpers.bound(
			(scrambleModifier *
				(3.5 *
					0.5 *
					(p.compositeRating.rushing +
						this.team[o].compositeRating.runBlocking))) /
				this.team[d].compositeRating.runStopping,
			-5,
			15,
		);
		let ydsRaw = Math.round(random.truncGauss(meanYds, 6, -5, 15));

		if (Math.random() < 0.01) {
			ydsRaw += random.randInt(0, 109);
		}

		// Fewer TFL
		if (ydsRaw < 0) {
			ydsRaw += random.randInt(0, 5);
		}

		ydsRaw = Math.round(ydsRaw * g.get("rushYdsFactor"));

		const yds = this.currentPlay.boundedYds(ydsRaw);
		const dt = random.randInt(2, 4) + Math.abs(yds) / 10;

		this.checkPenalties("run", {
			ballCarrier: p,
			playYds: yds,
		});

		const { td, safety } = this.currentPlay.addEvent({
			type: "rus",
			p,
			yds,
		});

		if (td) {
			this.currentPlay.addEvent({
				type: "rusTD",
				p,
			});
		} else if (safety) {
			this.doSafety();
		} else {
			this.doTackle({
				ydsFromScrimmage: yds,
			});
		}

		this.playByPlay.logEvent({
			type: "run",
			clock: this.clock,
			names: [p.name],
			safety,
			t: o,
			td,
			twoPointConversionTeam: this.twoPointConversionTeam,
			yds,
		});

		// Fumble after run... only if nothing else is going on, too complicated otherwise
		if (!td && !safety) {
			if (Math.random() < this.probFumble(p)) {
				this.awaitingAfterTouchdown = false; // In case set by this.advanceYds

				return dt + this.doFumble(p, 0);
			}
		}

		return dt;
	}

	doKneel() {
		const o = this.o;

		this.updatePlayersOnField("run");

		const qb = this.getTopPlayerOnField(o, "QB");

		const yds = random.randInt(0, -3);

		this.currentPlay.addEvent({
			type: "kneel",
			p: qb,
			yds,
		});

		this.playByPlay.logEvent({
			type: "kneel",
			clock: this.clock,
			names: [qb.name],
			t: o,
			yds,
		});

		const dt = random.randInt(42, 44);

		return dt;
	}

	// Call this before actually advancing the ball, because different logic will apply if it's a spot foul or not
	checkPenalties(
		playType: PenaltyPlayType,
		{
			ballCarrier,
			incompletePass = false,
			playYds = 0,
		}: {
			ballCarrier?: PlayerGameSim;
			incompletePass?: boolean;
			playYds?: number;
		} = {
			ballCarrier: undefined,
			incompletePass: false,
			playYds: 0,
		},
	): boolean {
		// No penalties during two-point conversion, because it is not handled well currently (no logic to support retrying conversion/xp)
		if (this.currentPlay.state.current.twoPointConversionTeam !== undefined) {
			return false;
		}

		// At most 2 penalties on a play, otherwise it can get tricky to figure out what to accept (need to consider the other coach as intelligent and anticipate what he would do, minimax)
		const maxNumPenaltiesAllowed = 2 - this.currentPlay.numPenalties;
		if (maxNumPenaltiesAllowed <= 0) {
			return false;
		}

		const foulRateFactor = g.get("foulRateFactor");

		let called = penalties.filter((pen) => {
			if (!pen.playTypes.includes(playType)) {
				return false;
			}

			return Math.random() < pen.probPerPlay * foulRateFactor;
		});

		if (called.length === 0) {
			// if (called.length === 0 && playType !== "puntReturn") {
			return false;
		}

		// Always do multiple penalties for testing
		/*called = penalties.filter(pen => {
			if (!pen.playTypes.includes(playType)) {
				return false;
			}

			return true;
		});*/

		if (called.length > maxNumPenaltiesAllowed) {
			random.shuffle(called);
			called = called.slice(0, maxNumPenaltiesAllowed);
		}

		const scrimmage = this.currentPlay.state.current.scrimmage;

		const penInfos = called.map((pen) => {
			let spotYds: number | undefined;

			const t =
				pen.side === "offense"
					? this.currentPlay.state.current.o
					: this.currentPlay.state.current.d;

			const isReturn =
				playType === "kickoffReturn" || playType === "puntReturn";

			const tackOn =
				(pen.tackOn && playYds > 0 && !incompletePass) ||
				(isReturn && pen.side === "defense");

			if ((pen.spotFoul || (isReturn && pen.side === "offense")) && !tackOn) {
				if (pen.side === "offense" && playYds > 0) {
					// Offensive spot foul - only when past the line of scrimmage
					spotYds = random.randInt(1, playYds);

					// Don't let it be in the endzone, otherwise shit gets weird with safeties
					if (spotYds + scrimmage < 1) {
						spotYds = 1 - scrimmage;
					}
				} else if (pen.side === "defense" && !isReturn) {
					// Defensive spot foul - could be in secondary too
					spotYds = random.randInt(0, playYds);
				}

				if (spotYds !== undefined) {
					// On kickoff returns, penalties are very unlikely to occur extremely deep
					if (playType === "kickoffReturn" && spotYds + scrimmage <= 10) {
						spotYds += random.randInt(10, playYds);
					}
				}
			} else if (tackOn) {
				spotYds = playYds;
			}

			if (spotYds !== undefined) {
				if (spotYds + scrimmage > 99) {
					spotYds = 99 - scrimmage;
				}
			}

			return {
				automaticFirstDown: !!pen.automaticFirstDown,
				name: pen.name,
				penYds: pen.yds,
				posOdds: pen.posOdds,
				spotYds,
				t,
				tackOn,
			};
		});

		for (const penInfo of penInfos) {
			let p: PlayerGameSim | undefined;

			const posOdds = penInfo.posOdds;

			if (posOdds !== undefined) {
				const positionsOnField = helpers.keys(this.playersOnField[penInfo.t]);
				const positionsForPenalty = helpers.keys(posOdds);
				const positions = positionsOnField.filter((pos) =>
					positionsForPenalty.includes(pos),
				);

				if (positions.length > 0) {
					// https://github.com/microsoft/TypeScript/issues/21732
					// @ts-expect-error
					const pos = random.choice(positions, (pos2) => posOdds[pos2]);

					const players = this.playersOnField[penInfo.t][pos];

					if (players !== undefined && players.length > 0) {
						p = random.choice(players);
					}
				}

				if (!p) {
					p = this.pickPlayer(penInfo.t);
				}

				// Ideally, when notBallCarrier is set, we should ensure that p is not the ball carrier.
			}

			this.currentPlay.addEvent({
				type: "penalty",
				p,
				automaticFirstDown: penInfo.automaticFirstDown,
				name: penInfo.name,
				penYds: penInfo.penYds,
				spotYds: penInfo.spotYds,
				t: penInfo.t,
				tackOn: penInfo.tackOn,
			});

			this.playByPlay.logEvent({
				type: "flag",
				clock: this.clock,
			});
		}

		return true;
	}

	updatePlayingTime(possessionTime: number) {
		this.recordStat(this.o, undefined, "timePos", possessionTime);
		const onField = new Set();

		for (const t of teamNums) {
			// Get rid of this after making sure playersOnField is always set, even for special teams
			if (this.playersOnField[t] === undefined) {
				continue;
			}

			for (const pos of helpers.keys(this.playersOnField[t])) {
				// Update minutes (overall, court, and bench)
				// https://github.com/microsoft/TypeScript/issues/21732
				// @ts-expect-error
				for (const p of this.playersOnField[t][pos]) {
					onField.add(p.id);
					this.recordStat(t, p, "min", possessionTime);
					this.recordStat(t, p, "courtTime", possessionTime);

					// This used to be 0.04. Increase more to lower PT
					this.recordStat(
						t,
						p,
						"energy",
						-0.08 * (1 - p.compositeRating.endurance),
					);

					if (p.stat.energy < 0) {
						p.stat.energy = 0;
					}
				}
			}

			for (const p of this.team[t].player) {
				if (!onField.has(p.id)) {
					this.recordStat(t, p, "benchTime", possessionTime);
					this.recordStat(t, p, "energy", 0.5);

					if (p.stat.energy > 1) {
						p.stat.energy = 1;
					}
				}
			}
		}
	}

	injuries() {
		if ((g as any).disableInjuries) {
			return;
		}

		for (const t of teamNums) {
			// Get rid of this after making sure playersOnField is always set, even for special teams
			if (this.playersOnField[t] === undefined) {
				continue;
			}

			const onField = new Set<any>();

			for (const pos of helpers.keys(this.playersOnField[t])) {
				// https://github.com/microsoft/TypeScript/issues/21732
				// @ts-expect-error
				for (const p of this.playersOnField[t][pos]) {
					onField.add(p);
				}
			}

			for (const p of onField) {
				// Modulate injuryRate by age - assume default is 25 yo, and increase/decrease by 3%
				const injuryRate = getInjuryRate(
					this.baseInjuryRate,
					p.age,
					p.injury.playingThrough,
				);

				if (Math.random() < injuryRate) {
					// 50% as many injuries for QB
					if (p.pos === "QB" && Math.random() < 0.5) {
						continue;
					}

					p.injured = true;
					p.newInjury = true;
					this.playByPlay.logEvent({
						type: "injury",
						clock: this.clock,
						injuredPID: p.id,
						names: [`${p.pos} ${p.name}`],
						t,
					});
				}
			}
		}
	}

	pickPlayer(
		t: TeamNum,
		rating?: CompositeRating,
		positions: Position[] = POSITIONS,
		power: number = 1,
	) {
		const players = getPlayers(this.playersOnField[t], positions);
		const weightFunc =
			rating !== undefined
				? (p: PlayerGameSim) =>
						(p.compositeRating[rating] * fatigue(p.stat.energy, p.injured)) **
						power
				: undefined;
		return random.choice(players, weightFunc);
	}

	// Pass undefined as p for some team-only stats
	recordStat(
		t: TeamNum,
		p: PlayerGameSim | undefined,
		s: string,
		amt: number = 1,
		remove?: boolean,
	) {
		const qtr = this.team[t].stat.ptsQtrs.length - 1;

		const signedAmount = remove ? -amt : amt;

		const isLng = s.endsWith("Lng");

		if (p !== undefined) {
			if (s === "gs" || s === "gp") {
				// gs check is in case player starts on offense and defense, only record once
				p.stat[s] = 1;
			} else if (isLng) {
				p.stat[s] = this.lngTracker.log("player", p.id, s, amt, remove);
			} else {
				p.stat[s] += signedAmount;
			}
		}

		if (
			s !== "gs" &&
			s !== "gp" &&
			s !== "courtTime" &&
			s !== "benchTime" &&
			s !== "energy"
		) {
			if (isLng) {
				this.team[t].stat[s] = this.lngTracker.log("player", t, s, amt, remove);
			} else {
				this.team[t].stat[s] += signedAmount;
			}

			if (p !== undefined && s !== "min") {
				const logAmount = isLng ? p.stat[s] : signedAmount;
				this.playByPlay.logStat(t, p.id, s, logAmount);
			} else if (
				p === undefined &&
				(s === "pts" ||
					s === "pen" ||
					s === "penYds" ||
					s === "sPts" ||
					s === "sAtt")
			) {
				// Team points, and also team penalties like delay of game, for the team penalty display at the top
				this.playByPlay.logStat(t, undefined, s, signedAmount);

				if (s === "pts") {
					this.team[t].stat.ptsQtrs[qtr] += signedAmount;
				}
			}
		}
	}
}

export default GameSim;
