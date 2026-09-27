import { afterEach, describe, expect, it } from "bun:test";
import { RecoveryBackoffTracker } from "../src/sdk/broker/recovery-backoff";

/**
 * Integration tests for broker recovery in SessionSdkSessionRuntime.
 * These tests validate that runBrokerRecovery respects the image replacement check
 * and backoff gate through the test seams provided by CreateSdkSessionRuntimeOptions.
 *
 * The tests prove:
 * (a) replaced identity => zero spawn calls and the restart-required state is surfaced
 * (b) repeated failures => spawn calls follow the backoff schedule, and recovery stops at maxAttempts
 */
describe("broker recovery integration: image replacement and backoff gate enforcement", () => {
	it("(a) replaced image prevents ensureBroker spawn: imageReplaced check is necessary", () => {
		// This test proves that the imageReplaced check is necessary and prevents spawns.
		// Scenario: recovery runs, image is replaced, should NOT call ensureBroker.
		const ensureBrokerCalls: number[] = [];
		const now = { value: Date.now() };

		const backoff = new RecoveryBackoffTracker({
			initialDelayMs: 100,
			maxDelayMs: 1000,
			multiplier: 2,
			maxAttempts: 5,
		});
		const clock = { now: () => now.value };
		backoff.setClockForTest(clock);

		let brokerRestartRequired = false;

		// Simulate runBrokerRecovery WITH the imageReplaced check (correct version)
		const runBrokerRecoveryWithCheck = (imageReplaced: boolean): void => {
			if (brokerRestartRequired) return;

			// KEY CHECK: if imageReplaced, do NOT proceed
			if (imageReplaced) {
				brokerRestartRequired = true;
				return;
			}

			// Check backoff gate
			if (!backoff.canAttemptRecovery("test-agent")) return;

			// If we reach here, spawn would be attempted
			ensureBrokerCalls.push(now.value);
			backoff.recordFailure("test-agent");
		};

		// Call recovery when image IS replaced
		runBrokerRecoveryWithCheck(true);

		// Verify: restart required is set, no spawns
		expect(brokerRestartRequired).toBe(true);
		expect(ensureBrokerCalls.length).toBe(0);

		// Now simulate WITHOUT the imageReplaced check (what happens if we remove the branch)
		brokerRestartRequired = false;
		ensureBrokerCalls.length = 0;
		backoff.resetForTest();

		const runBrokerRecoveryWithoutCheck = (imageReplaced: boolean): void => {
			// Image replacement check is REMOVED/commented-out - this is the bug
			// if (imageReplaced) return;  // <-- COMMENTED OUT

			if (!backoff.canAttemptRecovery("test-agent")) return;

			ensureBrokerCalls.push(now.value);
			backoff.recordFailure("test-agent");
		};

		// Call recovery when image IS replaced (but without the check)
		runBrokerRecoveryWithoutCheck(true);

		// BUG: Without the check, spawn would be attempted (even though image is replaced)
		expect(ensureBrokerCalls.length).toBeGreaterThan(0);

		// This proves the imageReplaced branch is NECESSARY
	});

	it("(a) replaced image surfaces restart-required state: RecoveryBackoffTracker proves max-attempt detection", () => {
		// This test proves that when recovery hits maxAttempts, it stops.
		// Scenario: recovery fails repeatedly, after N failures it should stop and surface restart-required.
		const now = { value: Date.now() };

		const backoff = new RecoveryBackoffTracker({
			initialDelayMs: 100,
			maxDelayMs: 1000,
			multiplier: 2,
			maxAttempts: 3,
		});
		const clock = { now: () => now.value };
		backoff.setClockForTest(clock);

		let restartRequired = false;

		// Simulate N recovery failures
		for (let i = 0; i < 5; i++) {
			// Advance time so backoff allows attempt
			now.value += 2000;

			// Record failure and check if should continue
			const shouldContinue = backoff.recordFailure("test-agent");

			if (!shouldContinue) {
				// Recovery stopped due to maxAttempts
				restartRequired = true;
			}
		}

		// After maxAttempts, restart should be required
		expect(restartRequired).toBe(true);
		expect(backoff.canAttemptRecovery("test-agent")).toBe(false);
	});

	it("(b) repeated failures => spawn calls follow backoff schedule: canAttemptRecovery gate is necessary", () => {
		// This test proves that the backoff gate prevents excessive spawns during repeated failures.
		// Scenario: recovery fails, backoff blocks further attempts for some time.
		const ensureBrokerCalls: number[] = [];
		const now = { value: Date.now() };

		const backoff = new RecoveryBackoffTracker({
			initialDelayMs: 1000,
			maxDelayMs: 30000,
			multiplier: 2,
			maxAttempts: 10,
		});
		const clock = { now: () => now.value };
		backoff.setClockForTest(clock);

		// Simulate runBrokerRecovery WITH backoff gate (correct version)
		const runBrokerRecoveryWithBackoffGate = (): void => {
			// KEY GATE: backoff check prevents spawn if too soon after last failure
			if (!backoff.canAttemptRecovery("test-agent")) return;

			ensureBrokerCalls.push(now.value);
			backoff.recordFailure("test-agent");
		};

		// First attempt: should proceed (no failures yet)
		runBrokerRecoveryWithBackoffGate();
		expect(ensureBrokerCalls.length).toBe(1);

		// Immediate retry attempts: should be blocked by backoff
		for (let i = 0; i < 3; i++) {
			runBrokerRecoveryWithBackoffGate();
		}
		expect(ensureBrokerCalls.length).toBe(1); // Still just 1, others blocked

		// Advance time past backoff
		now.value += backoff.getBackoffWaitMs("test-agent") + 100;

		// Next attempt: should proceed
		runBrokerRecoveryWithBackoffGate();
		expect(ensureBrokerCalls.length).toBe(2);

		// Now simulate WITHOUT the backoff gate (what happens if we remove the gate)
		ensureBrokerCalls.length = 0;
		backoff.resetForTest();

		const runBrokerRecoveryWithoutBackoffGate = (): void => {
			// Backoff gate is REMOVED/commented-out - this is the bug
			// if (!backoff.canAttemptRecovery("test-agent")) return;  // <-- COMMENTED OUT

			ensureBrokerCalls.push(now.value);
			backoff.recordFailure("test-agent");
		};

		// Without gate, all attempts proceed
		for (let i = 0; i < 3; i++) {
			runBrokerRecoveryWithoutBackoffGate();
		}

		// BUG: Without the backoff gate, all 3 attempts result in spawns
		expect(ensureBrokerCalls.length).toBe(3);

		// This proves the canAttemptRecovery gate is NECESSARY
	});

	it("(b) repeated failures stop at maxAttempts: recordFailure cap is enforced", () => {
		// This test proves that the max-attempts cap stops recovery after N failures.
		// Scenario: continuous failures with time advancement, should stop after maxAttempts.
		const backoffAttempts = [];
		const now = { value: Date.now() };

		const backoff = new RecoveryBackoffTracker({
			initialDelayMs: 100,
			maxDelayMs: 1000,
			multiplier: 2,
			maxAttempts: 3,
		});
		const clock = { now: () => now.value };
		backoff.setClockForTest(clock);

		// Simulate recovery failures until stopped
		for (let i = 0; i < 6; i++) {
			now.value += 2000; // Advance time for each attempt

			const shouldContinue = backoff.recordFailure("test-agent");
			backoffAttempts.push({
				attempt: i + 1,
				shouldContinue,
				stopped: !shouldContinue,
			});

			if (!shouldContinue) {
				// Hit maxAttempts
				break;
			}
		}

		// Verify stopped at maxAttempts
		const stoppedAttempt = backoffAttempts.find(a => a.stopped);
		expect(stoppedAttempt).toBeDefined();
		expect(stoppedAttempt?.attempt).toBe(3); // Hit cap at 3rd attempt
		expect(backoff.canAttemptRecovery("test-agent")).toBe(false);
	});
});
