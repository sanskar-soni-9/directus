import { createPinia, setActivePinia } from 'pinia';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { type Ref, ref } from 'vue';
import { useSidebarStore } from './sidebar';

const storageRefs = new Map<string, Ref>();

vi.mock('@vueuse/core', async () => {
	const actual = await vi.importActual<typeof import('@vueuse/core')>('@vueuse/core');

	return {
		...actual,
		useLocalStorage: (key: string, defaultValue: unknown) => {
			const r = ref(defaultValue);
			storageRefs.set(key, r);
			return r;
		},
	};
});

beforeEach(() => {
	storageRefs.clear();
	setActivePinia(createPinia());
});

afterEach(() => {
	vi.restoreAllMocks();
});

describe('sidebar store size guard', () => {
	it('returns default size on init', () => {
		const store = useSidebarStore();
		expect(store.size).toBe(333);
	});

	it('accepts finite values', () => {
		const store = useSidebarStore();
		store.size = 400;
		expect(store.size).toBe(400);
	});

	it('rejects NaN and returns default', () => {
		const store = useSidebarStore();
		store.size = NaN;
		expect(store.size).toBe(333);
	});

	it('rejects Infinity and returns default', () => {
		const store = useSidebarStore();
		store.size = Infinity;
		expect(store.size).toBe(333);
	});

	it('rejects -Infinity and returns default', () => {
		const store = useSidebarStore();
		store.size = -Infinity;
		expect(store.size).toBe(333);
	});

	it('preserves last valid value after rejected write', () => {
		const store = useSidebarStore();
		store.size = 500;
		store.size = NaN;
		expect(store.size).toBe(500);
	});

	it('self-heals corrupted stored value back to default', () => {
		const store = useSidebarStore();
		const storedSize = storageRefs.get('sidebar-size')!;

		storedSize.value = NaN;
		expect(store.size).toBe(333);
		expect(storedSize.value).toBe(333);
	});
});

describe('sidebar store enforce-default on expand', () => {
	it('returns default size when expanding after stored size is below min', () => {
		const store = useSidebarStore();
		const storedSize = storageRefs.get('sidebar-size')!;

		storedSize.value = 54; // collapsed-size written during drag-to-collapse
		store.collapse();
		store.expand();

		expect(store.size).toBe(333);
	});

	it('returns default size when expanding after stored size equals min', () => {
		const store = useSidebarStore();
		const storedSize = storageRefs.get('sidebar-size')!;

		storedSize.value = 252;
		store.collapse();
		store.expand();

		expect(store.size).toBe(333);
	});

	it('preserves stored size when expanding if stored size is above min', () => {
		const store = useSidebarStore();
		const storedSize = storageRefs.get('sidebar-size')!;

		storedSize.value = 400;
		store.collapse();
		store.expand();

		expect(store.size).toBe(400);
	});

	it('clears enforce-default once size is dragged above min after expand', () => {
		const store = useSidebarStore();
		const storedSize = storageRefs.get('sidebar-size')!;

		storedSize.value = 54;
		store.collapse();
		store.expand();
		expect(store.size).toBe(333); // enforce-default active

		store.size = 300; // user drags above MIN_SIZE (252)
		storedSize.value = 300;
		expect(store.size).toBe(300); // enforce-default cleared
	});

	it('does not enforce default on collapse', () => {
		const store = useSidebarStore();
		const storedSize = storageRefs.get('sidebar-size')!;

		storedSize.value = 400;
		store.collapse();

		expect(store.size).toBe(400);
	});
});
