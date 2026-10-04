import { afterEach, describe, expect, test } from "bun:test";
import * as path from "node:path";
import { TempDir } from "@gajae-code/utils";
import { compareEvidence } from "../bench/multisession/normalize";

let tempDir: TempDir | undefined;

afterEach(() => {
	tempDir?.removeSync();
	tempDir = undefined;
});

async function writeEvidence(
	directory: string,
	root: string,
	mutate?: (stream: string, record: Record<string, unknown>) => void,
): Promise<void> {
	await Bun.write(path.join(directory, "transcript.jsonl"), "");
	await Bun.write(path.join(directory, "requests.jsonl"), "");
	await Bun.write(path.join(directory, "tools.jsonl"), "");
	await Bun.write(path.join(directory, "events.jsonl"), "");
	await Bun.write(path.join(directory, "timing.jsonl"), "");

	const transcript = [
		{ type: "session", id: "session-one", timestamp: "2026-01-01T00:00:00.000Z", cwd: path.join(root, "project") },
		{
			type: "message",
			id: "entry-user",
			parentId: null,
			timestamp: "2026-01-01T00:00:01.000Z",
			message: { role: "user", content: "read the bench file", timestamp: 1_000 },
		},
		{
			type: "message",
			id: "entry-assistant",
			parentId: "entry-user",
			timestamp: "2026-01-01T00:00:02.000Z",
			message: {
				role: "assistant",
				content: [
					{ type: "text", text: "assistant text remains significant" },
					{ type: "toolCall", id: "tool-call-one", name: "bash", arguments: { command: "printf ok" } },
				],
				responseId: "response-one",
				duration: 25,
				promptPrefix: { hash: "prefix-one", messages: 2, reusedMessages: 1, previousMessages: 1, change: "append" },
				timestamp: 2_000,
			},
		},
		{
			type: "custom_message",
			id: "entry-task-notice",
			parentId: "entry-assistant",
			jobId: "job-one",
			durationMs: 25,
			content:
				'<system-notice>\nBackground job job-one has completed.\n<task-summary>\n<header>1/1 succeeded [500ms]</header>\n<agent id="job-one" agent="executor">\n<synopsis ref="agent://job-one">\nTask result stays significant.\n</synopsis>\n</task-summary>\n</system-notice>',
		},
		{
			type: "compaction",
			id: "compaction-one",
			parentId: "entry-task-notice",
			compactionEntryId: "compaction-one",
			firstKeptEntryId: "entry-user",
			tokensBefore: 123,
			evictedContent: { compactionEntryId: "compaction-one", firstKeptEntryId: "entry-user", evictedAt: 1000 },
		},
	];
	const requests = [
		{
			sessionId: "session-one",
			context: { messages: [{ role: "user", content: "same request payload", timestamp: 1_000 }] },
			options: { pid: 111, timestamp: "2026-01-01T00:00:01.000Z" },
		},
	];
	const tools = [
		{
			toolCallId: "tool-call-one",
			toolName: "bash",
			args: { command: "printf ok" },
			result: { content: [{ type: "text", text: "tool result remains significant" }] },
			pid: 111,
		},
	];
	const events = [{ type: "phase", sessionIndex: 0, phase: "ready", t: 1234, pid: 111 }];
	const timing = [{ type: "turn", sessionIndex: 0, turn: 1, startedAt: 1000, endedAt: 1050, ok: true }];
	const rows: Record<string, Record<string, unknown>[]> = {
		"transcript.jsonl": transcript,
		"requests.jsonl": requests,
		"tools.jsonl": tools,
		"events.jsonl": events,
		"timing.jsonl": timing,
	};
	for (const [stream, records] of Object.entries(rows)) {
		const lines = records.map(record => {
			mutate?.(stream, record);
			return JSON.stringify(record);
		});
		await Bun.write(path.join(directory, stream), `${lines.join("\n")}\n`);
	}
}

function fixturePaths(name: string): { evidence: string; root: string } {
	if (!tempDir) throw new Error("Test temp directory was not initialized.");
	const root = path.join(tempDir.path(), name);
	return { root, evidence: path.join(root, "evidence") };
}

