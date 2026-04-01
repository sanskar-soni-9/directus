import type { Field } from '@directus/types';
import { useEventListener } from '@vueuse/core';
import { parsePartialJson } from 'ai';
import { computed, type ComputedRef, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import {
	buildAiTranslationPrompt,
	getAiTranslationFieldDescription,
	normalizeAiTranslatedFields,
} from './ai-translation';
import type { AppModelDefinition } from '@/ai/models';
import { useSettingsStore } from '@/stores/settings';
import { getRootPath } from '@/utils/get-root-path';

export type LangStatus = 'pending' | 'translating' | 'retrying' | 'done' | 'error';

export type LangStatusEntry = {
	status: LangStatus;
	fieldCount?: number;
	error?: string;
};

export type TranslationJobConfig = {
	sourceLanguage: string;
	selectedFields: string[];
	targetLanguages: string[];
	model: AppModelDefinition;
	sourceContent: Record<string, string>;
	fieldDefinitions: Field[];
};

export type LangFieldProgress = {
	fieldOrder: string[];
	activeField: string | null;
	queuedFields: string[];
	completedFields: string[];
};

const MAX_RETRIES = 3;

const EMPTY_FIELD_PROGRESS: LangFieldProgress = {
	fieldOrder: [],
	activeField: null,
	queuedFields: [],
	completedFields: [],
};

export function useTranslationJob(options: {
	applyTranslatedFields: (fields: Record<string, string>, lang: string | undefined) => void;
	languageOptions: ComputedRef<Record<string, any>[]>;
}) {
	const { t } = useI18n();
	const settingsStore = useSettingsStore();

	const jobState = ref<'idle' | 'translating' | 'complete'>('idle');
	const langStatuses = ref<Record<string, LangStatusEntry>>({});
	const cancelled = ref(false);
	const abortControllers = new Map<string, AbortController>();
	let currentRunId = 0;

	const fieldProgressByLang = ref<Record<string, LangFieldProgress>>({});

	let jobConfig: TranslationJobConfig | null = null;

	const isTranslating = computed(() => jobState.value === 'translating');

	const hasErrors = computed(() => Object.values(langStatuses.value).some((s) => s.status === 'error'));

	const completedCount = computed(
		() => Object.values(langStatuses.value).filter((s) => s.status === 'done' || s.status === 'error').length,
	);

	const translatedCount = computed(() => Object.values(langStatuses.value).filter((s) => s.status === 'done').length);

	const totalCount = computed(() => Object.keys(langStatuses.value).length);

	const progressPercent = computed(() =>
		totalCount.value > 0 ? Math.round((completedCount.value / totalCount.value) * 100) : 0,
	);

	const progressLabel = computed(() => `${completedCount.value}/${totalCount.value}`);

	const pendingLanguages = computed(() => {
		const pending = new Set<string>();

		for (const [lang, entry] of Object.entries(langStatuses.value)) {
			if (entry.status === 'pending' || entry.status === 'translating' || entry.status === 'retrying') {
				pending.add(lang);
			}
		}

		return pending;
	});

	const pendingFields = computed(() => {
		if (!jobConfig || jobState.value === 'idle') return new Set<string>();
		return new Set(jobConfig.selectedFields);
	});

	useEventListener(window, 'beforeunload', (event: BeforeUnloadEvent) => {
		if (isTranslating.value) {
			event.preventDefault();
		}
	});

	// Precomputed data shared across all languages in a job
	let jobShared: {
		selectedFieldDefinitions: Field[];
		outputSchema: Record<string, any>;
		langOptionsByCode: Map<string, Record<string, any>>;
		sourceLangName: string;
	} | null = null;

	function start(config: TranslationJobConfig) {
		// Cancel any prior job
		cancel();

		// Snapshot config
		jobConfig = { ...config };

		// Precompute shared data once for all languages
		const fieldsWithContent = Object.keys(config.sourceContent);
		const fieldDefsByName = new Map(config.fieldDefinitions.map((f) => [f.field, f]));

		const selectedFieldDefinitions = fieldsWithContent
			.map((fieldName) => fieldDefsByName.get(fieldName))
			.filter((field): field is Field => field !== undefined);

		const fieldProperties: Record<string, any> = {};

		for (const field of selectedFieldDefinitions) {
			fieldProperties[field.field] = {
				type: 'string',
				description: getAiTranslationFieldDescription(field),
			};
		}

		const langOptionsByCode = new Map(options.languageOptions.value.map((l) => [l.value, l]));

		jobShared = {
			selectedFieldDefinitions,
			outputSchema: {
				type: 'object',
				properties: fieldProperties,
				required: fieldsWithContent,
			},
			langOptionsByCode,
			sourceLangName: langOptionsByCode.get(config.sourceLanguage)?.text ?? config.sourceLanguage,
		};

		jobState.value = 'translating';
		cancelled.value = false;
		langStatuses.value = {};
		fieldProgressByLang.value = {};
		const runId = ++currentRunId;
		const fieldOrder = selectedFieldDefinitions.map((field) => field.field);

		// Init statuses for all targets
		for (const langCode of config.targetLanguages) {
			langStatuses.value[langCode] = { status: 'pending' };
			fieldProgressByLang.value[langCode] = createFieldProgress(fieldOrder);
		}

		// Fire all concurrently
		void Promise.allSettled(config.targetLanguages.map((langCode) => translateLanguage(langCode, 0, runId))).then(
			() => {
				if (!cancelled.value && runId === currentRunId) {
					jobState.value = 'complete';
				}
			},
		);
	}

	function cancel() {
		cancelled.value = true;

		for (const controller of abortControllers.values()) {
			controller.abort();
		}

		abortControllers.clear();
		langStatuses.value = {};
		fieldProgressByLang.value = {};
		jobState.value = 'idle';
	}

	function reset() {
		cancel();
		jobConfig = null;
		jobShared = null;
	}

	async function retry(langCode: string) {
		const fieldOrder =
			jobShared?.selectedFieldDefinitions.map((field) => field.field) ?? jobConfig?.selectedFields ?? [];

		fieldProgressByLang.value = {
			...fieldProgressByLang.value,
			[langCode]: createFieldProgress(fieldOrder),
		};

		jobState.value = 'translating';

		await translateLanguage(langCode);

		// Check if all done after retry
		const allDone = Object.values(langStatuses.value).every((s) => s.status === 'done' || s.status === 'error');

		if (allDone && !Object.values(langStatuses.value).some((s) => s.status === 'error')) {
			jobState.value = 'complete';
		}
	}

	async function translateLanguage(langCode: string, retryCount = 0, runId = currentRunId): Promise<void> {
		if (cancelled.value || runId !== currentRunId || !jobConfig || !jobShared) return;

		langStatuses.value[langCode] = { status: retryCount > 0 ? 'retrying' : 'translating' };

		const config = jobConfig;
		const { selectedFieldDefinitions, outputSchema, langOptionsByCode, sourceLangName } = jobShared;
		const langName = langOptionsByCode.get(langCode)?.text ?? langCode;

		const prompt = buildAiTranslationPrompt({
			sourceLangName,
			targetLangNames: [langName],
			sourceContent: config.sourceContent,
			fields: selectedFieldDefinitions,
			styleGuide: settingsStore.settings?.ai_translation_style_guide,
			glossary: settingsStore.settings?.ai_translation_glossary,
		});

		const abortController = new AbortController();
		abortControllers.set(langCode, abortController);

		try {
			const response = await fetch(`${getRootPath()}ai/object`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				credentials: 'include',
				signal: abortController.signal,
				body: JSON.stringify({
					provider: config.model.provider,
					model: config.model.model,
					prompt,
					outputSchema,
				}),
			});

			if (!response.ok) {
				const statusCode = response.status;

				abortControllers.delete(langCode);

				if (cancelled.value || runId !== currentRunId) return;

				// Rate limit — auto-retry with exponential backoff
				if (statusCode === 429 && retryCount < MAX_RETRIES) {
					const delay = Math.pow(2, retryCount) * 1000;
					langStatuses.value[langCode] = { status: 'retrying' };
					await new Promise((resolve) => setTimeout(resolve, delay));

					if (!cancelled.value && runId === currentRunId) {
						return translateLanguage(langCode, retryCount + 1, runId);
					}

					return;
				}

				let errorMessage = t('interfaces.translations.translation_error');

				try {
					const errorBody = await response.json();
					errorMessage = errorBody?.errors?.[0]?.message ?? errorMessage;
				} catch {
					// ignore parse errors
				}

				clearPendingFields(langCode);
				langStatuses.value[langCode] = { status: 'error', error: errorMessage };
				return;
			}

			// Stream the response text and parse partial JSON incrementally
			const reader = response.body?.getReader();

			if (!reader) {
				throw new Error('No response body');
			}

			const decoder = new TextDecoder();
			let jsonText = '';
			const appliedFields = new Set<string>();
			const streamedFieldValues = new Map<string, string>();

			while (true) {
				if (cancelled.value || runId !== currentRunId) {
					reader.cancel();
					break;
				}

				const { done, value } = await reader.read();

				if (value) {
					jsonText += decoder.decode(value, { stream: true });

					const { value: partialObject } = await parsePartialJson(jsonText);

					if (partialObject && typeof partialObject === 'object' && !Array.isArray(partialObject)) {
						const obj = partialObject as Record<string, unknown>;
						const receivedKeys = Object.keys(obj);
						const completedKeys = receivedKeys.slice(0, -1);
						const activeKey = receivedKeys[receivedKeys.length - 1];

						// Apply completed fields progressively (all except the last one, which may still be streaming)
						for (const key of completedKeys) {
							if (!appliedFields.has(key) && typeof obj[key] === 'string') {
								const normalized = normalizeAiTranslatedFields({ [key]: obj[key] as string }, selectedFieldDefinitions);

								options.applyTranslatedFields(normalized, langCode);
								streamedFieldValues.set(key, obj[key] as string);
								appliedFields.add(key);
							}
						}

						// Update the currently streaming field as the partial JSON grows.
						if (
							activeKey &&
							typeof obj[activeKey] === 'string' &&
							streamedFieldValues.get(activeKey) !== obj[activeKey]
						) {
							const normalized = normalizeAiTranslatedFields(
								{ [activeKey]: obj[activeKey] as string },
								selectedFieldDefinitions,
							);

							options.applyTranslatedFields(normalized, langCode);
							streamedFieldValues.set(activeKey, obj[activeKey] as string);
						}

						if (completedKeys.length > 0) {
							markFieldsCompleted(langCode, completedKeys);
						}
					}
				}

				if (done) {
					// Apply the final field
					const { value: finalObject } = await parsePartialJson(jsonText);

					if (finalObject && typeof finalObject === 'object' && !Array.isArray(finalObject)) {
						const obj = finalObject as Record<string, string>;

						for (const key of Object.keys(obj)) {
							if (typeof obj[key] === 'string' && streamedFieldValues.get(key) !== obj[key]) {
								const normalized = normalizeAiTranslatedFields({ [key]: obj[key] as string }, selectedFieldDefinitions);

								options.applyTranslatedFields(normalized, langCode);
								streamedFieldValues.set(key, obj[key] as string);
							}

							appliedFields.add(key);
						}

						markFieldsCompleted(langCode, Object.keys(obj));
					}

					break;
				}
			}

			abortControllers.delete(langCode);

			if (cancelled.value || runId !== currentRunId) return;

			langStatuses.value[langCode] = {
				status: 'done',
				fieldCount: appliedFields.size,
			};
		} catch (error: any) {
			abortControllers.delete(langCode);
			clearPendingFields(langCode);

			if (cancelled.value || runId !== currentRunId) return;
			if (error?.name === 'AbortError') return;

			const errorMessage = error?.message ?? t('interfaces.translations.translation_error');

			langStatuses.value[langCode] = {
				status: 'error',
				error: errorMessage,
			};
		}
	}

	function createFieldProgress(fieldOrder: string[]): LangFieldProgress {
		return {
			fieldOrder,
			activeField: fieldOrder[0] ?? null,
			queuedFields: fieldOrder.slice(1),
			completedFields: [],
		};
	}

	function markFieldsCompleted(langCode: string, fields: string[]) {
		const progress = fieldProgressByLang.value[langCode];

		if (!progress) return;

		const fieldOrderSet = new Set(progress.fieldOrder);
		const completedSet = new Set(progress.completedFields);

		for (const field of fields) {
			if (fieldOrderSet.has(field)) {
				completedSet.add(field);
			}
		}

		const completedFields = progress.fieldOrder.filter((field) => completedSet.has(field));
		const remainingFields = progress.fieldOrder.filter((field) => !completedSet.has(field));
		const activeField = remainingFields[0] ?? null;

		fieldProgressByLang.value = {
			...fieldProgressByLang.value,
			[langCode]: {
				...progress,
				activeField,
				queuedFields: activeField ? remainingFields.slice(1) : [],
				completedFields,
			},
		};
	}

	function clearPendingFields(langCode: string) {
		const progress = fieldProgressByLang.value[langCode];

		if (!progress) return;

		fieldProgressByLang.value = {
			...fieldProgressByLang.value,
			[langCode]: {
				...progress,
				activeField: null,
				queuedFields: [],
			},
		};
	}

	function getFieldProgress(langCode: string | undefined): LangFieldProgress {
		if (!langCode) return EMPTY_FIELD_PROGRESS;
		return fieldProgressByLang.value[langCode] ?? EMPTY_FIELD_PROGRESS;
	}

	function getActiveField(langCode: string | undefined): string | null {
		return getFieldProgress(langCode).activeField;
	}

	function getQueuedFields(langCode: string | undefined): string[] {
		return getFieldProgress(langCode).queuedFields;
	}

	function getCompletedFields(langCode: string | undefined): string[] {
		return getFieldProgress(langCode).completedFields;
	}

	return {
		jobState,
		langStatuses,
		isTranslating,
		hasErrors,
		completedCount,
		translatedCount,
		totalCount,
		progressPercent,
		progressLabel,
		pendingLanguages,
		pendingFields,
		fieldProgressByLang,
		getFieldProgress,
		getActiveField,
		getQueuedFields,
		getCompletedFields,
		applyTranslatedFields: options.applyTranslatedFields,
		start,
		cancel,
		retry,
		reset,
	};
}

export type TranslationJob = ReturnType<typeof useTranslationJob>;
