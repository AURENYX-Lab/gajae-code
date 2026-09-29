import { afterEach, expect, spyOn, test } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { NotificationServer } from "@gajae-code/natives";
import type { ExtensionActions, ExtensionAPI } from "../src/extensibility/extensions/types";
import { brokerOwnerForTest } from "../src/sdk/broker/ensure";
import { createNotificationsExtension } from "../src/sdk/bus";
import { RESPONSE_CEILING_BYTES } from "../src/sdk/host/query/handlers";

/**
 * Issue #4691: a broker-managed SDK prompt that outlives the process-local
 * submission TTL (PROMPT_SUBMISSION_TTL_MS = 5 min) must still publish exactly
 * one correlated terminal lifecycle event. Before the fix, terminalization
 * committed the durable outcome, then emitPromptLifecycle ran
 * cleanupPromptRecords first, which age-evicted the just-terminalized record,
 * so the positioned ring and the requester never saw `agent_end`.
 */

const dirs: string[] = [];
// Captured before any Date.now spy: waitFor deadlines must use the real clock
// even while the process clock is shifted past the submission TTL.
const realNow = Date.now.bind(Date);
const sockets: WebSocket[] = [];
const isolatedSdkHostTest = process.env.GJC_CI_SDK_HOST_ISOLATED === "1" ? test : test.skip;

afterEach(async () => {
	await Promise.all(sockets.splice(0).map(closeSocket));
	for (const dir of dirs) await brokerOwnerForTest(dir)?.stop();
	for (const dir of dirs.splice(0)) await fs.promises.rm(dir, { recursive: true, force: true });
});

async function closeSocket(socket: WebSocket): Promise<void> {
	if (socket.readyState === WebSocket.CLOSED) return;
	const { promise, resolve } = Promise.withResolvers<void>();
	socket.addEventListener("close", () => resolve(), { once: true });
	socket.close();
	await Promise.race([promise, Bun.sleep(500)]);
}

async function waitFor(predicate: () => boolean, label: string, timeoutMs = 10_000): Promise<void> {
	const deadline = realNow() + timeoutMs;
	while (!predicate()) {
		if (realNow() > deadline) throw new Error(`Timed out waiting for ${label}`);
		await Bun.sleep(20);
	}
}

function context(cwd: string, sessionId: string): Record<string, unknown> {
	return {
		cwd,
		sessionMetadata: { kind: "main", taskDepth: 0 },
		sessionManager: {
			getSessionId: () => sessionId,
			getCwd: () => cwd,
			getSessionName: () => "prompt terminal ttl",
			getUsageStatistics: () => ({ input: 1, output: 2, cacheRead: 0, cacheWrite: 0, premiumRequests: 0, cost: 0 }),
			getBranch: () => [],
		},
		getContextUsage: () => ({ tokens: 3, contextWindow: 100, percent: 3 }),
		model: { provider: "fixture-provider", id: "fixture-model" },
		getThinkingLevel: () => "low",
		getActivePromptHandle: () => undefined,
		getSystemPrompt: () => ["test"],
		isIdle: () => true,
		hasPendingMessages: () => false,
		getPendingMessageCounts: () => ({ steering: 0, followUp: 0, nextTurn: 0 }),
		resolveTool: () => undefined,
	};
}

function start(
	ctx: Record<string, unknown>,
	deliverUserMessage: ExtensionActions["sendUserMessage"] = () => undefined,
): Map<string, (event: unknown, context: unknown) => unknown> {
	const handlers = new Map<string, (event: unknown, context: unknown) => unknown>();
	const api = {
		on: (event: string, handler: (event: unknown, context: unknown) => unknown) => handlers.set(event, handler),
		registerCommand: () => {},
		getThinkingLevel: () => undefined,
		sendUserMessage: (
			content: Parameters<ExtensionActions["sendUserMessage"]>[0],
			options?: Parameters<ExtensionActions["sendUserMessage"]>[1],
		) => {
			const commit = options?.onPreflightAcceptCommit;
			const accepted = options?.onPreflightAccepted;
			const deliver = () => Promise.resolve(deliverUserMessage(content));
			if (commit)
				return Promise.resolve(commit()).then(() => {
					accepted?.();
					return deliver();
				});
			accepted?.();
			return deliver();
		},
	} as unknown as ExtensionAPI;
	createNotificationsExtension(api, undefined);
	void handlers.get("session_start")?.({ type: "session_start" }, ctx);
	return handlers;
}

