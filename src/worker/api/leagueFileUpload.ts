import type { ValidateFunction } from "ajv";
import Ajv from "ajv";
import JSONParserText from "./JSONParserText.ts";
import schema from "../../../build/files/league-schema.json";
import { helpers, toUI } from "../util/index.ts";
import { highWaterMark } from "../core/league/createStream.ts";
import type { Conditions } from "../../common/types.ts";
import {
	DEFAULT_TEAM_COLORS,
	LEAGUE_DATABASE_VERSION,
} from "../../common/index.ts";

// These objects (at the root of a league file) should be emitted as a complete object, rather than individual rows from an array
export const CUMULATIVE_OBJECTS = new Set([
	"gameAttributes",
	"meta",
	"startingSeason",
	"version",
]);

export const parseJSON = () => {
	let parser: any;

	const transformStream = new TransformStream(
		{
			start(controller) {
				parser = new JSONParserText((value) => {
					// This function was adapted from JSONStream, particularly the part where row.value is set to undefind at the bottom, that is important!

					// The key on the root of the object is in the stack if we're nested, or is just parser.key if we're not
					let objectType;
					if (parser.stack.length > 1) {
						objectType = parser.stack[1].key;
					} else {
						objectType = parser.key;
					}

					const emitAtStackLength = CUMULATIVE_OBJECTS.has(objectType) ? 1 : 2;

					if (parser.stack.length !== emitAtStackLength) {
						// We must be deeper in the tree, still building an object to emit
						return;
					}

					controller.enqueue({
						key: objectType,
						value,
					});

					// Now that we have emitted the object we want, we no longer need to keep track of all the values on the stack. This avoids keeping the whole JSON object in memory.
					for (const row of parser.stack) {
						row.value = undefined;
					}

					// Also, when processing an array/object, this.value will contain the current state of the array/object. So we should delete the value there too, but leave the array/object so it can still be used by the parser
					if (typeof parser.value === "object" && parser.value !== null) {
						delete parser.value[parser.key];
					}
				});
			},

			transform(chunk) {
				parser.write(chunk);
			},

			flush(controller) {
				controller.terminate();
			},
		},
		new CountQueuingStrategy({
			highWaterMark,
		}),
		new CountQueuingStrategy({
			highWaterMark,
		}),
	);

	return transformStream;
};

// We have one big JSON Schema file for everything, but we need to run it on individual objects as they stream though. So break it up into parts.
const makeValidators = () => {
	const ajv = new Ajv({
		allErrors: true,
		verbose: true,
	});

	const validators: Record<
		string,
		{
			required: boolean;
			validate: ValidateFunction;
		}
	> = {};

	const baseSchema = {
		$schema: schema.$schema,
		$id: schema.$id,

		// Used in some parts
		definitions: schema.definitions,

		// These don't matter
		title: "",
		description: "",
	};

	const parts = helpers.keys(schema.properties);

	for (const part of parts) {
		const cumulative = CUMULATIVE_OBJECTS.has(part);

		const subset = cumulative
			? schema.properties[part]
			: (schema.properties[part] as any).items;

		const partSchema = {
			...baseSchema,
			$id: `${baseSchema.$id}#${part}`,
			...subset,
		};
		validators[part] = {
			required: schema.required.includes(part),
			validate: ajv.compile(partSchema),
		};
	}

	return validators;
};

let validators: ReturnType<typeof makeValidators> | undefined;

export type BasicInfo = {
	gameAttributes?: any;
	meta?: any;
	startingSeason?: number;
	version?: number;
	teams?: any[];
	players?: any[]; // Only with includePlayersInBasicInfo
	keys: Set<string>;
	maxGid: number;
	hasRookieContracts: boolean;
	name?: string;
};

