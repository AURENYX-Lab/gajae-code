import * as fs from "node:fs/promises";
import * as path from "node:path";

const EVIDENCE_STREAMS = ["transcript.jsonl", "requests.jsonl", "tools.jsonl", "events.jsonl"] as const;
const NORMALIZED_ID = "<id>";
const NORMALIZED_TIMESTAMP = "<timestamp>";
const NORMALIZED_PID = "<pid>";

/** Explicit volatility rules. Transcript and request payload content stays compared unless a rule below names it. */
export const NORMALIZATION_ALLOWLIST = [
	{ field: "session, entry, tool-call, message, response, job, and compaction entry IDs", reason: "Runtime-generated identities differ between isolated runs." },
	{ field: "timestamp/time fields", reason: "Wall-clock timestamps differ between otherwise identical runs." },
	{ field: "pid fields", reason: "Operating-system process identifiers differ between runs." },
	{ field: "*duration* fields", reason: "Elapsed execution time differs between repeated workload runs." },
	{ field: "promptPrefix.hash", reason: "This hash covers full messages including generated IDs and timestamps; message payloads remain compared separately." },
	{ field: "absolute temporary-root paths", reason: "Each isolated run uses a distinct temporary filesystem root." },
	{ field: "task-completion notice duration and job ID tokens", reason: "The system-generated task notice embeds elapsed time and job identity in text; its remaining content is preserved." },
	{ field: "session transcript filenames beneath the isolated root", reason: "Session files embed a generated timestamp and session UUID in their basename." },
	{ field: "host date and local clock in the per-turn project-context reminder", reason: "The reminder renders the wall-clock minute, so runs that straddle a minute boundary differ; the surrounding reminder text stays compared." },
] as const;

function idField(key: string, objectType: string | undefined, isSessionEntry: boolean): boolean {
	const normalized = key.replaceAll("_", "").toLowerCase();
	if (
		[
			"sessionid",
			"entryid",
			"toolcallid",
			"messageid",
			"responseid",
			"parentid",
			"jobid",
			"compactionentryid",
			"firstkeptentryid",
		].includes(normalized)
	) {
		return true;
	}
	if (normalized !== "id") return false;
	return isSessionEntry || objectType === "session" || objectType === "message" || objectType === "toolcall";
}

function timestampField(key: string): boolean {
	return ["timestamp", "time", "createdat", "updatedat", "startedat", "endedat", "evictedat", "t"].includes(
		key.replaceAll("_", "").toLowerCase(),
	);
}

function pidField(key: string): boolean {
	return ["pid", "parentpid", "processid"].includes(key.replaceAll("_", "").toLowerCase());
}

function durationField(key: string): boolean {
	return key.replaceAll("_", "").toLowerCase().includes("duration");
}

