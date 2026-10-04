import { describe, expect, test } from "bun:test";
import { decidePreflight, type PreflightAdapter, type PreflightCheckName } from "../bench/multisession/preflight";

const HOST = { pid: 4242, incarnation: "darwin:1:2" };

function fakeAdapter(overrides: Partial<PreflightAdapter> = {}): PreflightAdapter & { calls: string[] } {
	const calls: string[] = [];
	const adapter: PreflightAdapter = {
		startHost: async () => {
			calls.push("startHost");
			return HOST;
		},
		waitFirstDisposed: async () => {
			calls.push("waitFirstDisposed");
			return { survivorStreaming: true, survivorDisposed: false };
		},
		closeSession: async index => {
			calls.push(`close:${index}`);
		},
		waitSurvivor: async () => {
			calls.push("waitSurvivor");
			return { ok: true };
		},
		hostIdentity: () => ({ status: "present", incarnation: HOST.incarnation }),
		shutdown: async () => {
			calls.push("shutdown");
		},
		orphanCheck: () => ({ owned: [], unresolved: [] }),
		workerEvidence: () => ["/w/0", "/w/1"],
		standaloneEvidence: async () => ["/s/0", "/s/1"],
		compare: async () => ({ equal: true, diffs: [] }),
		abort: () => {
			calls.push("abort");
		},
		...overrides,
	};
	return Object.assign(adapter, { calls });
}

function failed(checks: Array<{ name: PreflightCheckName; passed: boolean }>): PreflightCheckName[] {
	return checks.filter(check => !check.passed).map(check => check.name);
}

describe("bench multisession preflight decision", () => {
	test("all checks pass and session 0 is closed before the survivor is awaited", async () => {
		const adapter = fakeAdapter();
		const outcome = await decidePreflight(adapter);
		expect(outcome.result).toBe("pass");
		expect(failed(outcome.checks)).toEqual([]);
		expect(adapter.calls.indexOf("close:0")).toBeLessThan(adapter.calls.indexOf("waitSurvivor"));
		expect(outcome.checks.map((check): string => check.name).sort()).toEqual(
			[
				"close-barrier",
				"fidelity",
				"host-identity-unchanged",
				"host-started",
				"survivor-completed",
				"zero-orphans",
			].sort(),
		);
	});

	test("a survivor that fails yields survivor-completed and skips the fidelity comparison", async () => {
		let compared = false;
		const outcome = await decidePreflight(
			fakeAdapter({
				waitSurvivor: async () => ({ ok: false, error: "native crash" }),
				compare: async () => {
					compared = true;
					return { equal: true, diffs: [] };
				},
			}),
		);
		expect(outcome.result).toBe("fail");
		expect(failed(outcome.checks)).toEqual(["survivor-completed", "fidelity"]);
		expect(outcome.checks.find(check => check.name === "survivor-completed")?.detail).toBe("native crash");
		expect(compared).toBe(false);
	});

	test("a fidelity mismatch fails only the fidelity check and names the session", async () => {
		const outcome = await decidePreflight(
			fakeAdapter({
				compare: async a =>
					a === "/w/1" ? { equal: false, diffs: ["tools.jsonl:3 result differs"] } : { equal: true, diffs: [] },
			}),
		);
		expect(outcome.result).toBe("fail");
		expect(failed(outcome.checks)).toEqual(["fidelity"]);
		expect(outcome.checks.find(check => check.name === "fidelity")?.detail).toContain("session 1: tools.jsonl:3");
	});

	test("missing evidence for a session is a fidelity failure, not a pass", async () => {
		const outcome = await decidePreflight(fakeAdapter({ workerEvidence: () => ["/w/0", ""] }));
		expect(failed(outcome.checks)).toEqual(["fidelity"]);
	});

	test("host death or replacement fails host-identity-unchanged", async () => {
		const died = await decidePreflight(fakeAdapter({ hostIdentity: () => ({ status: "absent" }) }));
		expect(failed(died.checks)).toEqual(["host-identity-unchanged"]);
		const replaced = await decidePreflight(
			fakeAdapter({ hostIdentity: () => ({ status: "present", incarnation: "darwin:9:9" }) }),
		);
		expect(failed(replaced.checks)).toEqual(["host-identity-unchanged"]);
	});

	test("an owned or unresolved process after shutdown fails zero-orphans", async () => {
		const owned = await decidePreflight(fakeAdapter({ orphanCheck: () => ({ owned: [777], unresolved: [] }) }));
		expect(failed(owned.checks)).toEqual(["zero-orphans"]);
		expect(owned.checks.find(check => check.name === "zero-orphans")?.detail).toContain("777");
		const unresolved = await decidePreflight(fakeAdapter({ orphanCheck: () => ({ owned: [], unresolved: [778] }) }));
		expect(failed(unresolved.checks)).toEqual(["zero-orphans"]);
	});

	test("a survivor that already finished when session 0 disposed fails the close barrier", async () => {
		const outcome = await decidePreflight(
			fakeAdapter({ waitFirstDisposed: async () => ({ survivorStreaming: true, survivorDisposed: true }) }),
		);
		expect(failed(outcome.checks)).toEqual(["close-barrier"]);
	});

	test("a host that never starts aborts and fails without later checks", async () => {
		const adapter = fakeAdapter({
			startHost: async () => {
				throw new Error("spawn failed");
			},
		});
		const outcome = await decidePreflight(adapter);
		expect(outcome.result).toBe("fail");
		expect(outcome.checks).toEqual([{ name: "host-started", passed: false, detail: "Error: spawn failed" }]);
		expect(adapter.calls).toContain("abort");
	});
});