describe("multi-session evidence normalizer", () => {
	test("normalizes allowed runtime IDs, time fields, job-notice tokens, hashes, and temp paths", async () => {
		tempDir = TempDir.createSync("@bench-multisession-normalize-equal-");
		const left = fixturePaths("left");
		const right = fixturePaths("right");
		await Promise.all([
			writeEvidence(left.evidence, left.root),
			writeEvidence(right.evidence, right.root, (stream, record) => {
				if (stream === "transcript.jsonl") {
					record.id = `new-${String(record.id)}`;
					if ("timestamp" in record) record.timestamp = "2026-02-02T00:00:00.000Z";
					if (typeof record.cwd === "string") record.cwd = record.cwd.replace(left.root, right.root);
					if (record.type === "message" && typeof record.message === "object" && record.message !== null) {
						const message = record.message as Record<string, unknown>;
						if (message.role === "assistant") {
							message.timestamp = 9999;
							message.responseId = "new-response";
							message.duration = 800;
							if (typeof message.promptPrefix === "object" && message.promptPrefix !== null) {
								(message.promptPrefix as Record<string, unknown>).hash = "new-prefix";
							}
						}
						if (Array.isArray(message.content)) {
							const call = message.content.find(
								item => typeof item === "object" && item !== null && "id" in item,
							);
							if (call && typeof call === "object") (call as Record<string, unknown>).id = "new-tool-call";
						}
					}
					if (record.type === "custom_message") {
						record.jobId = "job-two";
						record.durationMs = 800;
						if (typeof record.content === "string") {
							record.content = record.content.replaceAll("job-one", "job-two").replace("[500ms]", "[1.2s]");
						}
					}
					if (record.type === "compaction") {
						record.compactionEntryId = "compaction-two";
						record.firstKeptEntryId = "entry-assistant";
						const evictedContent = record.evictedContent as Record<string, unknown>;
						evictedContent.compactionEntryId = "compaction-two";
						evictedContent.firstKeptEntryId = "entry-assistant";
						evictedContent.evictedAt = 9999;
					}
				}
				if (stream === "requests.jsonl") {
					record.sessionId = "new-session";
					const options = record.options as Record<string, unknown>;
					options.pid = 222;
					options.timestamp = "2026-02-02T00:00:01.000Z";
					const context = record.context as { messages: Array<Record<string, unknown>> };
					context.messages[0]!.timestamp = 9999;
				}
				if (stream === "tools.jsonl") {
					record.toolCallId = "new-tool-call";
					record.pid = 222;
				}
				if (stream === "events.jsonl") {
					record.t = 9999;
					record.pid = 222;
				}
				if (stream === "timing.jsonl") {
					record.startedAt = 9000;
					record.endedAt = 9050;
				}
			}),
		]);

		await expect(compareEvidence(left.evidence, right.evidence)).resolves.toEqual({ equal: true, diffs: [] });
	});

	test("retains request payload, tool arguments, assistant text, tool results, and token evidence", async () => {
		tempDir = TempDir.createSync("@bench-multisession-normalize-diff-");
		const cases = [
			{
				stream: "requests.jsonl",
				mutate: (_stream: string, record: Record<string, unknown>) => {
					if (_stream !== "requests.jsonl") return;
					const context = record.context as { messages: Array<Record<string, unknown>> };
					context.messages[0]!.content = "mutated request payload";
				},
			},
			{
				stream: "tools.jsonl",
				mutate: (_stream: string, record: Record<string, unknown>) => {
					if (_stream === "tools.jsonl") (record.args as Record<string, unknown>).command = "printf changed";
				},
			},
			{
				stream: "transcript.jsonl",
				mutate: (_stream: string, record: Record<string, unknown>) => {
					if (_stream !== "transcript.jsonl" || record.type !== "message") return;
					const message = record.message as Record<string, unknown>;
					if (message.role === "assistant" && Array.isArray(message.content)) {
						const text = message.content[0] as Record<string, unknown>;
						text.text = "mutated assistant text";
					}
				},
			},
			{
				stream: "tools.jsonl",
				mutate: (_stream: string, record: Record<string, unknown>) => {
					if (_stream !== "tools.jsonl") return;
					const result = record.result as { content: Array<Record<string, unknown>> };
					result.content[0]!.text = "mutated tool result";
				},
			},
			{
				stream: "transcript.jsonl",
				mutate: (_stream: string, record: Record<string, unknown>) => {
					if (_stream === "transcript.jsonl" && record.type === "compaction") record.tokensBefore = 124;
				},
			},
		];

		for (const [index, change] of cases.entries()) {
			const left = fixturePaths(`left-${index}`);
			const right = fixturePaths(`right-${index}`);
			await Promise.all([
				writeEvidence(left.evidence, left.root),
				writeEvidence(right.evidence, right.root, change.mutate),
			]);
			const result = await compareEvidence(left.evidence, right.evidence);
			expect(result.equal).toBe(false);
			expect(result.diffs.some(diff => diff.startsWith(change.stream))).toBe(true);
		}
	});
});
