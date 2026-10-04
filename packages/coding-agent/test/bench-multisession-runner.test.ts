import { afterEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import * as path from "node:path";
import { TempDir } from "@gajae-code/utils";
import { compareEvidence } from "../bench/multisession/normalize";
import { runSession } from "../bench/multisession/session-runner";
import { REQUIRED_WORKLOAD_EVENTS, type RunnerEvent, type WorkloadEventKind } from "../bench/multisession/types";

setDefaultTimeout(60_000);
let tempDir: TempDir | undefined;

afterEach(() => {
	tempDir?.removeSync();
	tempDir = undefined;
});

async function runOne(name: string): Promise<{ evidenceDir: string; events: RunnerEvent[] }> {
	if (!tempDir) throw new Error("Test temp directory was not initialized.");
	const events: RunnerEvent[] = [];
	const { evidenceDir } = await runSession({
		sessionIndex: 0,
		rootDir: path.join(tempDir.path(), name),
		idleMs: 0,
		emit: event => events.push(event),
	});
	return { evidenceDir, events };
}

function parseJsonLines(text: string): Record<string, unknown>[] {
	return text
		.split("\n")
		.filter(line => line.length > 0)
		.map(line => JSON.parse(line) as Record<string, unknown>);
}

describe("multi-session session runner", () => {
	test("runs the complete workload and compares reproducibly normalized evidence", async () => {
		tempDir = TempDir.createSync("@bench-multisession-runner-");
		const first = await runOne("first");
		const second = await runOne("second");

		const observed = new Set(
			first.events
				.filter((event): event is Extract<RunnerEvent, { type: "workload" }> => event.type === "workload")
				.map(event => event.event),
		);
		for (const required of REQUIRED_WORKLOAD_EVENTS) expect(observed.has(required as WorkloadEventKind)).toBe(true);
		expect(first.events.some(event => event.type === "phase" && event.phase === "constructed")).toBe(true);
		expect(first.events.some(event => event.type === "phase" && event.phase === "ready")).toBe(true);
		expect(first.events.some(event => event.type === "phase" && event.phase === "disposing")).toBe(true);
		expect(first.events.some(event => event.type === "phase" && event.phase === "disposed")).toBe(true);
		expect(first.events.filter(event => event.type === "turn")).toHaveLength(10);
		expect(first.events.some(event => event.type === "heap")).toBe(true);
		expect(first.events.some(event => event.type === "lag")).toBe(true);

		for (const evidenceDir of [first.evidenceDir, second.evidenceDir]) {
			for (const filename of [
				"transcript.jsonl",
				"requests.jsonl",
				"tools.jsonl",
				"events.jsonl",
				"timing.jsonl",
				"manifest.json",
			]) {
				expect(await Bun.file(path.join(evidenceDir, filename)).exists()).toBe(true);
			}
			expect((await Bun.file(path.join(evidenceDir, "transcript.jsonl")).text()).length).toBeGreaterThan(0);
			expect((await Bun.file(path.join(evidenceDir, "tools.jsonl")).text()).length).toBeGreaterThan(0);
		}

		await expect(compareEvidence(first.evidenceDir, second.evidenceDir)).resolves.toEqual({ equal: true, diffs: [] });
	});

	test("trims MockModel calls to two while retaining every emitted request", async () => {
		tempDir = TempDir.createSync("@bench-multisession-retention-");
		const run = await runOne("retention");
		const requests = parseJsonLines(await Bun.file(path.join(run.evidenceDir, "requests.jsonl")).text());

		expect(requests.length).toBeGreaterThan(2);
		expect(requests.every(request => typeof request.context === "object" && request.context !== null)).toBe(true);
		expect(
			requests.every(
				request => typeof request.callsArrayLengthAfterTrim === "number" && request.callsArrayLengthAfterTrim <= 2,
			),
		).toBe(true);
	});
});
