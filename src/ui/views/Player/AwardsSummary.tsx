import type { Player } from "../../../common/types.ts";
import { groupAwards } from "../../util/index.ts";

const style = {
	fontSize: "120%",
	maxWidth: 520,
};

const AwardsSummary = ({ awards }: { awards: Player["awards"] }) => {
	if (awards.length === 0) {
		return null;
	}

	const awardsGrouped = groupAwards(awards, true);

	return (
		<div style={style}>
			{awardsGrouped.map((a, i) => {
				let title = a.seasons.join(", ");
				if (a.long !== a.type) {
					title += ` - ${a.long}`;
				}

				return (
					<span
						key={i}
						className={`badge rounded-pill px-2 me-1 mt-2 ${
							a.type === "Hall of Fame" ? "bg-warning" : "bg-secondary"
						}`}
						title={title}
					>
						{a.count > 1 ? `${a.count}x ` : null}
						{a.type}
					</span>
				);
			})}
		</div>
	);
};

export default AwardsSummary;
