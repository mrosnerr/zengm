/* eslint-disable jsx-a11y/no-noninteractive-element-interactions */
import clsx from "clsx";
import { AnimatePresence, m } from "framer-motion";
import { type ChangeEvent, Fragment, type ReactNode, useState } from "react";
import { isSport } from "../../../common/index.ts";
import { HelpPopover } from "../../components/index.tsx";
import gameSimPresets from "./gameSimPresets.ts";
import {
	getVisibleCategories,
	settingIsEnabled,
	settingNeedsGodMode,
	type State,
} from "./SettingsForm.tsx";
import type { Decoration, FieldType, Key, Values } from "./types.ts";
import { helpers } from "../../util/index.ts";
import { CurrencyInputGroup } from "../../components/CurrencyInputGroup.tsx";

export const godModeRequiredMessage = (
	godModeRequired?: "always" | "existingLeagueOnly",
) => {
	if (godModeRequired === "existingLeagueOnly") {
		return "This setting can only be changed in God Mode or when creating a new league.";
	}
	return "This setting can only be changed in God Mode.";
};

const inputStyle = {
	maxWidth: 150,
};

const Input = ({
	decoration,
	disabled,
	godModeRequired,
	id,
	maxWidth,
	onChange,
	type,
	value,
	values,
}: {
	decoration?: Decoration;
	disabled?: boolean;
	godModeRequired?: "always" | "existingLeagueOnly";
	id: string;
	maxWidth?: true;
	name: string;
	onChange: (event: ChangeEvent<HTMLInputElement | HTMLSelectElement>) => void;
	type: FieldType;
	value: string;
	values?: Values;
}) => {
	const title = disabled ? godModeRequiredMessage(godModeRequired) : undefined;
	const commonProps = {
		className: "form-control",
		disabled,
		title,
		id,
		onChange,
		style:
			!decoration &&
			type !== "rangePercent" &&
			type !== "floatValuesOrCustom" &&
			!maxWidth
				? inputStyle
				: undefined,
		value,
	};

	let inputElement;
	if (type === "bool") {
		const checked = value === "true";
		const switchTitle = title ?? (checked ? "Enabled" : "Disabled");
		inputElement = (
			<div className="form-check form-switch" title={switchTitle}>
				<input
					className="form-check-input"
					type="checkbox"
					id={id}
					disabled={disabled}
					checked={checked}
					onChange={onChange}
				/>
				<label className="form-check-label" htmlFor={id} />
			</div>
		);
	} else if (type === "rangePercent") {
		inputElement = (
			<div className="d-flex" style={inputStyle}>
				<div className="text-end me-1" style={{ minWidth: 38 }}>
					{Math.round(helpers.localeParseFloat(value) * 100)}%
				</div>
				<div>
					<input
						type="range"
						{...commonProps}
						className="form-range"
						min="0"
						max="1"
						step="0.05"
					/>
				</div>
			</div>
		);
	} else if (values) {
		if (type === "floatValuesOrCustom") {
			const parsed = JSON.parse(value);
			const selectValue =
				parsed[0] || values.every(({ key }) => key !== parsed[1])
					? "custom"
					: parsed[1];
			inputElement = (
				<div className="input-group" style={inputStyle}>
					<select
						{...commonProps}
						className="form-select"
						value={selectValue}
						style={{ width: 60 }}
					>
						{values.map(({ key, value }) => (
							<option key={key} value={key}>
								{value}
							</option>
						))}
						<option value="custom">Custom</option>
					</select>
					<input
						type="text"
						className="form-control"
						disabled={selectValue !== "custom"}
						onChange={onChange}
						value={parsed[1]}
						inputMode="decimal"
					/>
				</div>
			);
		} else {
			inputElement = (
				<select {...commonProps} className="form-select">
					{values.map(({ key, value }) => (
						<option key={key} value={key}>
							{value}
						</option>
					))}
				</select>
			);
		}
	} else {
		const inputModes: Partial<Record<typeof type, "decimal" | "numeric">> = {
			float: "decimal",
			float1000: "decimal",
			floatOrNull: "decimal",
			int: "numeric",
			intOrNull: "numeric",
		};

		inputElement = (
			<input type="text" {...commonProps} inputMode={inputModes[type]} />
		);
	}

	if (decoration === "currency") {
		return (
			<CurrencyInputGroup displayUnit="M" style={inputStyle}>
				{inputElement}
			</CurrencyInputGroup>
		);
	}

	if (decoration === "percent") {
		return (
			<div className="input-group" style={inputStyle}>
				{inputElement}
				<div className="input-group-text">%</div>
			</div>
		);
	}

	return inputElement;
};

