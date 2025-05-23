import useTitleBar from "../hooks/useTitleBar.tsx";
import { getCols, gradientStyleFactory, helpers } from "../util/index.ts";
import { DataTable, MoreLinks } from "../components/index.tsx";
import type { View } from "../../common/types.ts";
import type { Col } from "../components/DataTable/index.tsx";
import clsx from "clsx";
import { useState } from "react";

const gradientStyle = gradientStyleFactory(0.38, 0.49, 0.51, 0.62);

const HeadToHeadAll = ({
	infoByTidByTid,
	season,
	teams,
	type,
	userTid,
}: View<"headToHeadAll">) => {
	useTitleBar({
		title: "Head-to-Head",
		dropdownView: "head2head_all",
		dropdownFields: {
			seasonsAndAll: season,
			playoffsCombined: type,
		},
	});

	const [showInactive, setShowInactive] = useState(true);

	const hasInactiveTeams = season === "all" && teams.some((t) => t.disabled);

	const teamsFiltered =
		!hasInactiveTeams || showInactive
			? teams
			: teams.filter((t) => !t.disabled);

	const cols = [
		...getCols(["Team"]),
		...teamsFiltered.map((t): Col => {
			return {
				classNames: clsx(
					"text-center",
					userTid === t.tid ? "table-info" : undefined,
				),
				desc: `${t.region} ${t.name}`,
				sortSequence: ["desc", "asc"],
				sortType: "number",
				title: t.abbrev,
			};
		}),
	];

	const rows = teamsFiltered.map((t) => {
		const infoByTid = infoByTidByTid.get(t.tid);

		return {
			classNames: "text-center",
			key: t.tid,
			data: [
				{
					classNames: clsx(userTid === t.tid ? "table-info" : undefined),
					value: (
						<a
							href={helpers.leagueUrl([
								"head2head",
								`${t.abbrev}_${t.tid}`,
								season,
								type,
							])}
						>
							{t.abbrev}
						</a>
					),
				},
				...teamsFiltered.map((t2) => {
					const info = infoByTid?.get(t2.tid);
					if (!info) {
						return null;
					}

					return {
						style: gradientStyle(info.winp),
						title: `${t.abbrev}'s record vs ${t2.abbrev}`,
						value: (
							<>
								{helpers.roundWinp(info.winp)}
								<br />
								<small>{helpers.formatRecord(info)}</small>
							</>
						),
					};
				}),
			],
		};
	});

	return (
		<>
			<MoreLinks type="league" page="head2head_all" />

			{rows.length === 0 ? (
				<p>No data {season !== "all" ? "for this season yet" : "yet"}.</p>
			) : (
				<>
					<div>
						Each table cell shows the row team's record vs the column team.
					</div>

					{hasInactiveTeams ? (
						<button
							className="btn btn-secondary mt-3"
							onClick={() => {
								setShowInactive((show) => !show);
							}}
						>
							{showInactive ? "Hide inactive teams" : "Show inactive teams"}
						</button>
					) : null}

					<DataTable
						cols={cols}
						defaultSort={[0, "asc"]}
						defaultStickyCols={1}
						hideAllControls
						name="HeadToHeadAll"
						rows={rows}
						striped={false}
					/>
				</>
			)}
		</>
	);
};

export default HeadToHeadAll;
