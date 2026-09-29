import { describe, expect, it } from "bun:test";
import { ACP_SESSION_READINESS_TIMEOUT_MS } from "../src/modes/acp/acp-agent";
import {
	DEFAULT_BROKER_PRESPAWN_PREPARATION_TIMEOUT_MS,
	DEFAULT_READINESS_TIMEOUT_MS,
	isValidReadinessTimeoutMs,
	lifecycleRequestTimeoutMs,
	lifecycleStartupBudgetMs,
} from "../src/sdk/broker/startup-budget";

/**
 * Regression guard for issue #5565: a queued or slow-cold-start `session.create`
 * let gjc's ACP adapter wait ~62s (queue wait + readiness, i.e. 2·R plus slack)
 * before answering `session/new`, past paseo's 60s connect timeout, so paseo
 * reported "Timeout waiting for message (60000ms)" while gjc was still healthy.
 *
 * The startup lifecycle operations (`session.create`/`fork`/`resume`) all spawn
 * a host and so carry the doubled queue+readiness budget plus bounded broker
 * pre-spawn bookkeeping. The readiness budget stays above the concurrency
 * cold-start floor.
 */
describe("ACP session readiness budget (#5565)", () => {
	const startupOperations = ["session.create", "session.fork", "session.resume"] as const;

	// Matches the input shape acp-agent's #launchSessionWithMcp sends: a cwd
	// target and the readiness budget, with no worktree/dependency preparation.
	const launchInput = {
		cwd: "/repo",
		target: { path: "/repo" },
		readinessTimeoutMs: ACP_SESSION_READINESS_TIMEOUT_MS,
	};

	it("requests a valid readiness budget", () => {
		expect(isValidReadinessTimeoutMs(ACP_SESSION_READINESS_TIMEOUT_MS)).toBe(true);
	});

	it("covers broker pre-spawn preparation and fresh readiness", () => {
		for (const operation of startupOperations) {
			const budget = lifecycleRequestTimeoutMs(operation, launchInput);
			expect(budget).toBe(
				lifecycleStartupBudgetMs(ACP_SESSION_READINESS_TIMEOUT_MS) +
					DEFAULT_BROKER_PRESPAWN_PREPARATION_TIMEOUT_MS +
					1_000,
			);
		}
	});

	it("keeps the readiness budget above the concurrency cold-start floor", () => {
		// Below the broker's 10s default a second host cold-starting beside the
		// first crosses the deadline and the launch is reported terminal_uncertain.
		expect(ACP_SESSION_READINESS_TIMEOUT_MS).toBeGreaterThan(DEFAULT_READINESS_TIMEOUT_MS);
	});
});