async function connect(
	cwd: string,
	sessionId: string,
): Promise<{ socket: WebSocket; frames: Record<string, unknown>[] }> {
	const endpointFile = path.join(cwd, ".gjc", "state", "sdk", `${sessionId}.json`);
	await waitFor(() => fs.existsSync(endpointFile), "SDK endpoint");
	const endpoint = JSON.parse(fs.readFileSync(endpointFile, "utf8")) as { url: string; token: string };
	const frames: Record<string, unknown>[] = [];
	const socket = new WebSocket(`${endpoint.url}/?token=${encodeURIComponent(endpoint.token)}`);
	sockets.push(socket);
	socket.addEventListener("message", event => frames.push(JSON.parse(String(event.data))));
	await new Promise<void>((resolve, reject) => {
		socket.addEventListener("open", () => resolve(), { once: true });
		socket.addEventListener("error", () => reject(new Error("WS error")), { once: true });
	});
	return { socket, frames };
}

isolatedSdkHostTest("oversized correlated snapshots still reach a prompt terminal", async () => {
	const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "gjc-sdk-oversized-prompt-"));
	dirs.push(cwd);
	const sessionId = `sdk-oversized-prompt-${Date.now()}`;
	const sessionContext = context(cwd, sessionId);
	const handlers = start(sessionContext, () => new Promise<never>(() => {}) as never);
	const { socket, frames } = await connect(cwd, sessionId);
	socket.send(
		JSON.stringify({
			type: "control_request",
			id: "oversized-prompt",
			operation: "turn.prompt",
			input: { text: "stream" },
		}),
	);
	await waitFor(
		() => frames.some(frame => frame.type === "control_response" && frame.id === "oversized-prompt"),
		"prompt acknowledgement",
	);
	const acknowledgement = frames.find(
		frame => frame.type === "control_response" && frame.id === "oversized-prompt",
	) as { result: { commandId: string; turnId: string } };
	const correlation = acknowledgement.result;
	await handlers.get("agent_start")?.({ type: "agent_start" }, sessionContext);
	const largeMessage = { role: "assistant", content: [{ type: "text", text: "x".repeat(RESPONSE_CEILING_BYTES) }] };
	await handlers.get("message_update")?.(
		{ type: "message_update", message: largeMessage, assistantMessageEvent: { type: "text_delta", delta: "x" } },
		sessionContext,
	);
	await handlers.get("message_update")?.(
		{
			type: "message_update",
			message: { role: "assistant", content: [] },
			assistantMessageEvent: { type: "text_delta", delta: "later" },
		},
		sessionContext,
	);
	await handlers.get("message_end")?.({ type: "message_end", message: largeMessage }, sessionContext);
	await handlers.get("agent_end")?.({ type: "agent_end", stopReason: "completed", messages: [] }, sessionContext);
	await waitFor(
		() =>
			frames.some(
				frame =>
					frame.type === "agent_end" &&
					frame.commandId === correlation.commandId &&
					frame.turnId === correlation.turnId,
			),
		"correlated terminal",
		2000,
	);
	expect(
		frames.some(
			frame =>
				frame.type === "event" &&
				frame.kind === "message_update" &&
				(frame.payload as { event?: { assistantMessageEvent?: { delta?: string } } }).event?.assistantMessageEvent
					?.delta === "later",
		),
	).toBe(true);
	expect(
		frames.some(
			frame =>
				frame.type === "event" &&
				frame.kind === "message_update" &&
				(frame.payload as { event?: { assistantMessageEvent?: { delta?: string } } }).event?.assistantMessageEvent
					?.delta === "x",
		),
	).toBe(true);
	const messageEnd = frames.find(frame => frame.type === "event" && frame.kind === "message_end");
	expect(messageEnd).toBeDefined();
	expect(Buffer.byteLength(JSON.stringify(messageEnd))).toBeLessThanOrEqual(RESPONSE_CEILING_BYTES);
	expect(JSON.stringify(messageEnd)).toContain("[truncated]");
});

