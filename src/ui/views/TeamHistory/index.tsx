import useTitleBar from "../../hooks/useTitleBar.tsx";
import type { View } from "../../../common/types.ts";
import Overall from "./Overall.tsx";
import Players from "./Players.tsx";
import RetiredJerseyNumbers from "./RetiredJerseyNumbers.tsx";
import Seasons from "./Seasons.tsx";
import { MoreLinks } from "../../components/index.tsx";
import HideableSection from "../../components/HideableSection.tsx";

const TeamHistory = ({
	abbrev,
	bestRecord,
	championships,
	finalsAppearances,
	godMode,
	history,
	players,
	playoffAppearances,
	retiredJerseyNumbers,
	season,
	stats,
	tid,
	totalLost,
	totalOtl,
	totalTied,
	totalWinp,
	totalWon,
	userTid,
	worstRecord,
}: View<"teamHistory">) => {
	useTitleBar({
		title: "Team History",
		dropdownView: "team_history",
		dropdownFields: { teams: abbrev },
	});

	return (
		<>
			<MoreLinks type="team" page="team_history" abbrev={abbrev} tid={tid} />

			<div className="row">
				<div className="col-sm-5 col-md-3">
					<HideableSection pageName="TeamHistory" title="Overall">
						<Overall
							bestRecord={bestRecord}
							championships={championships}
							finalsAppearances={finalsAppearances}
							playoffAppearances={playoffAppearances}
							totalLost={totalLost}
							totalOtl={totalOtl}
							totalTied={totalTied}
							totalWinp={totalWinp}
							totalWon={totalWon}
							worstRecord={worstRecord}
						/>
					</HideableSection>

					<HideableSection title="Seasons" className="mt-3">
						<Seasons history={history} />
					</HideableSection>
				</div>
				<div className="col-sm-7 col-md-9 mt-3 mt-sm-0">
					<RetiredJerseyNumbers
						godMode={godMode}
						players={players}
						retiredJerseyNumbers={retiredJerseyNumbers}
						season={season}
						tid={tid}
						userTid={userTid}
					/>
					<HideableSection title="Players">
						<Players
							godMode={godMode}
							season={season}
							players={players}
							stats={stats}
							tid={tid}
							userTid={userTid}
						/>
					</HideableSection>
				</div>
			</div>
		</>
	);
};

export default TeamHistory;
