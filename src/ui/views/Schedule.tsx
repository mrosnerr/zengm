import { Fragment, useState } from "react";
import { ForceWin, MoreLinks, ScoreBox } from "../components/index.tsx";
import useTitleBar from "../hooks/useTitleBar.tsx";
import type { View } from "../../common/types.ts";
import { toWorker, useLocalPartial } from "../util/index.ts";
import allowForceTie from "../../common/allowForceTie.ts";
import { Dropdown } from "react-bootstrap";

const Schedule = ({
	abbrev,
	canLiveSimFirstGame,
	completed,
	elam,
	elamASG,
	phase,
	tid,
	ties,
	topPlayers,
	upcoming,
}: View<"schedule">) => {
	useTitleBar({
		title: "Schedule",
		dropdownView: "schedule",
		dropdownFields: { teams: abbrev },
	});

	const { gameSimInProgress, godMode } = useLocalPartial([
		"gameSimInProgress",
		"godMode",
	]);

	const [forcingAll, setForcingAll] = useState(false);
	const [forceWinKey, setForceWinKey] = useState(0);

	const handleForceAll =
		(type: "win" | "lose" | "tie" | "none") => async () => {
			setForcingAll(true);
			await toWorker("main", "setForceWinAll", { tid, type });
			setForceWinKey((key) => key + 1);
			setForcingAll(false);
		};

	return (
		<>
			<MoreLinks type="team" page="schedule" abbrev={abbrev} tid={tid} />
			{godMode ? (
				<Dropdown className="mb-3">
					<Dropdown.Toggle
						variant="god-mode"
						id="dropdown-basic"
						disabled={forcingAll}
					>
						Force all
					</Dropdown.Toggle>

					<Dropdown.Menu>
						<Dropdown.Item onClick={handleForceAll("win")}>Win</Dropdown.Item>
						<Dropdown.Item onClick={handleForceAll("lose")}>Lose</Dropdown.Item>
						{allowForceTie({
							// Doesn't matter what team, we're just checking in general
							homeTid: 0,
							awayTid: 0,
							elam,
							elamASG,
							phase,
							ties,
						}) ? (
							<Dropdown.Item onClick={handleForceAll("tie")}>Tie</Dropdown.Item>
						) : null}
						<Dropdown.Item onClick={handleForceAll("none")}>
							Reset
						</Dropdown.Item>
					</Dropdown.Menu>
				</Dropdown>
			) : null}
			<div className="d-flex flex-wrap" style={{ gap: "2rem" }}>
				<div style={{ maxWidth: 510 }} className="flex-grow-1">
					<h2>Upcoming Games</h2>
					<ul className="list-group">
						{upcoming.map((game, i) => {
							const tradeDeadline =
								game.teams[0].tid === -3 && game.teams[1].tid === -3;
							const canWatch =
								game.teams[0].playoffs || (canLiveSimFirstGame && i === 0);

							const actions =
								canWatch && tradeDeadline
									? undefined
									: [
											canWatch
												? {
														disabled: gameSimInProgress,
														text: (
															<>
																Watch
																<br />
																game
															</>
														),
														onClick: () =>
															toWorker("actions", "liveGame", game.gid),
													}
												: {
														disabled: gameSimInProgress,
														text: (
															<>
																Sim
																<br />
																to
																<br />
																game
															</>
														),
														onClick: () => {
															toWorker("actions", "simToGame", game.gid);
														},
													},
										];

							const allowTie = allowForceTie({
								homeTid: game.teams[0].tid,
								awayTid: game.teams[1].tid,
								elam,
								elamASG,
								phase,
								ties,
							});

							const otherTid =
								game.teams[0].tid === tid
									? game.teams[1].tid
									: game.teams[0].tid;

							return (
								<Fragment key={game.gid}>
									<ScoreBox
										game={{
											// Leave out forceTie, since ScoreBox wants the value for finished games
											finals: game.finals,
											gid: game.gid,
											season: game.season,
											teams: game.teams,
										}}
										playersUpcoming={topPlayers[otherTid]}
										playersUpcomingAbbrev
										actions={actions}
									/>
									<ForceWin
										key={forceWinKey}
										allowTie={allowTie}
										className="mb-3"
										game={game}
									/>
								</Fragment>
							);
						})}
					</ul>
				</div>
				<div style={{ maxWidth: 510 }} className="flex-grow-1">
					<h2>Completed Games</h2>
					{completed.map((game) => (
						<ScoreBox
							boxScoreTeamOverride={`${abbrev}_${tid}`}
							className="mb-3"
							key={game.gid}
							game={game}
						/>
					))}
				</div>
			</div>
		</>
	);
};

export default Schedule;
