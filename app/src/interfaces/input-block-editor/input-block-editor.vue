<script setup lang="ts">
import EditorJS from '@editorjs/editorjs';
import { isEqual } from 'lodash';
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue';
import { useRouter } from 'vue-router';
import { useBus } from './bus';
import { sanitizeValue } from './sanitize';
import getTools from './tools';
import { useFileHandler } from './use-file-handler';
import api from '@/api';
import VDrawer from '@/components/v-drawer.vue';
import VUpload from '@/components/v-upload.vue';
import { parseGlobalMimeTypeAllowList } from '@/composables/use-mime-type-filter';
import { useCollectionsStore } from '@/stores/collections';
import { useServerStore } from '@/stores/server';
import { unexpectedError } from '@/utils/unexpected-error';

import './editorjs-overrides.css';

const props = withDefaults(
	defineProps<{
		disabled?: boolean;
		nonEditable?: boolean;
		autofocus?: boolean;
		value?: Record<string, any> | null;
		bordered?: boolean;
		placeholder?: string;
		tools?: string[];
		folder?: string;
		font?: 'sans-serif' | 'monospace' | 'serif';
	}>(),
	{
		value: null,
		bordered: true,
		tools: () => ['header', 'nestedlist', 'code', 'image', 'paragraph', 'checklist', 'quote', 'underline'],
		font: 'sans-serif',
	},
);

const bus = useBus();

const emit = defineEmits<{ input: [value: EditorJS.OutputData | null] }>();

const collectionStore = useCollectionsStore();
const { info } = useServerStore();
const allowedMimeTypes = computed(() => parseGlobalMimeTypeAllowList(info.files?.mimeTypeAllowList)?.join(','));

const { currentPreview, setCurrentPreview, fileHandler, setFileHandler, unsetFileHandler, handleFile } =
	useFileHandler();

const editorjsRef = ref<EditorJS>();
const editorjsIsReady = ref(false);
const uploaderComponentElement = ref<HTMLElement>();
const editorElement = ref<HTMLElement>();
const haveFilesAccess = Boolean(collectionStore.getCollection('directus_files'));
const haveValuesChanged = ref(false);
const isRendering = ref(false); // suppresses onChange → emitValue during programmatic renders
const emitGeneration = ref(0); // discards out-of-order saver.save() results
let pendingRender: ReturnType<typeof sanitizeValue> | undefined = undefined; // value queued while a render is in progress
const router = useRouter();

const tools = getTools(
	{
		baseURL: api.defaults.baseURL,
		setFileHandler,
		setCurrentPreview,
		getUploadFieldElement: () => uploaderComponentElement,
	},
	props.tools,
	haveFilesAccess,
);

bus.on(async (event) => {
	if (event.type === 'open-url') {
		router.push(event.payload);
	}
});

onMounted(async () => {
	editorjsRef.value = new EditorJS({
		logLevel: 'ERROR' as EditorJS.LogLevels,
		holder: editorElement.value,
		readOnly: false,
		placeholder: props.placeholder,
		minHeight: 72,
		onChange: (api) => emitValue(api),
		tools: tools,
	});

	await editorjsRef.value.isReady;

	const sanitizedValue = sanitizeValue(props.value);

	if (sanitizedValue) {
		isRendering.value = true;

		try {
			await editorjsRef.value.render(sanitizedValue);
		} finally {
			await nextTick();
			isRendering.value = false;
		}
	}

	if (props.autofocus) {
		editorjsRef.value.focus();
	}

	editorjsIsReady.value = true;
});

onUnmounted(() => {
	editorjsRef.value?.destroy?.();
	bus.reset();
});

watch(
	[editorjsIsReady, () => props.disabled],
	async ([isReady, isDisabled]) => {
		if (!isReady) return;

		// Note: EditorJS must be ready before readOnly is toggled; otherwise, the content won't render, which could result in data loss!
		await nextTick();
		// Instance may be mid-teardown/recreate; `readOnly` is not always present yet.
		editorjsRef.value?.readOnly?.toggle?.(isDisabled);
	},
	{ immediate: true },
);

watch(
	() => props.value,
	async (newVal, oldVal) => {
		// First value will be set in 'onMounted'
		if (!editorjsRef.value || !editorjsIsReady.value) return;

		// During refresh, item is temporarily null and the field is disabled — skip to avoid clearing the editor
		if (newVal === null && props.disabled) return;

		if (haveValuesChanged.value) {
			haveValuesChanged.value = false;
			return;
		}

		if (isEqual(newVal?.blocks, oldVal?.blocks)) return;

		const sanitizedValue = sanitizeValue(newVal);

		if (isRendering.value) {
			pendingRender = sanitizedValue;
			return;
		}

		await renderValue(sanitizedValue);
	},
);

