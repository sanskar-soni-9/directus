import { describe, expect, test } from 'vitest';
import {
	type AIModelSettings,
	getAvailableAiProviders,
	getAvailableModels,
	getModelKey,
	getProviderLabel,
	resolveModelByKey,
} from './available-models';

function createSettings(overrides: Partial<AIModelSettings> = {}): AIModelSettings {
	return {
		ai_openai_api_key: null,
		ai_anthropic_api_key: null,
		ai_google_api_key: null,
		ai_openai_compatible_api_key: null,
		ai_openai_compatible_base_url: null,
		ai_openai_compatible_models: null,
		ai_openai_allowed_models: null,
		ai_anthropic_allowed_models: null,
		ai_google_allowed_models: null,
		...overrides,
	};
}

describe('available-models', () => {
	test('derives available providers from configured settings', () => {
		const settings = createSettings({
			ai_openai_api_key: 'openai-key',
			ai_google_api_key: 'google-key',
			ai_openai_compatible_api_key: 'custom-key',
			ai_openai_compatible_base_url: 'http://localhost:11434/v1',
		});

		expect(getAvailableAiProviders(settings)).toEqual(['openai', 'google', 'openai-compatible']);
	});

	test('returns only enabled and allowed standard models', () => {
		const settings = createSettings({
			ai_openai_api_key: 'openai-key',
			ai_openai_allowed_models: ['gpt-5', 'gpt-5-nano'],
			ai_anthropic_allowed_models: ['claude-sonnet-4-5'],
		});

		const models = getAvailableModels(settings);

		expect(models.map((model) => getModelKey(model))).toEqual(['openai:gpt-5-nano', 'openai:gpt-5']);
	});

	test('includes configured openai-compatible models when provider is enabled', () => {
		const settings = createSettings({
			ai_openai_compatible_api_key: 'custom-key',
			ai_openai_compatible_base_url: 'http://localhost:11434/v1',
			ai_openai_compatible_models: [
				{
					id: 'llama-3.3-70b',
					name: 'Llama 3.3 70B',
					context: 131072,
					output: 8192,
					attachment: false,
				},
			],
		});

		const models = getAvailableModels(settings);

		expect(models.map((model) => getModelKey(model))).toEqual(['openai-compatible:llama-3.3-70b']);
	});

	test('adds unknown allowed model ids as custom definitions', () => {
		const settings = createSettings({
			ai_google_api_key: 'google-key',
			ai_google_allowed_models: ['gemini-2.5-pro', 'gemini-9-pro-experimental'],
		});

		const models = getAvailableModels(settings);

		expect(models.map((model) => getModelKey(model))).toEqual([
			'google:gemini-2.5-pro',
			'google:gemini-9-pro-experimental',
		]);

		expect(models[1]?.name).toBe('gemini-9-pro-experimental');
	});

	test('resolves model keys and supports model ids containing colons', () => {
		const models = [
			{ provider: 'openai', model: 'gpt-5', name: 'GPT-5' },
			{ provider: 'openai-compatible', model: 'gpt-oss:20b', name: 'GPT OSS 20B' },
		] as const;

		expect(resolveModelByKey('openai:gpt-5', models)).toEqual(models[0]);
		expect(resolveModelByKey('openai-compatible:gpt-oss:20b', models)).toEqual(models[1]);
		expect(resolveModelByKey('invalid', models)).toBeNull();
	});

	test('returns provider labels for settings dropdowns', () => {
		expect(getProviderLabel('openai')).toBe('OpenAI');
		expect(getProviderLabel('anthropic')).toBe('Anthropic');
		expect(getProviderLabel('google')).toBe('Google');
		expect(getProviderLabel('openai-compatible')).toBe('Custom');
	});
});