const getBasicInfo = async ({
	stream,
	includePlayersInBasicInfo,
	leagueCreationID,
	conditions,
}: {
	stream: ReadableStream;
	includePlayersInBasicInfo: boolean | undefined;
	leagueCreationID: number | undefined;
	conditions: Conditions;
}) => {
	// This is stuff needed for either the league creation screen, or is needed before actually loading the file to the database in createStream
	const basicInfo: BasicInfo = {
		keys: new Set(),
		maxGid: -1,
		hasRookieContracts: false,
	};

	if (includePlayersInBasicInfo) {
		basicInfo.players = [];
	}

	if (!validators) {
		validators = makeValidators();
	}

	const schemaErrors = [];

	const reader = await stream.pipeThrough(parseJSON()).getReader();

	const requiredPartsNotYetSeen = new Set();
	for (const [key, { required }] of Object.entries(validators)) {
		if (required) {
			requiredPartsNotYetSeen.add(key);
		}
	}

	while (true) {
		const { value, done } = (await reader.read()) as any;
		if (done) {
			break;
		}

		const cumulative = CUMULATIVE_OBJECTS.has(value.key);

		if (leagueCreationID !== undefined && !basicInfo.keys.has(value.key)) {
			basicInfo.keys.add(value.key);
			toUI(
				"updateLocal",
				[
					{
						leagueCreation: {
							id: leagueCreationID,
							status: value.key,
						},
					},
				],
				conditions,
			);
		}

		const currentValidator = validators[value.key];
		if (currentValidator) {
			const { validate, required } = currentValidator;
			validate(value.value);
			if (validate.errors) {
				schemaErrors.push(...validate.errors);
			}

			if (required) {
				requiredPartsNotYetSeen.delete(value.key);
			}
		}

		if (value.key === "meta" && value.value.name) {
			basicInfo.name = value.value.name;
		}

		// Need to store max gid from games, so generated schedule does not overwrite it
		if (value.key === "games" && value.value.gid > basicInfo.maxGid) {
			basicInfo.maxGid = value.value.gid;
		}

		if (value.key === "players" && value.value.contract?.rookie) {
			basicInfo.hasRookieContracts = true;
		}

		if (cumulative) {
			(basicInfo as any)[value.key] = value.value;
		} else if (value.key === "teams") {
			if (!basicInfo.teams) {
				basicInfo.teams = [];
			}

			const t = {
				...value.value,
			};

			if (!t.colors) {
				t.colors = DEFAULT_TEAM_COLORS;
			}

			if (t.seasons?.length > 0) {
				// If specified on season, copy to root
				const maybeOnSeason = ["pop", "stadiumCapacity"] as const;
				const ts = t.seasons.at(-1);
				for (const prop of maybeOnSeason) {
					if (ts[prop] !== undefined) {
						t[prop] = ts[prop];
					}
				}
			}

			// stats and seasons take up a lot of space, so we don't need to keep them. But... heck, why not.

			basicInfo.teams.push(value.value);
		} else if (includePlayersInBasicInfo && value.key === "players") {
			basicInfo.players!.push(value.value);
		}
	}

	for (const key of requiredPartsNotYetSeen) {
		let message = `"${key}" is required in the root of a JSON file, but is missing.`;
		if (key === "version") {
			message += ` The latest version is ${LEAGUE_DATABASE_VERSION}, that's probably what you want if this is a new file you're making.`;
		}
		schemaErrors.push(message);
	}

	toUI(
		"updateLocal",
		[
			{
				leagueCreation: undefined,
			},
		],
		conditions,
	);

	return { basicInfo, schemaErrors };
};