async function renderValue(sanitizedValue: ReturnType<typeof sanitizeValue>) {
	try {
		isRendering.value = true;

		await nextTick();

		if (!editorElement.value) return;

		// Destroy and rebuild the editor instead of calling render() on the same instance.
		// Repeated render() calls (especially after save-and-stay / relation refetches) can
		// leave duplicate blocks in the DOM even though the saved JSON is correct.
		editorjsRef.value?.destroy?.();
		editorjsRef.value = undefined;

		// Use a local variable — reading `editorjsRef.value` after an await can return
		// a stale/different instance if another async watcher execution ran concurrently.
		const editor = new EditorJS({
			logLevel: 'ERROR' as EditorJS.LogLevels,
			holder: editorElement.value!,
			readOnly: false,
			placeholder: props.placeholder,
			minHeight: 72,
			onChange: (api) => emitValue(api),
			tools: tools,
		});

		await editor.isReady;
		await nextTick();

		editorjsRef.value = editor;

		if (sanitizedValue) {
			await editor.render(sanitizedValue);
		} else {
			await editor.clear();
		}

		// Sync readOnly — the disabled watcher may have fired while editorjsRef was undefined
		await nextTick();
		editor.readOnly?.toggle?.(props.disabled);
	} catch (error) {
		unexpectedError(error);
	} finally {
		await nextTick();
		isRendering.value = false;

		if (pendingRender !== undefined) {
			const next = pendingRender;
			pendingRender = undefined;
			await renderValue(next);
		}
	}
}

async function emitValue(context: EditorJS.API | EditorJS) {
	if (props.disabled || isRendering.value || !context || !context.saver) return;

	const generation = ++emitGeneration.value;

	try {
		const result = await context.saver.save();

		if (generation !== emitGeneration.value) return;

		if (!result || result.blocks.length < 1) {
			haveValuesChanged.value = true;
			emit('input', null);
			return;
		}

		if (isEqual(result.blocks, props.value?.blocks)) return;

		haveValuesChanged.value = true;
		emit('input', result);
	} catch (error) {
		unexpectedError(error);
	}
}

const menuActive = computed(() => fileHandler.value !== null);
</script>

<template>
	<div v-prevent-focusout="menuActive" class="input-block-editor">
		<div
			ref="editorElement"
			class="editor"
			:class="{ [font]: true, disabled, 'non-editable': nonEditable, bordered }"
		></div>

		<VDrawer
			v-if="haveFilesAccess && !disabled"
			:model-value="fileHandler !== null"
			icon="image"
			:title="$t('upload_from_device')"
			cancelable
			@update:model-value="unsetFileHandler"
			@cancel="unsetFileHandler"
		>
			<div class="uploader-drawer-content">
				<div v-if="currentPreview" class="uploader-preview-image">
					<img :src="currentPreview" />
				</div>
				<VUpload
					:ref="uploaderComponentElement"
					:multiple="false"
					:folder="folder"
					from-library
					from-url
					:accept="allowedMimeTypes"
					@input="handleFile"
				/>
			</div>
		</VDrawer>
	</div>
</template>

<style lang="scss" scoped>
.btn--default {
	color: #fff !important;
	background-color: #0d6efd;
	border-color: #0d6efd;
}

.btn--gray {
	color: #fff !important;
	background-color: #7c7c7c;
	border-color: #7c7c7c;
}

.input-block-editor .editor {
	border-radius: var(--theme--border-radius);
	padding: var(--theme--form--field--input--padding)
		max(1.8125rem, calc(var(--theme--form--field--input--padding) + 0.875rem));
}

.disabled {
	pointer-events: none;

	&:not(.non-editable) {
		color: var(--theme--form--field--input--foreground-subdued);
		background-color: var(--theme--form--field--input--background-subdued);
		border-color: var(--theme--form--field--input--border-color);
	}
}

.bordered {
	border: var(--theme--border-width) solid var(--theme--form--field--input--border-color);

	&:not(.disabled) {
		background-color: var(--theme--form--field--input--background);

		&:hover {
			border-color: var(--theme--form--field--input--border-color-hover);
		}

		&:focus-within {
			border-color: var(--theme--form--field--input--border-color-focus);
		}
	}
}

.monospace {
	font-family: var(--theme--fonts--monospace--font-family);
}

.serif {
	font-family: var(--theme--fonts--serif--font-family);
}

.sans-serif {
	font-family: var(--theme--fonts--sans--font-family);
}

.uploader-drawer-content {
	padding: var(--content-padding);
	padding-block-end: var(--content-padding);
}

.uploader-preview-image {
	margin-block-end: var(--theme--form--row-gap);
	background-color: var(--theme--background-normal);
	border-radius: var(--theme--border-radius);
}

.uploader-preview-image img {
	display: block;
	inline-size: auto;
	max-inline-size: 100%;
	block-size: auto;
	max-block-size: 40vh;
	margin: 0 auto;
	object-fit: contain;
}
</style>
