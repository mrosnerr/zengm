import { Fragment, type ChangeEvent, useState, useEffect } from "react";
import { bySport, RATINGS } from "../../../common/index.ts";
import { getCol, helpers, toWorker } from "../../util/index.ts";

const rows = bySport<
	{
		[key: string]: string[];
	}[][]
>({
	baseball: [
		[
			{ "Physical/Hitting": ["hgt", "spd", "hpw", "con", "eye"] },
			{ Defense: ["gnd", "fly", "thr", "cat"] },
			{ Pitching: ["ppw", "ctl", "mov", "endu"] },
		],
	],
	basketball: [
		[
			{ Physical: ["hgt", "stre", "spd", "jmp", "endu"] },
			{ Shooting: ["ins", "dnk", "ft", "fg", "tp"] },
			{ Skill: ["oiq", "diq", "drb", "pss", "reb"] },
		],
	],
	football: [
		[
			{ Physical: ["hgt", "stre", "spd", "endu"] },
			{ Passing: ["thv", "thp", "tha"] },
			{ "Rush/Rec": ["elu", "rtr", "hnd", "bsc"] },
		],
		[
			{ Blocking: ["rbk", "pbk"] },
			{ Defense: ["pcv", "tck", "prs", "rns"] },
			{ Kicking: ["kpw", "kac", "ppw", "pac"] },
		],
	],
	hockey: [
		[
			{ Physical: ["hgt", "stre", "spd", "endu"] },
			{ Offense: ["oiq", "pss", "wst", "sst", "stk"] },
			{ Defense: ["diq", "chk", "blk", "fcf", "glk"] },
		],
	],
});

const RatingsForm = ({
	challengeNoRatings,
	godMode,
	handleChange,
	pos,
	ratingsRow,
}: {
	challengeNoRatings: boolean;
	godMode: boolean;
	handleChange: (
		type: string,
		field: string,
		event: ChangeEvent<HTMLInputElement>,
	) => void;
	pos: string;
	ratingsRow: any;
}) => {
	const [ovr, setOvr] = useState(ratingsRow.ovr);

	useEffect(() => {
		let mounted = true;
		(async () => {
			const boundedRatings = {
				...ratingsRow,
			};
			for (const key of RATINGS) {
				boundedRatings[key] = helpers.bound(boundedRatings[key], 0, 100);
			}

			const newOvr = await toWorker("main", "ovr", {
				ratings: boundedRatings,
				pos,
			});
			if (mounted) {
				setOvr(newOvr);
			}
		})();

		return () => {
			mounted = false;
		};
	}, [pos, ratingsRow]);

	const hideRatings = !godMode && challengeNoRatings;

	const fuzzRating = (
		ratingsRow: any,
		rating: string,
		ratingOverride?: number,
	) => {
		if (hideRatings) {
			return "";
		}

		const raw = ratingOverride ?? ratingsRow[rating];

		return godMode || rating === "hgt"
			? raw
			: Math.round(helpers.bound(raw + ratingsRow.fuzz, 0, 100));
	};

	return (
		<>
			{rows.map((row, i) => {
				return (
					<Fragment key={i}>
						<p>
							Overall:{" "}
							{Number.isNaN(ovr) ? (
								<span className="text-danger">error</span>
							) : (
								fuzzRating(ratingsRow, "ovr", ovr)
							)}
						</p>
						<div className="row">
							{row.map((block, j) => {
								return (
									<div key={j} className="col-4">
										{Object.entries(block).map(([title, ratings]) => {
											return (
												<Fragment key={title}>
													<h3>{title}</h3>
													{ratings.map((rating) => {
														return (
															<div key={rating} className="mb-3">
																<label className="form-label">
																	{getCol(`rating:${rating}`).desc}
																</label>
																<input
																	type="text"
																	className="form-control"
																	onChange={(event) => {
																		handleChange("rating", rating, event);
																	}}
																	value={fuzzRating(ratingsRow, rating)}
																	disabled={!godMode}
																/>
															</div>
														);
													})}
												</Fragment>
											);
										})}
									</div>
								);
							})}
						</div>
					</Fragment>
				);
			})}

			<div className="form-check mb-3">
				<input
					className="form-check-input"
					onChange={(event) => {
						handleChange("rating", "locked", event);
					}}
					type="checkbox"
					checked={!!ratingsRow.locked}
					disabled={!godMode}
					id="checkLockRatings"
				/>
				<label className="form-check-label" htmlFor="checkLockRatings">
					Lock ratings (ratings will not change as player ages)
				</label>
			</div>
		</>
	);
};

export default RatingsForm;
