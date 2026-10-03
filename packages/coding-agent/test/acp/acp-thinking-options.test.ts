import { expect, test } from "bun:test";
import { acpSessionStateFromConfig } from "../../src/modes/acp/acp-agent";

function config(model: string, thinking: string = "off"): unknown {
	return {
		result: {
			page: {
				items: [
					{ id: "model", value: model },
					{ id: "thinking", value: thinking },
				],
				complete: true,
			},
		},
	};
}

function catalog(model: string, validLevels: string[]): unknown {
	const [provider, id] = model.split("/", 2);
	return {
		result: {
			page: {
				items: [{ provider, id, name: id, thinking: { validLevels } }],
				complete: true,
			},
		},
	};
}

test("advertises only off for a non-reasoning model", () => {
	const state = acpSessionStateFromConfig(config("test/off-model"), catalog("test/off-model", ["off"]));
	const thinking = state.configOptions.find(option => option.id === "thinking");

	expect(thinking?.options).toEqual([{ value: "off", name: "off" }]);
});

test("advertises the model catalog thinking levels in order", () => {
	const levels = ["off", "minimal", "low", "medium", "high"];
	const state = acpSessionStateFromConfig(config("test/reasoning-model"), catalog("test/reasoning-model", levels));
	const thinking = state.configOptions.find(option => option.id === "thinking");

	expect(thinking?.options).toEqual(levels.map(value => ({ value, name: value })));
});

test("does not advertise an unsupported thinking level", () => {
	const state = acpSessionStateFromConfig(config("test/off-model"), catalog("test/off-model", ["off"]));
	const thinking = state.configOptions.find(option => option.id === "thinking");

	expect(thinking?.options.map(option => option.value)).not.toContain("high");
});
