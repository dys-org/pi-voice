import { randomUUID } from "node:crypto";
import { mkdirSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { type ExtensionAPI, getAgentDir } from "@earendil-works/pi-coding-agent";

const voices: Record<string, { description: string; prompt: string }> = Object.fromEntries(
	readdirSync(new URL("./voices/", import.meta.url))
		.filter((name) => name.endsWith(".md"))
		.sort()
		.map((file) => {
			const [description, ...body] = readFileSync(new URL(`./voices/${file}`, import.meta.url), "utf8").split("\n");
			return [file.slice(0, -3), { description, prompt: body.join("\n").trim() }];
		}),
);
voices.default = { description: "No voice instructions", prompt: "" };
const names = Object.keys(voices).sort();

function isVoiceName(value: unknown): value is string {
	return typeof value === "string" && Object.hasOwn(voices, value);
}

export default function voice(pi: ExtensionAPI) {
	const agentDir = getAgentDir();
	const statePath = join(agentDir, "voice.json");
	let active = "default";

	function formatVoiceLabel(name: string) {
		return `${name}${name === active ? " (active)" : ""} — ${voices[name].description}`;
	}

	pi.on("session_start", (_event, ctx) => {
		active = "default";
		try {
			let contents: string;
			try {
				contents = readFileSync(statePath, "utf8");
			} catch (error) {
				if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
				contents = readFileSync(join(agentDir, "output-style.json"), "utf8");
			}
			const saved = JSON.parse(contents);
			const requested: unknown = saved?.voice ?? saved?.style;
			if (!isVoiceName(requested)) throw new Error('Expected a known voice in {"voice": "name"}');
			active = requested;
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
				ctx.ui.notify(`Could not load ${statePath}; using default. ${String(error)}`, "warning");
			}
		}
	});

	pi.on("before_agent_start", (event) => {
		if (active === "default") delete event.systemPromptOptions.sections.voice;
		else event.systemPromptOptions.sections.voice = voices[active].prompt;
	});

	const command: Parameters<ExtensionAPI["registerCommand"]>[1] = {
		description: "Choose a voice (default, concise, proactive, explanatory, learning)",
		getArgumentCompletions: (prefix) => {
			const matches = names.filter((name) => name.startsWith(prefix));
			return matches.length ? matches.map((name) => ({ value: name, label: formatVoiceLabel(name) })) : null;
		},
		handler: async (args, ctx) => {
			let requested = args.trim();
			if (!requested) {
				if (!ctx.hasUI) {
					ctx.ui.notify(`Use /voice <name>: ${names.join(", ")}. Active: ${active}`, "error");
					return;
				}
				const orderedNames = [active, ...names.filter((name) => name !== active)];
				const labels = orderedNames.map(formatVoiceLabel);
				const picked = await ctx.ui.select("Voice", labels);
				if (picked === undefined) return;
				requested = orderedNames[labels.indexOf(picked)] ?? "";
			}
			if (!isVoiceName(requested)) {
				ctx.ui.notify(`Unknown voice: ${requested}. Choose: ${names.join(", ")}`, "error");
				return;
			}

			// Unique sibling files keep concurrent sessions' atomic saves independent.
			const temporaryPath = `${statePath}.${randomUUID()}.tmp`;
			try {
				mkdirSync(agentDir, { recursive: true });
				try {
					writeFileSync(temporaryPath, `${JSON.stringify({ voice: requested })}\n`, { mode: 0o600, flag: "wx" });
					renameSync(temporaryPath, statePath);
				} finally {
					rmSync(temporaryPath, { force: true });
				}
			} catch (error) {
				ctx.ui.notify(`Could not save voice; selection unchanged. ${String(error)}`, "error");
				return;
			}
			active = requested;
			ctx.ui.notify(`Voice: ${active}. Applies on the next turn.`, "info");
		},
	};
	for (const name of ["voice", "output-style", "output-styles"]) pi.registerCommand(name, command);
}