const Option = ({
	id,
	disabled,
	name,
	description,
	descriptionLong,
	decoration,
	godModeRequired,
	newLeague,
	maxWidth,
	onCancelDefaultSetting,
	onChange,
	type,
	value,
	values,
	customForm,
}: {
	id: string;
	disabled: boolean;
	name: string;
	description?: ReactNode;
	descriptionLong?: ReactNode;
	decoration?: Decoration;
	godModeRequired?: "always" | "existingLeagueOnly";
	newLeague?: boolean;
	maxWidth?: true;
	onCancelDefaultSetting?: () => void;
	onChange: (event: ChangeEvent<HTMLInputElement | HTMLSelectElement>) => void;
	type: FieldType;
	value: unknown;
	values?: Values;
	customForm?: ReactNode;
}) => {
	const [showDescriptionLong, setShowDescriptionLong] = useState(false);

	let formElement;
	if (customForm) {
		formElement = customForm;
	} else {
		if (typeof value !== "string") {
			throw new Error("Value must be string");
		}
		formElement = (
			<Input
				type={type}
				disabled={disabled}
				godModeRequired={godModeRequired}
				id={id}
				maxWidth={maxWidth}
				name={name}
				onChange={onChange}
				value={value}
				values={values}
				decoration={decoration}
			/>
		);
	}

	// flex-wrap is so wide custom controls (like saveOldBoxScores) wraps when necessary, and also maxWidth ones wrap all the time
	return (
		<>
			<div
				className="d-flex flex-wrap gap-1 align-items-top"
				style={{ minHeight: 33 }}
			>
				<div className="me-auto text-nowrap">
					<label
						className="form-label mb-0"
						htmlFor={id}
						onClick={(event) => {
							// Don't toggle on label click, too confusing
							if (type === "bool") {
								event.preventDefault();
							}
						}}
						style={{ marginTop: 7 }}
					>
						{settingNeedsGodMode(godModeRequired, newLeague) ? (
							<span
								className="legend-square god-mode me-1"
								title={godModeRequiredMessage(godModeRequired)}
							/>
						) : null}
						{name.endsWith(" Factor") ? (
							<>
								{name.replace(" Factor", "")}
								<span className="d-none d-lg-inline"> Factor</span>
							</>
						) : (
							name
						)}
					</label>
					{descriptionLong ? (
						<span
							className="ms-1 glyphicon glyphicon-question-sign help-icon"
							onClick={() => {
								setShowDescriptionLong((show) => !show);
							}}
						/>
					) : null}
				</div>
				<div className={clsx("ms-auto", maxWidth ? "w-100" : undefined)}>
					{formElement}
				</div>
				{onCancelDefaultSetting ? (
					<button
						type="button"
						className="btn-close ms-1"
						title="Restore default"
						onClick={() => {
							onCancelDefaultSetting();
						}}
					/>
				) : null}
			</div>
			{description && !showDescriptionLong ? (
				<div className="text-body-secondary settings-description mt-1">
					{description}
				</div>
			) : null}
			<AnimatePresence initial={false}>
				{showDescriptionLong ? (
					<m.div
						initial="collapsed"
						animate="open"
						exit="collapsed"
						variants={{
							open: { opacity: 1, height: "auto" },
							collapsed: { opacity: 0, height: 0 },
						}}
						transition={{
							duration: 0.3,
							type: "tween",
						}}
						className="text-body-secondary settings-description mt-1"
					>
						{descriptionLong}
					</m.div>
				) : null}
			</AnimatePresence>
		</>
	);
};

