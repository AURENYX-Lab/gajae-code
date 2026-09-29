import { expect, spyOn, test } from "bun:test";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { Broker } from "../src/sdk/broker/broker";
import {
	deriveLifecycleDeadlines,
	setLifecycleCommandResolverForTest,
	setLifecycleTimingForTest,
} from "../src/sdk/broker/lifecycle";

test("broker pre-spawn bookkeeping does not spend child semantic readiness", async () => {
	const root = await fs.mkdtemp(path.join(process.env.TMPDIR ?? "/tmp", "gjc-prespawn-budget-"));
	const agentDir = path.join(root, "agent");
	const broker = new Broker({ agentDir });
	let now = 1_000_000;
	let spawnCount = 0;
	try {
		setLifecycleTimingForTest(broker, {
			now: () => now,
			sleep: async ms => {
				now += ms;
			},
		});
		setLifecycleCommandResolverForTest(broker, () => {
			spawnCount += 1;
			throw new Error("stop after spawn authorization");
		});
		await broker.start();
		const transition = broker.ledger.transition.bind(broker.ledger);
		const transitionSpy = spyOn(broker.ledger, "transition").mockImplementation(async (identity, state, fields) => {
			if (state === "effect_started" && fields?.effectIntent) now += 9_000;
			return transition(identity, state, fields);
		});
		try {
			const response = await broker.handleRequest(
				"session.create",
				{
					cwd: root,
					stateRoot: path.join(root, ".gjc", "state"),
					readinessTimeoutMs: 10_000,
				},
				"prespawn-budget",
			);
			expect(spawnCount).toBe(1);
			expect(response).toMatchObject({ ok: false, error: { code: "spawn_failed" } });
			const rows = (await fs.readFile(path.join(agentDir, "sdk", "lifecycle-ledger.jsonl"), "utf8"))
				.split("\n")
				.filter(Boolean)
				.map(line => JSON.parse(line) as Record<string, unknown>);
			const intent = rows.find(
				row =>
					(row.effectIntent as { lifecycleCleanupDeadlineAt?: number } | undefined)?.lifecycleCleanupDeadlineAt !==
					undefined,
			)?.effectIntent as { lifecycleCleanupDeadlineAt: number };
			expect(intent.lifecycleCleanupDeadlineAt).toBeGreaterThanOrEqual(
				deriveLifecycleDeadlines(now, 10_000).lifecycleCleanupDeadlineAt,
			);
		} finally {
			transitionSpy.mockRestore();
		}
	} finally {
		setLifecycleCommandResolverForTest(broker, undefined);
		setLifecycleTimingForTest(broker, undefined);
		await broker.stop();
		await fs.rm(root, { recursive: true, force: true });
	}
}, 20_000);

test("broker pre-spawn preparation has a bounded retryable timeout", async () => {
	const root = await fs.mkdtemp(path.join(process.env.TMPDIR ?? "/tmp", "gjc-prespawn-cap-"));
	const broker = new Broker({ agentDir: path.join(root, "agent") });
	let now = 1_000_000;
	let spawnCount = 0;
	try {
		setLifecycleTimingForTest(broker, {
			now: () => now,
			sleep: async ms => {
				now += ms;
			},
		});
		setLifecycleCommandResolverForTest(broker, () => {
			spawnCount += 1;
			throw new Error("unexpected spawn");
		});
		await broker.start();
		const transition = broker.ledger.transition.bind(broker.ledger);
		const transitionSpy = spyOn(broker.ledger, "transition").mockImplementation(async (identity, state, fields) => {
			if (state === "effect_started" && fields?.effectIntent) now += 31_000;
			return transition(identity, state, fields);
		});
		try {
			const response = await broker.handleRequest("session.create", { cwd: root }, "prespawn-cap");
			const message = response.ok ? "" : String(response.error.message);
			expect(spawnCount).toBe(0);
			expect(response).toMatchObject({
				ok: false,
				error: { code: "readiness_timeout", message: expect.stringContaining("pre-spawn preparation") },
			});
			expect(message).toContain("31000 ms");
		} finally {
			transitionSpy.mockRestore();
		}
	} finally {
		setLifecycleCommandResolverForTest(broker, undefined);
		setLifecycleTimingForTest(broker, undefined);
		await broker.stop();
		await fs.rm(root, { recursive: true, force: true });
	}
}, 20_000);

test("caller-supplied exact deadlines remain strict during pre-spawn bookkeeping", async () => {
	const root = await fs.mkdtemp(path.join(process.env.TMPDIR ?? "/tmp", "gjc-prespawn-exact-"));
	const broker = new Broker({ agentDir: path.join(root, "agent") });
	let now = 1_000_000;
	let spawnCount = 0;
	try {
		setLifecycleTimingForTest(broker, {
			now: () => now,
			sleep: async ms => {
				now += ms;
			},
		});
		setLifecycleCommandResolverForTest(broker, () => {
			spawnCount += 1;
			throw new Error("unexpected spawn");
		});
		await broker.start();
		const transition = broker.ledger.transition.bind(broker.ledger);
		const transitionSpy = spyOn(broker.ledger, "transition").mockImplementation(async (identity, state, fields) => {
			if (state === "effect_started" && fields?.effectIntent) now += 9_000;
			return transition(identity, state, fields);
		});
		try {
			const response = await broker.handleRequest(
				"session.create",
				{
					cwd: root,
					...deriveLifecycleDeadlines(now, 10_000),
				},
				"prespawn-exact",
			);
			expect(spawnCount).toBe(0);
			expect(response).toMatchObject({
				ok: false,
				error: { code: "readiness_timeout", message: expect.stringContaining("semantic readiness deadline") },
			});
		} finally {
			transitionSpy.mockRestore();
		}
	} finally {
		setLifecycleCommandResolverForTest(broker, undefined);
		setLifecycleTimingForTest(broker, undefined);
		await broker.stop();
		await fs.rm(root, { recursive: true, force: true });
	}
}, 20_000);
