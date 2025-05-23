import { PHASE } from "../../../common/index.ts";
import { g, logEvent } from "../../util/index.ts";
import type { Conditions } from "../../../common/types.ts";

const logAction = (
	tid: number,
	text: string,
	score: number,
	conditions?: Conditions,
) => {
	// Don't show notification during lottery UI, it will spoil it!
	const showNotification =
		tid === g.get("userTid") && g.get("phase") !== PHASE.DRAFT_LOTTERY;
	logEvent(
		{
			type: "draftLottery",
			text,
			showNotification,
			pids: [],
			tids: [tid],
			score,
		},
		conditions,
	);
};

export default logAction;
