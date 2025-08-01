import { useCallback, useState } from "react";
import { arrayMove } from "@dnd-kit/sortable";
import { PHASE } from "../../common/index.ts";
import { DataTable } from "../components/index.tsx";
import useTitleBar from "../hooks/useTitleBar.tsx";
import { getCols, helpers, toWorker } from "../util/index.ts";
import type { View } from "../../common/types.ts";
import { shuffle } from "../../common/random.ts";
import type { DataTableRow } from "../components/DataTable/index.tsx";

const FantasyDraft = ({ phase, teams, userTids }: View<"fantasyDraft">) => {
	const [sortedTids, setSortedTids] = useState(teams.map((t) => t.tid));
	const [starting, setStarting] = useState(false);
	const randomize = useCallback(() => {
		const newSortedTids = [...sortedTids];
		shuffle(newSortedTids);
		setSortedTids(newSortedTids);
	}, [sortedTids]);
	const startDraft = useCallback(() => {
		setStarting(true);
		toWorker("main", "startFantasyDraft", sortedTids);
	}, [sortedTids]);
	useTitleBar({
		title: "Fantasy Draft",
	});

	if (phase === PHASE.DRAFT) {
		return (
			<>
				<h2>Error</h2>
				<p>
					You can't start a fantasy draft while a regular draft is already in
					progress.
				</p>
			</>
		);
	}

	// Use the result of drag and drop to sort players, before the "official" order comes back as props
	const teamsSorted = sortedTids.map((tid) => {
		const found = teams.find((t) => t.tid === tid);
		if (!found) {
			throw new Error("Should never happen");
		}
		return found;
	});

	const cols = getCols(["#", "Team"]);

	const rows: DataTableRow[] = teamsSorted.map((t, i) => {
		return {
			key: t.tid,
			data: [
				i + 1,
				<a href={helpers.leagueUrl(["roster", `${t.abbrev}_${t.tid}`])}>
					{t.region} {t.name}
				</a>,
			],
		};
	});

	return (
		<>
			<p>
				In a "fantasy draft", all non-retired players are put into one big pool
				and teams take turns drafting players, similar to a fantasy{" "}
				{process.env.SPORT} draft. At the beginning of the draft, the order of
				picks is randomized. During the draft, the order of picks snakes
				(reverses every other round). For example, the team that picks first in
				the first round picks last in the second round.
			</p>

			<p>
				To make things as fair as possible, all traded draft picks will be
				returned to their original owners after the fantasy draft.
			</p>

			<button
				className="btn btn-light-bordered mb-3"
				disabled={starting}
				onClick={randomize}
			>
				Randomize order
			</button>

			<DataTable
				cols={cols}
				defaultSort={"disableSort"}
				name="FantasyDraft"
				rows={rows}
				hideAllControls
				hideMenuToo
				nonfluid
				sortableRows={{
					highlightHandle: ({ row }) => userTids.includes(row.key as number),
					onChange: async ({ oldIndex, newIndex }) => {
						const newSortedTids = arrayMove(sortedTids, oldIndex, newIndex);
						setSortedTids(newSortedTids);
					},
					onSwap: async (index1, index2) => {
						const newSortedTids = [...sortedTids];
						newSortedTids[index1] = sortedTids[index2]!;
						newSortedTids[index2] = sortedTids[index1]!;
						setSortedTids(newSortedTids);
					},
				}}
			/>

			<div className="mb-3">
				<button
					className="btn btn-large btn-success"
					disabled={starting}
					onClick={startDraft}
				>
					Start fantasy draft
				</button>
			</div>

			<span className="text-danger">
				<b>Warning:</b> Once you start a fantasy draft, there is no going back!
			</span>
		</>
	);
};

export default FantasyDraft;
