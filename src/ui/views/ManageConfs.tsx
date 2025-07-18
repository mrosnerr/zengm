import {
	useState,
	type ChangeEvent,
	type FormEvent,
	type MouseEvent,
} from "react";
import useTitleBar from "../hooks/useTitleBar.tsx";
import { helpers, logEvent, toWorker } from "../util/index.ts";
import type { View } from "../../common/types.ts";
import { PHASE } from "../../common/index.ts";

const nextSeasonWarning =
	"Because the regular season is already over, changes will not be fully applied until next season.";

const ManageConfs = ({
	actualPhase,
	autoRelocate,
	confs,
	divs,
}: View<"manageConfs">) => {
	const [liveConfs, setLiveConfs] = useState(confs);
	const [liveDivs, setLiveDivs] = useState(divs);
	const [saving, setSaving] = useState(false);

	useTitleBar({ title: "Manage Conferences" });

	const updateConfName =
		(cid: number) => (event: ChangeEvent<HTMLInputElement>) => {
			const newConfs = [...liveConfs];
			const conf = newConfs.find((c) => c.cid === cid);
			if (conf) {
				conf.name = event.target.value;
				setLiveConfs(newConfs);
			}
		};

	const updateDivName =
		(did: number) => (event: ChangeEvent<HTMLInputElement>) => {
			const newDivs = [...liveDivs];
			const div = newDivs.find((d) => d.did === did);
			if (div) {
				div.name = event.target.value;
				setLiveDivs(newDivs);
			}
		};

	const deleteConf = (cid: number) => () => {
		setLiveConfs(liveConfs.filter((conf) => conf.cid !== cid));
		setLiveDivs(liveDivs.filter((div) => div.cid !== cid));
	};

	const deleteDiv = (did: number) => () => {
		setLiveDivs(liveDivs.filter((div) => div.did !== did));
	};

	const addConf = (event: MouseEvent) => {
		event.preventDefault();

		let newCid = 0;
		for (const conf of liveConfs) {
			if (conf.cid >= newCid) {
				newCid = conf.cid + 1;
			}
		}

		setLiveConfs([
			...liveConfs,
			{
				cid: newCid,
				name: "New Conference",
			},
		]);
	};

	const addDiv = (cid: number) => (event: MouseEvent) => {
		event.preventDefault();

		let newDid = 0;
		for (const div of liveDivs) {
			if (div.did >= newDid) {
				newDid = div.did + 1;
			}
		}

		setLiveDivs([
			...liveDivs,
			{
				cid,
				did: newDid,
				name: "New Division",
			},
		]);
	};

	const handleSubmit = async (event: FormEvent) => {
		event.preventDefault();
		setSaving(true);

		await toWorker("main", "updateConfsDivs", {
			confs: liveConfs,
			divs: liveDivs,
		});

		let text = "Saved conferences and divisions.";

		if (actualPhase >= PHASE.PLAYOFFS) {
			text += `<br /><br />${nextSeasonWarning}`;
		}

		logEvent({
			type: "success",
			text,
			saveToDb: false,
		});

		setSaving(false);
	};

	if (autoRelocate) {
		return (
			<p>
				You cannot edit conferences/divisions while a{" "}
				<a href={helpers.leagueUrl(["auto_relocate"])}>team relocation vote</a>{" "}
				is pending.
			</p>
		);
	}

	return (
		<>
			<p>
				If you delete a conference, all divisions in that conference will be
				deleted too.
			</p>
			<p>
				If you delete a division, all teams belonging to that division will be
				assigned to some other division. You can reassign them on the{" "}
				<a href={helpers.leagueUrl(["manage_teams"])}>manage teams page</a>.
			</p>

			{actualPhase >= PHASE.PLAYOFFS ? (
				<p className="alert alert-warning d-inline-block">
					{nextSeasonWarning}
				</p>
			) : null}

			<form onSubmit={handleSubmit}>
				<div className="row">
					{liveConfs.map((conf) => {
						return (
							<div key={conf.cid} className="col-xl-3 col-lg-4 col-md-6 mb-3">
								<div className="card">
									<div className="card-body">
										<div className="d-flex align-items-end mb-3">
											<div className="flex-grow-1">
												<label
													className="form-label"
													htmlFor={`conf-name-${conf.cid}`}
												>
													Conference Name
												</label>
												<input
													className="form-control"
													id={`conf-name-${conf.cid}`}
													value={conf.name}
													onChange={updateConfName(conf.cid)}
												/>
											</div>
											<button
												className="btn btn-danger ms-3"
												onClick={deleteConf(conf.cid)}
												type="button"
											>
												Delete
											</button>
										</div>
										{liveDivs
											.filter((div) => div.cid === conf.cid)
											.map((div) => (
												<div
													key={div.did}
													className="d-flex align-items-end mb-3 ms-4"
												>
													<div className="flex-grow-1">
														<label
															className="form-label"
															htmlFor={`div-name-${div.did}`}
														>
															Division Name
														</label>
														<input
															className="form-control"
															id={`div-name-${div.did}`}
															value={div.name}
															onChange={updateDivName(div.did)}
														/>
													</div>
													<button
														className="btn btn-danger ms-3"
														onClick={deleteDiv(div.did)}
														type="button"
													>
														Delete
													</button>
												</div>
											))}
										<button
											className="btn btn-secondary ms-4"
											onClick={addDiv(conf.cid)}
											type="button"
										>
											Add Division
										</button>
									</div>
								</div>
							</div>
						);
					})}
					<div className="col-xl-3 col-lg-4 col-md-6 mb-3">
						<div className="card">
							<div className="card-body">
								<button
									className="btn btn-secondary"
									onClick={addConf}
									type="button"
								>
									Add Conference
								</button>
							</div>
						</div>
					</div>
				</div>
				<div className="text-center">
					<button
						type="submit"
						className="btn btn-primary"
						disabled={saving || liveConfs.length === 0 || liveDivs.length === 0}
					>
						Save Conferences and Divisions
					</button>
				</div>
			</form>
		</>
	);
};

export default ManageConfs;
