import { afterEach, describe, expect, it, vi } from "bun:test";
import type Anthropic from "@anthropic-ai/sdk";
import { streamAnthropic } from "../src/providers/anthropic";
import type { Context, Model } from "../src/types";

const model: Model<"anthropic-messages"> = {
	id: "claude-sonnet-4-5",
	name: "Claude Sonnet 4.5",
	api: "anthropic-messages",
	provider: "anthropic",
	baseUrl: "https://custom.example.com",
	reasoning: true,
	input: ["text"],
	cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
	contextWindow: 200_000,
	maxTokens: 8_192,
};

// Create a large request (>1MB) to trigger the ceiling logic
const largeContext: Context = {
	messages: [{ role: "user", content: "x".repeat(1_100_000), timestamp: Date.now() }],
};

type MockAnthropicEvent = Record<string, unknown>;
type MockAnthropicStream = AsyncIterable<MockAnthropicEvent>;

type MockAnthropicRequest = {
	withResponse(): Promise<{
		data: MockAnthropicStream;
		response: Response;
		request_id: string | null;
	}>;
};

function createSuccessfulAnthropicEvents(text: string): MockAnthropicEvent[] {
	return [
		{
			type: "message_start",
			message: {
				id: "msg_success",
				usage: {
					input_tokens: 12,
					output_tokens: 0,
					cache_read_input_tokens: 0,
					cache_creation_input_tokens: 0,
				},
			},
		},
		{
			type: "content_block_start",
			index: 0,
			content_block: { type: "text", text: "" },
		},
		{
			type: "content_block_delta",
			index: 0,
			delta: { type: "text_delta", text },
		},
		{ type: "content_block_stop", index: 0 },
		{
			type: "message_delta",
			delta: { stop_reason: "end_turn" },
			usage: {
				input_tokens: 12,
				output_tokens: 4,
				cache_read_input_tokens: 0,
				cache_creation_input_tokens: 0,
			},
		},
	];
}

function createAnthropicMockStream({
	signal,
	connectDelayMs = 0,
	eventDelayMs = 0,
	events,
	hangAfterEvents = false,
	connectError,
}: {
	signal: AbortSignal | undefined;
	connectDelayMs?: number;
	eventDelayMs?: number;
	events?: MockAnthropicEvent[];
	hangAfterEvents?: boolean;
	connectError?: Error;
}): MockAnthropicRequest {
	return {
		async withResponse() {
			if (connectDelayMs > 0) {
				await new Promise(resolve => setTimeout(resolve, connectDelayMs));
			}
			if (connectError) {
				throw connectError;
			}
			const response = new Response(null, {
				status: 200,
				headers: { "request-id": "req_mock" },
			});
			const stream: MockAnthropicStream = {
				async *[Symbol.asyncIterator]() {
					if (!events) {
						await new Promise<void>(() => {
							// Never resolve, wait for abort
						});
						return;
					}
					if (eventDelayMs > 0) {
						await new Promise(resolve => setTimeout(resolve, eventDelayMs));
					}
					for (const event of events) {
						yield event;
					}
					if (hangAfterEvents) {
						await new Promise<void>(() => {
							// Never resolve, wait for abort
						});
					}
				},
			};
			return {
				data: stream,
				response,
				request_id: response.headers.get("request-id"),
			};
		},
	};
}

describe("anthropic custom endpoint transport retry", () => {
	afterEach(() => {
		vi.useRealTimers();
	});

	it("retries pre-response transport failures (ECONNRESET) on custom endpoints with large requests", async () => {
		let attemptCount = 0;
		const create = ((_body: unknown, requestOptions?: { signal?: AbortSignal }) => {
			attemptCount++;
			if (attemptCount === 1) {
				// First attempt: simulate socket closed unexpectedly (ECONNRESET-like error)
				return {
					async withResponse(): Promise<never> {
						throw new Error("socket closed unexpectedly");
					},
				} as never;
			}

			// Second attempt: succeed
			return createAnthropicMockStream({
				signal: requestOptions?.signal,
				events: createSuccessfulAnthropicEvents("Hello!"),
			}) as never;
		}) as unknown as Anthropic["messages"]["create"];

		const result = await streamAnthropic(model, largeContext, {
			client: { messages: { create } } as Anthropic,
			streamMaxRetries: 3,
			providerRetryWait: async () => {},
		}).result();

		// Verify that we successfully retried and got the response
		expect(attemptCount).toBe(2);
		expect(result.content[0]?.type).toBe("text");
		if (result.content[0]?.type === "text") {
			expect(result.content[0].text).toBe("Hello!");
		}
		expect(result.stopReason).toBe("stop");
	});

	it("distinguishes transport errors from timeouts to allow normal retries", async () => {
		// This test verifies that transport errors (like ECONNRESET) are
		// retried normally, not clamped to the first-event timeout ceiling.
		// A timeout should result in retryMaxAttempts=1, but a transport
		// error on the first attempt should be retried.
		let attempts = 0;
		const create = ((_body: unknown, requestOptions?: { signal?: AbortSignal }) => {
			attempts++;
			if (attempts === 1) {
				// First attempt: transport error
				return {
					async withResponse(): Promise<never> {
						throw new Error("connection refused");
					},
				} as never;
			}
			// Second attempt: succeed
			return createAnthropicMockStream({
				signal: requestOptions?.signal,
				events: createSuccessfulAnthropicEvents("Success!"),
			}) as never;
		}) as unknown as Anthropic["messages"]["create"];

		const result = await streamAnthropic(model, largeContext, {
			client: { messages: { create } } as Anthropic,
			streamMaxRetries: 3,
			providerRetryWait: async () => {},
		}).result();

		// Transport errors should be retried, not clamped by the ceiling
		expect(attempts).toBe(2);
		expect(result.stopReason).toBe("stop");
		expect(result.content[0]?.type).toBe("text");
		if (result.content[0]?.type === "text") {
			expect(result.content[0].text).toBe("Success!");
		}
	});
});