function normalizeTaskCompletionNotice(value: string): string {
	if (!value.includes("<system-notice>") || !value.includes("<task-summary>")) return value;
	return value
		.replace(/(Background job )[^ ]+( has completed)/gu, "$1<job-id>$2")
		.replace(/(<agent id=")[^"]+(" agent=)/gu, "$1<job-id>$2")
		.replace(/(<synopsis ref="agent:\/\/)[^"]+("\s*\/?>)/gu, "$1<job-id>$2")
		.replace(/(<header>[^<]*\[)[0-9]+(?:\.[0-9]+)?(?:ms|s)(\]<\/header>)/gu, "$1<duration>$2");
}

function normalizeHostWallClock(value: string): string {
	if (!value.includes("the local time is")) return value;
	return value.replace(
		/(Today is )[^,\n]+(, the local time is )[^,\n]+(, and the current working directory is )/gu,
		"$1<date>$2<local-time>$3",
	);
}

function replaceRootPath(value: string, tempRoot: string): string {
	const escaped = tempRoot.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
	const rooted = value.replace(new RegExp(`${escaped}(?=$|[/\\\\])`, "gu"), "<root>");
	// The session basename includes a generated timestamp and UUID beneath the isolated root.
	return rooted.replace(/(<root>[/\\]sessions[/\\])[^/\\]+/gu, "$1<session>");
}

/** Normalize only explicit identity, time, pid, temporary-root, and derived-hash volatility. */
export function normalizeEvidenceValue(value: unknown, tempRoot: string, parentType?: string): unknown {
	if (typeof value === "string")
		return normalizeHostWallClock(normalizeTaskCompletionNotice(replaceRootPath(value, path.resolve(tempRoot))));
	if (Array.isArray(value)) return value.map(item => normalizeEvidenceValue(item, tempRoot, parentType));
	if (value === null || typeof value !== "object") return value;

	const record = value as Record<string, unknown>;
	const objectType = typeof record.type === "string" ? record.type.toLowerCase() : parentType;
	const normalized: Record<string, unknown> = {};
	for (const [key, item] of Object.entries(record)) {
		if (idField(key, objectType, "parentId" in record)) normalized[key] = item === undefined ? item : NORMALIZED_ID;
		else if (timestampField(key)) normalized[key] = item === undefined ? item : NORMALIZED_TIMESTAMP;
		else if (pidField(key)) normalized[key] = item === undefined ? item : NORMALIZED_PID;
		else if (durationField(key)) normalized[key] = item === undefined ? item : NORMALIZED_TIMESTAMP;
		else if (key === "hash" && objectType === "promptprefix") normalized[key] = item === undefined ? item : "<hash>";
		else normalized[key] = normalizeEvidenceValue(item, tempRoot, key === "promptPrefix" ? "promptprefix" : objectType);
	}
	return normalized;
}

async function readNormalizedLines(directory: string, stream: (typeof EVIDENCE_STREAMS)[number]): Promise<unknown[]> {
	const file = Bun.file(path.join(directory, stream));
	if (!(await file.exists())) throw new Error(`Missing evidence stream ${path.join(directory, stream)}`);
	const contents = await file.text();
	const tempRoot = await fs.realpath(path.resolve(directory, ".."));
	return contents
		.split("\n")
		.filter(line => line.length > 0)
		.map(line => normalizeEvidenceValue(JSON.parse(line) as unknown, tempRoot));
}

function collectDiffs(left: unknown, right: unknown, currentPath: string, diffs: string[]): void {
	if (Object.is(left, right)) return;
	if (Array.isArray(left) && Array.isArray(right)) {
		if (left.length !== right.length) diffs.push(`${currentPath}.length`);
		const length = Math.max(left.length, right.length);
		for (let index = 0; index < length; index += 1) {
			if (index >= left.length || index >= right.length) diffs.push(`${currentPath}[${index}]`);
			else collectDiffs(left[index], right[index], `${currentPath}[${index}]`, diffs);
		}
		return;
	}
	if (left !== null && right !== null && typeof left === "object" && typeof right === "object") {
		const leftRecord = left as Record<string, unknown>;
		const rightRecord = right as Record<string, unknown>;
		const keys = [...new Set([...Object.keys(leftRecord), ...Object.keys(rightRecord)])].sort();
		for (const key of keys) {
			if (!(key in leftRecord) || !(key in rightRecord)) diffs.push(`${currentPath}.${key}`);
			else collectDiffs(leftRecord[key], rightRecord[key], `${currentPath}.${key}`, diffs);
		}
		return;
	}
	diffs.push(currentPath);
}

/** Compare normalized transcript, request, tool, and event streams. Timing metrics are preserved in their own file but excluded from fidelity equality. */
export async function compareEvidence(
	dirA: string,
	dirB: string,
): Promise<{ equal: boolean; diffs: string[] }> {
	const diffs: string[] = [];
	for (const stream of EVIDENCE_STREAMS) {
		let left: unknown[];
		let right: unknown[];
		try {
			[left, right] = await Promise.all([readNormalizedLines(dirA, stream), readNormalizedLines(dirB, stream)]);
		} catch (error) {
			diffs.push(`${stream}: ${error instanceof Error ? error.message : String(error)}`);
			continue;
		}
		collectDiffs(left, right, stream, diffs);
	}
	return { equal: diffs.length === 0, diffs };
}
