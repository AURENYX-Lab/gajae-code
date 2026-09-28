import { describe, expect, it } from "bun:test";
import { createHmac } from "node:crypto";
import type { Process as NativeProcess } from "@gajae-code/natives";
import {
	authenticateOwnershipRecord,
	extendOwnedDarwinAncestry,
	parseOwnershipRecord,
	retainOwnedProcess,
} from "../src/exec/bash-shell-guardian";

/**
 * Tests for bash-shell-guardian ownership tracking and Darwin ancestry tracking.
 */
describe("bash-shell-guardian", () => {
	describe("parseOwnershipRecord", () => {
		it("parses valid ownership records", () => {
			const record = parseOwnershipRecord(
				JSON.stringify({
					pid: 1234,
					incarnation: "uuid-abc",
					darwinUniqueId: "9876543210",
					signature: "abcd1234",
				}),
			);
			expect(record).toEqual({
				pid: 1234,
				incarnation: "uuid-abc",
				darwinUniqueId: "9876543210",
				signature: "abcd1234",
			});
		});

		it("parses records without darwinUniqueId (incarnation-only)", () => {
			const record = parseOwnershipRecord(
				JSON.stringify({
					pid: 1234,
					incarnation: "uuid-abc",
					signature: "abcd1234",
				}),
			);
			expect(record).toEqual({
				pid: 1234,
				incarnation: "uuid-abc",
				signature: "abcd1234",
			});
		});

		it("rejects invalid JSON", () => {
			expect(parseOwnershipRecord("not json")).toBeUndefined();
		});

		it("rejects records with missing required fields", () => {
			expect(
				parseOwnershipRecord(
					JSON.stringify({
						pid: 1234,
						// missing incarnation
						signature: "abcd1234",
					}),
				),
			).toBeUndefined();
		});

		it("rejects records with invalid darwinUniqueId (non-numeric)", () => {
			expect(
				parseOwnershipRecord(
					JSON.stringify({
						pid: 1234,
						incarnation: "uuid-abc",
						darwinUniqueId: "not-a-number",
						signature: "abcd1234",
					}),
				),
			).toBeUndefined();
		});
	});

	describe("authenticateOwnershipRecord", () => {
		const token = "ledger-token";
		const sign = (pid: number, incarnation: string, uniqueId: string) =>
			createHmac("sha256", token).update(`${pid}:${incarnation}:${uniqueId}`).digest("hex");

		it("authenticates an incarnation-only record on every platform", () => {
			const line = JSON.stringify({ pid: 1234, incarnation: "uuid-abc", signature: sign(1234, "uuid-abc", "") });
			const authenticated = authenticateOwnershipRecord(line, token);
			expect(authenticated).toBeDefined();
			expect(authenticated?.darwinUniqueId).toBeUndefined();
		});

		it("binds the Darwin unique id into the signature", () => {
			const signature = sign(1234, "uuid-abc", "");
			const forged = JSON.stringify({ pid: 1234, incarnation: "uuid-abc", darwinUniqueId: "42", signature });
			expect(authenticateOwnershipRecord(forged, token)).toBeUndefined();

			const line = JSON.stringify({
				pid: 1234,
				incarnation: "uuid-abc",
				darwinUniqueId: "42",
				signature: sign(1234, "uuid-abc", "42"),
			});
			expect(authenticateOwnershipRecord(line, token)?.darwinUniqueId).toBe(42n);
		});
	});

	describe("retainOwnedProcess", () => {
		it("retains a process by pid:incarnation key", () => {
			const owned = new Map<string, Partial<NativeProcess>>();
			const processRef: Partial<NativeProcess> = { pid: 1234, incarnation: "uuid-abc" };
			const result = retainOwnedProcess(owned, processRef as any);
			expect(result).toBe(true);
			expect(owned.get("1234:uuid-abc")).toBe(processRef);
		});

		it("returns false if process pid matches guardian pid", () => {
			const owned = new Map<string, Partial<NativeProcess>>();
			const processRef: Partial<NativeProcess> = { pid: process.pid, incarnation: "uuid-abc" };
			const result = retainOwnedProcess(owned, processRef as any);
			expect(result).toBe(false);
			expect(owned.size).toBe(0);
		});

		it("allows overwriting process with same key", () => {
			const owned = new Map<string, Partial<NativeProcess>>();
			const processRef1: Partial<NativeProcess> = { pid: 1234, incarnation: "uuid-abc" };
			const processRef2: Partial<NativeProcess> = { pid: 1234, incarnation: "uuid-abc" };
			retainOwnedProcess(owned, processRef1 as any);
			retainOwnedProcess(owned, processRef2 as any);
			expect(owned.size).toBe(1);
			expect(owned.get("1234:uuid-abc")).toBe(processRef2);
		});
	});

	describe("extendOwnedDarwinAncestry", () => {
		it("extends ancestry chain using parent-child relationships", () => {
			const knownUniqueIds = new Set<bigint>([BigInt(100)]);
			const candidates = new Map<number, { uniqueId: bigint; parentUniqueId: bigint }>([
				[1001, { uniqueId: BigInt(101), parentUniqueId: BigInt(100) }],
				[1002, { uniqueId: BigInt(102), parentUniqueId: BigInt(101) }],
				[1003, { uniqueId: BigInt(103), parentUniqueId: BigInt(200) }], // unrelated
			]);
			const added = extendOwnedDarwinAncestry(knownUniqueIds, candidates);
			expect(added).toEqual([1001, 1002]);
			expect(knownUniqueIds).toEqual(new Set([BigInt(100), BigInt(101), BigInt(102)]));
		});

		it("handles empty candidates", () => {
			const knownUniqueIds = new Set<bigint>([BigInt(100)]);
			const candidates = new Map<number, { uniqueId: bigint; parentUniqueId: bigint }>();
			const added = extendOwnedDarwinAncestry(knownUniqueIds, candidates);
			expect(added).toEqual([]);
		});

		it("returns empty array if no candidates match known IDs", () => {
			const knownUniqueIds = new Set<bigint>([BigInt(100)]);
			const candidates = new Map<number, { uniqueId: bigint; parentUniqueId: bigint }>([
				[1001, { uniqueId: BigInt(200), parentUniqueId: BigInt(201) }],
			]);
			const added = extendOwnedDarwinAncestry(knownUniqueIds, candidates);
			expect(added).toEqual([]);
		});
	});

	describe("Darwin ancestry tracker (with mocked uniqueIdentity)", () => {
		it("retains incarnation-only records when uniqueIdentity returns undefined via track()", () => {
			// Import the tracker after the mock is set up
			const { createDarwinAncestryTracker } = require("../src/exec/bash-shell-guardian");

			// Mock uniqueIdentity to return undefined for all pids
			const mockUniqueIdentity = (): undefined => undefined;

			const owned = new Map<string, Partial<NativeProcess>>();
			const tracker = createDarwinAncestryTracker(owned, mockUniqueIdentity);

			if (!tracker) {
				// On non-Darwin platforms, createDarwinAncestryTracker returns undefined
				// This is expected behavior
				expect(true).toBe(true);
				return;
			}

			// With uniqueIdentity returning undefined and no signedUniqueId,
			// track() should still return true and retain the process
			const processRef: Partial<NativeProcess> = { pid: 12345, incarnation: "test-incarnation" };
			const result = tracker.track(processRef as any);

			// The process should be retained
			expect(owned.get("12345:test-incarnation")).toBe(processRef);

			// This is the key behavior change: track() returns true even without unique id
			expect(result).toBe(true);

			tracker.close();
		});

		it("requires unique id for trackGuardian() - returns false when uniqueIdentity returns undefined", () => {
			const { createDarwinAncestryTracker } = require("../src/exec/bash-shell-guardian");

			// Mock uniqueIdentity to return undefined for all pids
			const mockUniqueIdentity = (): undefined => undefined;

			const owned = new Map<string, Partial<NativeProcess>>();
			const tracker = createDarwinAncestryTracker(owned, mockUniqueIdentity);

			if (!tracker) {
				// On non-Darwin platforms, createDarwinAncestryTracker returns undefined
				expect(true).toBe(true);
				return;
			}

			// trackGuardian is strict: it should return false when no unique id is available
			const processRef: Partial<NativeProcess> = { pid: 12345, incarnation: "test-incarnation" };
			const result = tracker.trackGuardian(processRef as any);

			// The process should NOT be retained because guardian registration is strict
			expect(owned.size).toBe(0);

			// trackGuardian() returns false, making guardian registration fail as expected
			expect(result).toBe(false);

			tracker.close();
		});

		it("trackGuardian succeeds when signedUniqueId is provided", () => {
			const { createDarwinAncestryTracker } = require("../src/exec/bash-shell-guardian");

			// Mock uniqueIdentity to return undefined for all pids
			const mockUniqueIdentity = (): undefined => undefined;

			const owned = new Map<string, Partial<NativeProcess>>();
			const tracker = createDarwinAncestryTracker(owned, mockUniqueIdentity);

			if (!tracker) {
				expect(true).toBe(true);
				return;
			}

			// With a signedUniqueId provided, trackGuardian should succeed
			const processRef: Partial<NativeProcess> = { pid: 12345, incarnation: "test-incarnation" };
			const result = tracker.trackGuardian(processRef as any, BigInt(999));

			// The process should be retained
			expect(owned.get("12345:test-incarnation")).toBe(processRef);

			// trackGuardian succeeds when given a signed unique id
			expect(result).toBe(true);

			tracker.close();
		});
	});
});