isolatedSdkHostTest(
	"failed correlated terminal delivery sends a classified terminal",
	async () => {
		const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "gjc-sdk-delivery-failure-"));
		dirs.push(cwd);
		const sessionId = `sdk-delivery-failure-${Date.now()}`;
		const sessionContext = context(cwd, sessionId);
		const handlers = start(sessionContext, () => new Promise<never>(() => {}) as never);
		const { socket, frames } = await connect(cwd, sessionId);
		socket.send(
			JSON.stringify({
				type: "control_request",
				id: "failed-delivery",
				operation: "turn.prompt",
				input: { text: "stream" },
			}),
		);
		await waitFor(
			() => frames.some(frame => frame.type === "control_response" && frame.id === "failed-delivery"),
			"prompt acknowledgement",
		);
		const acknowledgement = frames.find(
			frame => frame.type === "control_response" && frame.id === "failed-delivery",
		) as { result: { commandId: string; turnId: string } };
		await handlers.get("agent_start")?.({ type: "agent_start" }, sessionContext);
		const original = NotificationServer.prototype.sendTo;
		const send = spyOn(NotificationServer.prototype, "sendTo").mockImplementation(function (
			this: NotificationServer,
			connectionId,
			json,
		) {
			if (JSON.parse(json).type === "agent_end")
				throw new Error("sdk directed delivery rejected: cause=writer_backlog_full frameBytes=200");
			return original.call(this, connectionId, json);
		});
		try {
			await handlers.get("agent_end")?.(
				{ type: "agent_end", stopReason: "completed", messages: [] },
				sessionContext,
			);
			await waitFor(
				() =>
					frames.some(
						frame =>
							frame.type === "agent_failed" &&
							frame.commandId === acknowledgement.result.commandId &&
							frame.turnId === acknowledgement.result.turnId,
					),
				"delivery failure terminal",
				2000,
			);
			const failure = frames.find(
				frame => frame.type === "agent_failed" && frame.commandId === acknowledgement.result.commandId,
			) as { error: { code: string; cause: string; frameBytes: number }; outcome: { providerCode?: string } };
			expect(failure.error.code).toBe("delivery_failed");
			expect(failure.error.cause).toBe("writer_backlog_full");
			expect(failure.error.frameBytes).toBeLessThan(RESPONSE_CEILING_BYTES);
			expect(failure.outcome.providerCode).toBe("writer_backlog_full");
		} finally {
			send.mockRestore();
		}
	},
	10_000,
);

isolatedSdkHostTest(
	"failed correlated non-terminal delivery does not terminalize an active prompt",
	async () => {
		const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "gjc-sdk-delivery-race-"));
		dirs.push(cwd);
		const sessionId = `sdk-delivery-race-${Date.now()}`;
		const sessionContext = context(cwd, sessionId);
		const handlers = start(sessionContext, () => new Promise<never>(() => {}) as never);
		const { socket, frames } = await connect(cwd, sessionId);
		socket.send(
			JSON.stringify({
				type: "control_request",
				id: "delivery-race",
				operation: "turn.prompt",
				input: { text: "stream" },
			}),
		);
		await waitFor(
			() => frames.some(frame => frame.type === "control_response" && frame.id === "delivery-race"),
			"prompt acknowledgement",
		);
		const original = NotificationServer.prototype.sendTo;
		let failedNonTerminalSend = false;
		let syntheticTerminalSend = false;
		const send = spyOn(NotificationServer.prototype, "sendTo").mockImplementation(function (
			this: NotificationServer,
			connectionId,
			json,
		) {
			const frame = JSON.parse(json) as { type?: string; kind?: string };
			if (!failedNonTerminalSend && frame.type === "event" && frame.kind === "message_update") {
				failedNonTerminalSend = true;
				throw new Error("sdk directed delivery rejected: cause=writer_backlog_full frameBytes=200");
			}
			if (frame.type === "agent_failed") syntheticTerminalSend = true;
			return original.call(this, connectionId, json);
		});
		try {
			await handlers.get("agent_start")?.({ type: "agent_start" }, sessionContext);
			await handlers.get("message_update")?.(
				{
					type: "message_update",
					message: { role: "assistant", content: [] },
					assistantMessageEvent: { type: "text_delta", delta: "active run" },
				},
				sessionContext,
			);
			expect(failedNonTerminalSend).toBe(true);
			expect(syntheticTerminalSend).toBe(false);
		} finally {
			send.mockRestore();
		}
	},
	10_000,
);
