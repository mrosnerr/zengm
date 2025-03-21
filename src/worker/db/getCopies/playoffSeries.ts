import { idb } from "..";
import { mergeByPk } from "./helpers";
import type { GetCopyType, PlayoffSeries } from "../../../common/types";

const getCopies = async (
	options: any = {},
	type?: GetCopyType,
): Promise<PlayoffSeries[]> => {
	return mergeByPk(
		await idb.league.getAll("playoffSeries"),
		await idb.cache.playoffSeries.getAll(),
		"playoffSeries",
		type,
	);
};

export default getCopies;