export const emitProgressStream = (
	leagueCreationID: number | undefined,
	sizeInBytes: number | undefined,
	conditions: Conditions,
) => {
	const doIt =
		leagueCreationID !== undefined &&
		sizeInBytes !== undefined &&
		!Number.isNaN(sizeInBytes);

	let lastPercentEmitted = 0;
	let sizeSoFar = 0;
	return new TransformStream({
		start() {
			toUI(
				"updateLocal",
				[
					{
						leagueCreationPercent: doIt
							? {
									id: leagueCreationID,
									percent: 0,
								}
							: undefined,
					},
				],
				conditions,
			);
		},
		transform(chunk, controller) {
			controller.enqueue(chunk);
			if (doIt) {
				sizeSoFar += chunk.length;
				const percent = Math.round((sizeSoFar / sizeInBytes) * 100);

				if (percent > lastPercentEmitted) {
					toUI(
						"updateLocal",
						[
							{
								leagueCreationPercent: {
									id: leagueCreationID,
									percent,
								},
							},
						],
						conditions,
					);
					lastPercentEmitted = percent;
				}
			}
		},
	});
};

// Check first 3 bytes of stream for gzip header
const isStreamGzipped = async (stream: ReadableStream) => {
	const reader = stream.getReader();
	const { value } = await reader.read();
	reader.cancel();

	return (
		value !== undefined &&
		value.length >= 3 &&
		value[0] === 0x1f &&
		value[1] === 0x8b &&
		value[2] === 0x08
	);
};

// Stream could either be text, or gzipped text. This will unzip only if necessary, otherwise it just passes the stream through.
// Would be nice if this was just a normal TransformStream rather than an async wrapper function, but I'm not sure how to do that!
export const decompressStreamIfNecessary = async (
	inputStream: ReadableStream<unknown>,
): Promise<ReadableStream<unknown>> => {
	const [checkGzipStream, outputStream] = inputStream.tee();

	if (await isStreamGzipped(checkGzipStream)) {
		if (typeof DecompressionStream === "undefined") {
			throw new Error(
				"Your browser does not support .gz league files. Either upgrade your browser or manually decompress the file to a plain .json file before importing.",
			);
		}

		return outputStream.pipeThrough(new DecompressionStream("gzip"));
	}

	return outputStream;
};

const initialCheck = async (
	{
		file,
		includePlayersInBasicInfo,
		leagueCreationID,
	}: {
		file: File | string;
		includePlayersInBasicInfo?: boolean;
		leagueCreationID?: number;
	},
	conditions: Conditions,
) => {
	let stream: ReadableStream;
	let sizeInBytes: number | undefined;
	if (typeof file === "string") {
		let response;
		try {
			response = await fetch(file);
		} catch {
			throw new Error(
				"Could be a network error, an invalid URL, or an invalid Access-Control-Allow-Origin header",
			);
		}

		if (!response.ok) {
			let description;
			switch (response.status) {
				case 400:
					description = "bad request";
					break;
				case 401:
					description = "unauthorized";
					break;
				case 403:
					description = "forbidden";
					break;
				case 404:
					description = "file not found";
					break;
				case 500:
					description = "internal server error";
					break;
				case 502:
					description = "bad gateway";
					break;
				case 503:
					description = "service unavailable";
					break;
			}

			throw new Error(
				`server responded with HTTP error code ${response.status}${
					description ? ` (${description})` : ""
				}`,
			);
		}

		stream = response.body as unknown as ReadableStream;
		const size = response.headers.get("content-length");
		if (size) {
			sizeInBytes = Number(size);
		}
	} else {
		stream = file.stream();
		sizeInBytes = file.size;
	}

	const stream0 = stream;

	// I HAVE NO IDEA WHY THIS LINE IS NEEDED, but without this, Firefox seems to cut the stream off early
	(self as any).stream0 = stream0;

	const stream2 = (
		await decompressStreamIfNecessary(
			stream0.pipeThrough(
				emitProgressStream(leagueCreationID, sizeInBytes, conditions),
			),
		)
	).pipeThrough(new TextDecoderStream());
	const { basicInfo, schemaErrors } = await getBasicInfo({
		stream: stream2,
		includePlayersInBasicInfo,
		leagueCreationID,
		conditions,
	});

	delete (self as any).stream0;

	return {
		basicInfo,
		schemaErrors,
	};
};

export default {
	initialCheck,
};
