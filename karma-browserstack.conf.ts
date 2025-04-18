import karmaConfig from "./tools/lib/karmaConfig.ts";
import { readFileSync } from "node:fs";

const browserStack = JSON.parse(
	readFileSync("../../.browserstack.json", "utf8"),
);

const customLaunchers = [
	{
		base: "BrowserStack",
		browser: "firefox",
		browser_version: "115.0", // Works back to 115 currently
		os: "Windows",
		os_version: "10",
	},
	{
		base: "BrowserStack",
		browser: "chrome",
		browser_version: "85.0", // Works back to 85 currently
		os: "Windows",
		os_version: "10",
	},
	{
		base: "BrowserStack",
		browser: "safari",
		browser_version: "14.1", // Works back to 14.1 currently
		os: "OS X",
		os_version: "Big Sur",
	},
].reduce((acc, browser, i) => {
	acc[i] = browser;
	return acc;
}, {});

export default (config) => {
	config.set({
		...karmaConfig,
		browserStack,
		customLaunchers,
		browsers: Object.keys(customLaunchers),
	});
};
