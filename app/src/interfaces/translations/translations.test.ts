import { mount } from '@vue/test-utils';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { ref } from 'vue';
import Translations from './translations.vue';

const {
	createMock,
	updateMock,
	removeMock,
	state,
} = vi.hoisted(() => ({
	createMock: vi.fn(),
	updateMock: vi.fn(),
	removeMock: vi.fn(),
	state: {
		itemsLoading: false,
		displayItems: [] as any[],
		fetchedItems: [] as any[],
		relationInfo: {
			junctionField: { field: 'languages_id' },
			relatedPrimaryKeyField: { field: 'code' },
			junctionPrimaryKeyField: { field: 'id' },
			reverseJunctionField: { field: 'posts_id' },
			junctionCollection: { collection: 'posts_translations' },
			relatedCollection: { collection: 'languages', meta: {} },
		},
	},
}));

vi.mock('./translation-form.vue', () => ({
	default: {
		name: 'TranslationFormStub',
		props: ['updateValue'],
		template: `<button data-testid="trigger-update" @click="updateValue(undefined, 'en')">Trigger</button>`,
	},
}));

vi.mock('@/composables/use-relation-m2m', () => ({
	useRelationM2M: () => ({
		relationInfo: ref(state.relationInfo),
	}),
}));

vi.mock('@/composables/use-relation-multiple', () => ({
	useRelationMultiple: () => ({
		create: createMock,
		update: updateMock,
		remove: removeMock,
		isLocalItem: () => false,
		displayItems: ref(state.displayItems),
		loading: ref(state.itemsLoading),
		fetchedItems: ref(state.fetchedItems),
		getItemEdits: (item: Record<string, any>) => item,
	}),
}));

vi.mock('@/stores/fields', () => ({
	useFieldsStore: () => ({
		getFieldsForCollection: () => [],
		getField: () => ({ field: 'code' }),
	}),
}));

vi.mock('@/composables/use-window-size', () => ({
	useWindowSize: () => ({
		width: ref(1400),
	}),
}));

vi.mock('@/utils/fetch-all', () => ({
	fetchAll: vi.fn().mockResolvedValue([{ code: 'en' }]),
}));

vi.mock('vue-i18n', async (importOriginal) => {
	const actual = await importOriginal<typeof import('vue-i18n')>();

	return {
		...actual,
		useI18n: () => ({
			locale: ref('en'),
		}),
	};
});

vi.mock('@/composables/use-nested-validation', () => ({
	useInjectNestedValidation: () => ({
		updateNestedValidationErrors: vi.fn(),
	}),
}));

vi.mock('@/utils/validate-item', () => ({
	validateItem: () => [],
}));

describe('translations', () => {
	beforeEach(() => {
		createMock.mockReset();
		updateMock.mockReset();
		removeMock.mockReset();
		state.displayItems = [];
		state.fetchedItems = [];
		state.itemsLoading = false;
	});

	afterEach(() => {
		vi.clearAllMocks();
	});

	test('does not create translations while relation items are still loading', async () => {
		state.itemsLoading = true;

		const wrapper = mount(Translations, {
			props: {
				collection: 'posts',
				field: 'translations',
				primaryKey: 1,
				version: null,
			},
			global: {
				directives: { tooltip: {} },
				stubs: { VIcon: true },
			},
		});

		await wrapper.find('[data-testid="trigger-update"]').trigger('click');

		expect(createMock).not.toHaveBeenCalled();
		expect(updateMock).not.toHaveBeenCalled();
	});

	test('creates translation when relation items finished loading and language is missing', async () => {
		state.itemsLoading = false;

		const wrapper = mount(Translations, {
			props: {
				collection: 'posts',
				field: 'translations',
				primaryKey: 1,
				version: null,
			},
			global: {
				directives: { tooltip: {} },
				stubs: { VIcon: true },
			},
		});

		await wrapper.find('[data-testid="trigger-update"]').trigger('click');

		expect(createMock).toHaveBeenCalledTimes(1);

		expect(createMock).toHaveBeenCalledWith({
			languages_id: {
				code: 'en',
			},
		});
	});
});