export type HandleChange = (
	name: Key,
	type: FieldType,
) => (event: ChangeEvent<HTMLInputElement | HTMLSelectElement>) => void;

export type HandleChangeRaw = <Name extends Key>(
	name: Name,
) => (value: State[Name]) => void;

const SettingsFormOptions = ({
	disabled,
	gameSimPreset,
	godMode,
	handleChange,
	handleChangeRaw,
	newLeague,
	onCancelDefaultSetting,
	setGameSimPreset,
	showGodModeSettings,
	state,
	visibleCategories,
}: {
	disabled: boolean;
	gameSimPreset: string;
	godMode: boolean;
	handleChange: HandleChange;
	handleChangeRaw: HandleChangeRaw;
	newLeague?: boolean;
	onCancelDefaultSetting?: (key: Key) => void;
	setGameSimPreset: (gameSimPreset: string) => void;
	showGodModeSettings: boolean;
	state: State;
	visibleCategories: ReturnType<typeof getVisibleCategories>;
}) => {
	return (
		<>
			{visibleCategories.map((category) => {
				return (
					<Fragment key={category.name}>
						<a className="anchor" id={category.name} />
						<h2 className="mb-3">
							{category.name}
							{category.helpText ? (
								<HelpPopover title={category.name} className="ms-1">
									{category.helpText}
								</HelpPopover>
							) : null}
						</h2>
						{category.name === "Tendencies" &&
						isSport("basketball") &&
						gameSimPresets &&
						(godMode || showGodModeSettings) ? (
							<select
								className="form-select mb-3"
								style={{
									width: "inherit",
								}}
								value={gameSimPreset}
								disabled={!godMode}
								onChange={(event) => {
									setGameSimPreset(event.target.value);
								}}
							>
								<option value="default">
									Select preset based on historical NBA stats
								</option>
								{Object.keys(gameSimPresets)
									.sort()
									.reverse()
									.map((season) => (
										<option key={season} value={season}>
											{season}
										</option>
									))}
							</select>
						) : null}
						<div className="row mb-5 mb-md-3">
							{category.settings.map(
								(
									{
										customForm,
										decoration,
										description,
										descriptionLong,
										godModeRequired,
										key,
										maxWidth,
										name,
										type,
										values,
									},
									i,
								) => {
									const enabled = settingIsEnabled(
										godMode,
										newLeague,
										godModeRequired,
									);
									const id = `settings-${category.name}-${name}`;

									const customFormNode = customForm
										? customForm({
												disabled: !enabled || disabled,
												godModeRequired,
												handleChange,
												handleChangeRaw,
												id,
												inputStyle,
												state,
											})
										: undefined;

									return (
										<div
											key={key}
											className="settings-col col-md-6 col-xxl-4 d-flex"
										>
											<div
												className={clsx("fake-list-group-item rounded", {
													"settings-striped-bg-alt": i % 2 === 1,
													"pe-1": onCancelDefaultSetting,
												})}
											>
												<Option
													type={type}
													disabled={!enabled || disabled}
													id={id}
													onChange={handleChange(key, type)}
													value={state[key]}
													values={values}
													decoration={decoration}
													name={name}
													description={description}
													descriptionLong={descriptionLong}
													customForm={customFormNode}
													maxWidth={maxWidth}
													godModeRequired={godModeRequired}
													newLeague={newLeague}
													onCancelDefaultSetting={
														onCancelDefaultSetting
															? () => {
																	onCancelDefaultSetting(key);
																}
															: undefined
													}
												/>
											</div>
										</div>
									);
								},
							)}
						</div>
					</Fragment>
				);
			})}
		</>
	);
};

export default SettingsFormOptions;
