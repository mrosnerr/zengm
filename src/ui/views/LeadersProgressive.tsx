import useTitleBar from "../hooks/useTitleBar.tsx";
import { getCols, helpers } from "../util/index.ts";
import { DataTable, MoreLinks } from "../components/index.tsx";
import type { View } from "../../common/types.ts";
import { LeadersTopText } from "./Leaders.tsx";
import { formatStatsDropdown } from "./LeadersYears.tsx";
import { wrappedPlayerNameLabels } from "../components/PlayerNameLabels.tsx";
import type { DataTableRow } from "../components/DataTable/index.tsx";

const LeadersProgressive = ({
	allLeaders,
	playoffs,
	stat,
	stats,
	statType,
}: View<"leadersProgressive">) => {
	useTitleBar({
		title: "Progressive Leaders",
		dropdownView: "leaders_progressive",
		dropdownFields: {
			stats: stat,
			statTypesStrict: statType,
			playoffsCombined: playoffs,
		},
		dropdownCustomOptions: {
			stats: formatStatsDropdown(stats),
		},
	});

	const cols = getCols(
		[
			"Season",
			"Name",
			`stat:${stat}`,
			"",
			"Name",
			`stat:${stat}`,
			"",
			"Name",
			`stat:${stat}`,
			"",
			"Name",
			`stat:${stat}`,
		],
		{
			"": {
				sortSequence: [],
			},
		},
	);
	cols[1]!.title = "Year-by-Year";
	cols[4]!.title = "Active";
	cols[7]!.title = "Career";
	cols[10]!.title = "Single Season";

	const totals = statType === "totals";

	const leaderTypes = [
		"yearByYear",
		"active",
		"career",
		"singleSeason",
	] as const;

	const spacer = <div style={{ width: 20 }} />;

	const rows: DataTableRow[] = allLeaders.map(({ season, ...row }) => {
		return {
			key: season,
			metadata: row.yearByYear
				? {
						type: "player",
						pid: row.yearByYear.pid,
						season,
						playoffs,
					}
				: undefined,
			data: [
				row.linkSeason ? (
					<a href={helpers.leagueUrl(["history", season])}>{season}</a>
				) : (
					season
				),
				...leaderTypes.flatMap((type, i) => {
					const p = row[type];

					let tableRow: any[];
					if (!p) {
						tableRow = [undefined, undefined];
					} else {
						tableRow = [
							{
								...wrappedPlayerNameLabels({
									pid: p.pid,
									season,
									watch: p.watch,
									skills: p.skills,
									jerseyNumber: p.jerseyNumber,
									firstName: p.firstName,
									firstNameShort: p.firstNameShort,
									lastName: p.lastName,
									count: type === "yearByYear" ? row[type]?.count : undefined,
								}),
								classNames: {
									"table-danger": p.hof,
									"table-info": p.userTeam,
								},
							},
							{
								value: helpers.roundStat(p.stat, stat, totals),
								sortValue: p.stat,
								classNames: {
									"table-danger": p.hof,
									"table-info": p.userTeam,
								},
							},
						];
					}

					if (i !== 0) {
						tableRow.unshift(spacer);
					}

					return tableRow;
				}),
			],
		};
	});

	return (
		<>
			<MoreLinks
				type="leaders"
				page="leaders_progressive"
				playoffs={playoffs}
				season="all"
				statType={statType}
			/>
			<LeadersTopText includeHighlight noHighlightActive />

			{rows.length === 0 ? (
				<p>No data yet.</p>
			) : (
				<DataTable
					cols={cols}
					defaultSort={[0, "asc"]}
					defaultStickyCols={1}
					name="LeadersProgressive"
					nonfluid
					pagination={rows.length > 100}
					rows={rows}
				/>
			)}
		</>
	);
};

export default LeadersProgressive;
