import romanNumerals from "roman-numerals";
import { idb } from "../../db/index.ts";
import { face, g, helpers, random } from "../../util/index.ts";
import type { Player, Relative, RelativeType } from "../../../common/types.ts";
import player from "./index.ts";
import setJerseyNumber from "./setJerseyNumber.ts";
import {
	getTeammateJerseyNumbers,
	JERSEY_NUMBERS_BY_POSITION,
} from "./genJerseyNumber.ts";

const parseLastName = (lastName: string): [string, number | undefined] => {
	const parts = lastName.split(" ");

	if (parts.length === 1) {
		return [lastName, undefined];
	}

	const suffix = parts.at(-1)!;
	const parsedName = parts.slice(0, -1).join(" ");

	if (suffix === "Sr.") {
		return [parsedName, 1];
	}

	if (suffix === "Jr.") {
		return [parsedName, 2];
	}

	try {
		const suffixNumber = romanNumerals.toArabic(suffix);
		return [parsedName, suffixNumber];
	} catch (error) {
		if (error.message !== "toArabic expects a valid roman number") {
			throw error;
		}

		return [lastName, undefined];
	}
};

const getSuffix = (suffixNumber: number): string => {
	if (suffixNumber <= 2) {
		return "Jr.";
	}

	return romanNumerals.toRoman(suffixNumber);
};

const hasRelative = (p: Player, type: RelativeType) => {
	return p.relatives.some((relative) => relative.type === type);
};

const getRelatives = async (
	p: Player,
	type: RelativeType,
): Promise<Player[]> => {
	const pids = p.relatives
		.filter((rel) => rel.type === type)
		.map((rel) => rel.pid);
	const players = await idb.getCopies.players(
		{
			pids,
		},
		"noCopyCache",
	);

	return players.filter((p2) => !!p2);
};

const addRelative = (p: Player, relative: Relative) => {
	// Don't add duplicate
	if (
		p.relatives.some(
			({ type, pid }) => type === relative.type && pid === relative.pid,
		)
	) {
		return;
	}

	if (relative.type === "father") {
		p.relatives.unshift(relative);
	} else {
		p.relatives.push(relative);
	}
};

// Normally this code runs for a draft prospect, but in a new league it runs for random players already on teams! Great!
// This does not check if existingRelative.jerseyNumber is currently a valid number. If it's invalid, probably it was manually edited, so might as well keep it for fun
const makeSimilarJerseyNumber = async (
	existingRelative: Player,
	newRelative: Player,
) => {
	if (!existingRelative.jerseyNumber) {
		return;
	}

	if (JERSEY_NUMBERS_BY_POSITION) {
		if (
			existingRelative.ratings.at(-1).pos !== newRelative.ratings.at(-1).pos
		) {
			return;
		}
	}

	// Team conflict checks
	if (newRelative.tid >= 0) {
		const teammateJerseyNumbers = await getTeammateJerseyNumbers(
			newRelative.tid,
			newRelative.pid,
		);
		if (teammateJerseyNumbers.includes(existingRelative.jerseyNumber)) {
			return;
		}

		const t = await idb.cache.teams.get(newRelative.tid);
		if (t?.retiredJerseyNumbers) {
			for (const info of t.retiredJerseyNumbers) {
				// For retired jersey number, allow it if somehow the retired number belongs to the relative, just for fun
				if (
					info.number === existingRelative.jerseyNumber &&
					info.pid !== existingRelative.pid
				) {
					return;
				}
			}
		}
	}

	setJerseyNumber(newRelative, existingRelative.jerseyNumber);
};

// 50% chance of going to the same college and having the samer jersey number
const makeSimilar = async (existingRelative: Player, newRelative: Player) => {
	if (existingRelative.college !== "" && Math.random() < 0.5) {
		newRelative.college = existingRelative.college;
	}

	if (existingRelative.jerseyNumber && Math.random() < 0.5) {
		await makeSimilarJerseyNumber(existingRelative, newRelative);
	}

	if (!existingRelative.imgURL) {
		newRelative.face = face.generate({
			relative: existingRelative.face,
		});
	}
};

const applyNewCountry = async (p: Player, relative: Player) => {
	const relativeCountry = helpers.getCountry(relative.born.loc);
	const newCountry = helpers.getCountry(p.born.loc) !== relativeCountry;

	if (newCountry) {
		const { college, firstName, race } = await player.name(relativeCountry);

		p.college = college;
		p.firstName = firstName;

		// Generate new name and face
		p.face = face.generate({ race });
	}

	// Make them the same state/province, if USA/Canada
	p.born.loc = relative.born.loc;
};

