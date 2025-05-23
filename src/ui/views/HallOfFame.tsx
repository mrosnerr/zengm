import useTitleBar from "../hooks/useTitleBar.tsx";
import { getCols, helpers } from "../util/index.ts";
import { DataTable } from "../components/index.tsx";
import type { View } from "../../common/types.ts";
import { wrappedPlayerNameLabels } from "../components/PlayerNameLabels.tsx";
import type { DataTableRow } from "../components/DataTable/index.tsx";

const HallOfFame = ({ players, stats, userTid }: View<"hallOfFame">) => {
	useTitleBar({ title: "Hall of Fame" });

	const superCols = [
		{
			title: "",
			colspan: 6,
		},
		{
			title: "Best Season",
			colspan: 2 + stats.length,
		},
		{
			title: "Career Stats",
			colspan: stats.length,
		},
	];

	const cols = getCols([
		"Name",
		"Pos",
		"Drafted",
		"Retired",
		"Pick",
		"Peak Ovr",
		"Year",
		"Team",
		...stats.map((stat) => `stat:${stat}`),
		...stats.map((stat) => `stat:${stat}`),
	]);

	const rows: DataTableRow[] = players.map((p) => {
		return {
			key: p.pid,
			metadata: {
				type: "player",
				pid: p.pid,
				season: "career",
				playoffs: "regularSeason",
			},
			data: [
				wrappedPlayerNameLabels({
					pid: p.pid,
					firstName: p.firstName,
					firstNameShort: p.firstNameShort,
					lastName: p.lastName,
				}),
				p.bestPos,
				p.draft.year,
				p.retiredYear,
				p.draft.round > 0 ? `${p.draft.round}-${p.draft.pick}` : "",
				p.peakOvr,
				p.bestStats.season,
				<a
					href={helpers.leagueUrl([
						"roster",
						`${p.bestStats.abbrev}_${p.bestStats.tid}`,
						p.bestStats.season,
					])}
				>
					{p.bestStats.abbrev}
				</a>,
				...stats.map((stat) => helpers.roundStat(p.bestStats[stat], stat)),
				...stats.map((stat) => helpers.roundStat(p.careerStats[stat], stat)),
			],
			classNames: {
				"table-danger": p.legacyTid === userTid,
				"table-info":
					p.statsTids.slice(0, p.statsTids.length - 1).includes(userTid) &&
					p.legacyTid !== userTid,
				"table-success":
					p.statsTids.at(-1) === userTid && p.legacyTid !== userTid,
			},
		};
	});

	return (
		<>
			<p>
				Players are eligible to be inducted into the Hall of Fame after they
				retire. The formula for inclusion is very similar to{" "}
				<a href="http://espn.go.com/nba/story/_/id/8736873/nba-experts-rebuild-springfield-hall-fame-espn-magazine">
					the method described in this article
				</a>
				. Hall of Famers who played for your team are{" "}
				<span className="text-info">highlighted in blue</span>. Hall of Famers
				who retired with your team are{" "}
				<span className="text-success">highlighted in green</span>. Hall of
				Famers who played most of their career with your team are{" "}
				<span className="text-danger">highlighted in red</span>.
			</p>

			<DataTable
				cols={cols}
				defaultSort={[cols.length - 2, "desc"]}
				defaultStickyCols={window.mobile ? 0 : 1}
				name="HallOfFame"
				pagination
				rows={rows}
				superCols={superCols}
			/>
		</>
	);
};

export default HallOfFame;