export const makeSon = async (p: Player) => {
	// Sanity check - player must not already have father
	if (hasRelative(p, "father")) {
		return;
	}

	// Find a player from a draft 21-40 years ago to make the father
	const NUM_SEASONS_IN_NEW_LEAGUE_DEFAULT = 20;
	const maxYearsAgo = helpers.bound(
		p.draft.year -
			(g.get("startingSeason") - NUM_SEASONS_IN_NEW_LEAGUE_DEFAULT),
		21,
		40,
	);
	const draftYear = p.draft.year - random.randInt(21, maxYearsAgo);
	const possibleFathers = (
		await idb.getCopies.players(
			{
				draftYear,
			},
			"noCopyCache",
		)
	).filter(
		(father) =>
			typeof father.diedYear !== "number" || father.diedYear >= p.born.year,
	);

	if (possibleFathers.length === 0) {
		// League must be too new, draft class doesn't exist
		return;
	}

	const father = random.choice(possibleFathers, ({ lastName }) => {
		const out = parseLastName(lastName);

		if (typeof out[1] === "number") {
			// 10 for Sr, 15 for Jr, etc - make it more likely for older lineages to continue
			return helpers.bound(5 + 10 * out[1], 0, 40);
		}

		return 1;
	});
	const [fatherLastName, fatherSuffixNumber] = parseLastName(father.lastName);

	// Call this before giving the Jr. the father's first name, so father's name doesn't get overwritten
	await applyNewCountry(p, father);

	// Only rename to be a Jr if the father has no son yet (first is always Jr)
	if (!hasRelative(father, "son")) {
		const sonSuffixNumber =
			typeof fatherSuffixNumber === "number" ? fatherSuffixNumber + 1 : 2;
		const sonSuffix = getSuffix(sonSuffixNumber);

		p.firstName = father.firstName;
		p.lastName = `${fatherLastName} ${sonSuffix}`;

		if (fatherSuffixNumber === undefined) {
			father.lastName += ` Sr.`;
		}
	} else {
		p.lastName = fatherLastName;
	}

	// Handle case where father has other sons
	if (hasRelative(father, "son")) {
		const existingSons = await getRelatives(father, "son");

		for (const existingSon of existingSons) {
			// Add new brother to each of the existing sons
			addRelative(existingSon, {
				type: "brother",
				pid: p.pid,
				name: `${p.firstName} ${p.lastName}`,
			});
			await idb.cache.players.put(existingSon);

			// Add existing brothers to new son
			addRelative(p, {
				type: "brother",
				pid: existingSon.pid,
				name: `${existingSon.firstName} ${existingSon.lastName}`,
			});
		}
	}

	const relFather: Relative = {
		type: "father",
		pid: father.pid,
		name: `${father.firstName} ${father.lastName}`,
	};

	// Handle case where son already has other brothers
	if (hasRelative(p, "brother")) {
		const brothers = await getRelatives(p, "brother");

		for (const brother of brothers) {
			if (!hasRelative(brother, "father")) {
				// Add father to each brother (assuming they don't somehow already have another father)
				brother.born.loc = father.born.loc;
				addRelative(brother, relFather);
				await idb.cache.players.put(brother);

				// Add existing brothers as sons to father
				addRelative(father, {
					type: "son",
					pid: brother.pid,
					name: `${brother.firstName} ${brother.lastName}`,
				});
			}
		}
	}

	addRelative(p, relFather);
	addRelative(father, {
		type: "son",
		pid: p.pid,
		name: `${p.firstName} ${p.lastName}`,
	});
	await makeSimilar(father, p);
	await idb.cache.players.put(p);
	await idb.cache.players.put(father);
};

export const makeBrother = async (p: Player) => {
	// If p already has a brother, this would be hard to get right because the names of various players stored in Player.relatives would need to be updated. It's okay if the player picked to be p's brother has other brothers, though!
	if (hasRelative(p, "brother")) {
		return;
	}

	// If target player already has a father, can't change its last name as easily, but we might need to in applyNewCountry to make nationalities match
	if (hasRelative(p, "father")) {
		return;
	}

	// Find a player from a draft 0-5 years ago to make the brother
	const draftYear = p.draft.year - random.randInt(0, 5);
	const existingRelativePids = p.relatives.map((rel) => rel.pid);
	const possibleBrothers = (
		await idb.getCopies.players(
			{
				draftYear,
			},
			"noCopyCache",
		)
	).filter((p2) => {
		if (p2.pid === p.pid) {
			return false;
		}

		if (existingRelativePids.includes(p2.pid)) {
			return false;
		}

		return true;
	});

	if (possibleBrothers.length === 0) {
		// League must be too new, draft class doesn't exist
		return;
	}

	const brother = random.choice(possibleBrothers);

	// In case the brother is a Jr...
	const [keptLastName] = parseLastName(brother.lastName);
	p.lastName = keptLastName;

	await applyNewCountry(p, brother);

	const edgeCases = async (brother1: Player, brother2: Player) => {
		// Handle case where one brother already has a brother
		if (hasRelative(brother1, "brother")) {
			const brothers = await getRelatives(brother1, "brother");

			for (const otherBrother of brothers) {
				// Add brother to other brother
				addRelative(otherBrother, {
					type: "brother",
					pid: brother2.pid,
					name: `${brother2.firstName} ${brother2.lastName}`,
				});
				await idb.cache.players.put(otherBrother);

				// Add other brother to brother
				addRelative(brother2, {
					type: "brother",
					pid: otherBrother.pid,
					name: `${otherBrother.firstName} ${otherBrother.lastName}`,
				});
			}
		}

		// Handle case where one brother already has a father
		if (hasRelative(brother1, "father")) {
			const fathers = await getRelatives(brother1, "father");

			if (fathers[0]) {
				const father = fathers[0];

				// Add brother to father
				addRelative(father, {
					type: "son",
					pid: brother2.pid,
					name: `${brother2.firstName} ${brother2.lastName}`,
				});
				await idb.cache.players.put(father);

				// Add father to brother
				addRelative(brother2, {
					type: "father",
					pid: father.pid,
					name: `${father.firstName} ${father.lastName}`,
				});
			}
		}
	};

	await edgeCases(p, brother);
	await edgeCases(brother, p);
	addRelative(p, {
		type: "brother",
		pid: brother.pid,
		name: `${brother.firstName} ${brother.lastName}`,
	});
	addRelative(brother, {
		type: "brother",
		pid: p.pid,
		name: `${p.firstName} ${p.lastName}`,
	});
	await makeSimilar(brother, p);
	await idb.cache.players.put(p);
	await idb.cache.players.put(brother);
};

const addRelatives = async (p: Player) => {
	if (p.real) {
		return;
	}

	if (Math.random() < g.get("sonRate")) {
		await makeSon(p);
	}

	if (Math.random() < g.get("brotherRate")) {
		await makeBrother(p);
	}
};

export default addRelatives;
