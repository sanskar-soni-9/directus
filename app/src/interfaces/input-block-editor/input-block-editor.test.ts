import EditorJS from '@editorjs/editorjs';
import { flushPromises, mount } from '@vue/test-utils';
import { describe, expect, test, vi } from 'vitest';
import InputBlockEditor from './input-block-editor.vue';

vi.mock('@editorjs/editorjs', () => ({ default: vi.fn() }));
vi.mock('./tools', () => ({ default: () => ({}) }));
vi.mock('@/api', () => ({ default: { defaults: { baseURL: '' } } }));
vi.mock('@/stores/collections', () => ({ useCollectionsStore: () => ({ getCollection: () => false }) }));
vi.mock('@/stores/server', () => ({ useServerStore: () => ({ info: {} }) }));
vi.mock('vue-router', () => ({ useRouter: () => ({ push: vi.fn() }) }));
vi.mock('@/utils/unexpected-error', () => ({ unexpectedError: vi.fn() }));

describe('InputBlockEditor', () => {
	test('should discard stale emitValue results when saves resolve out of order', async () => {
		let onChangeHandler: ((api: EditorJS.API | EditorJS) => void) | undefined;
		const saveResolvers: Array<(value: any) => void> = [];

		const save = vi.fn(
			() =>
				new Promise((resolve) => {
					saveResolvers.push(resolve);
				}),
		);

		const editorInstance = {
			isReady: Promise.resolve(),
			render: vi.fn().mockResolvedValue(undefined),
			clear: vi.fn(),
			destroy: vi.fn(),
			focus: vi.fn(),
			on: vi.fn(),
			saver: { save },
			readOnly: { toggle: vi.fn() },
		} as any;

		vi.mocked(EditorJS).mockImplementation((options: any) => {
			onChangeHandler = options.onChange;
			return editorInstance;
		});

		const wrapper = mount(InputBlockEditor, {
			props: { value: null },
			global: {
				directives: { 'prevent-focusout': {} },
				stubs: { VDrawer: true, VUpload: true },
			},
		});

		await flushPromises();
		expect(onChangeHandler).toBeDefined();

		onChangeHandler!(editorInstance);
		onChangeHandler!(editorInstance);
		expect(save).toHaveBeenCalledTimes(2);

		saveResolvers[1]?.({
			blocks: [{ type: 'paragraph', data: { text: 'newer' } }],
		});

		await flushPromises();

		saveResolvers[0]?.({
			blocks: [{ type: 'paragraph', data: { text: 'older' } }],
		});

		await flushPromises();

		expect(wrapper.emitted('input')).toEqual([
			[
				{
					blocks: [{ type: 'paragraph', data: { text: 'newer' } }],
				},
			],
		]);

		wrapper.unmount();
	});

	test('should destroy and recreate the editor when value blocks change', async () => {
		const created: any[] = [];

		vi.mocked(EditorJS).mockImplementation(() => {
			const inst = {
				isReady: Promise.resolve(),
				render: vi.fn().mockResolvedValue(undefined),
				clear: vi.fn().mockResolvedValue(undefined),
				destroy: vi.fn(),
				focus: vi.fn(),
				on: vi.fn(),
				saver: { save: vi.fn().mockResolvedValue({ blocks: [] }) },
				readOnly: { toggle: vi.fn() },
			} as any;

			created.push(inst);
			return inst;
		});

		const wrapper = mount(InputBlockEditor, {
			props: {
				disabled: false,
				value: { blocks: [{ type: 'paragraph', data: { text: 'initial' } }] },
			},
			global: {
				directives: { 'prevent-focusout': {} },
				stubs: { VDrawer: true, VUpload: true },
			},
		});

		await flushPromises();
		expect(created).toHaveLength(1);

		await wrapper.setProps({
			value: { blocks: [{ type: 'paragraph', data: { text: 'updated' } }] },
		});

		await flushPromises();

		expect(created[0]!.destroy).toHaveBeenCalled();
		expect(created).toHaveLength(2);

		expect(created[1]!.render).toHaveBeenCalledWith(
			expect.objectContaining({
				blocks: [{ type: 'paragraph', data: { text: 'updated' } }],
			}),
		);

		wrapper.unmount();
	});

	test('should apply a value queued in pendingRender after the current renderValue completes', async () => {
		const created: any[] = [];
		let resolveBlockedRender!: () => void;

		vi.mocked(EditorJS).mockImplementation(() => {
			const isBlockedInstance = created.length === 1; // second instance (first-update render) blocks

			const inst = {
				isReady: Promise.resolve(),
				render: vi.fn().mockImplementation(async () => {
					if (isBlockedInstance) {
						await new Promise<void>((r) => (resolveBlockedRender = r));
					}
				}),
				clear: vi.fn().mockResolvedValue(undefined),
				destroy: vi.fn(),
				focus: vi.fn(),
				on: vi.fn(),
				saver: { save: vi.fn().mockResolvedValue({ blocks: [] }) },
				readOnly: { toggle: vi.fn() },
			} as any;

			created.push(inst);
			return inst;
		});

		const wrapper = mount(InputBlockEditor, {
			props: { value: { blocks: [{ type: 'paragraph', data: { text: 'initial' } }] } },
			global: {
				directives: { 'prevent-focusout': {} },
				stubs: { VDrawer: true, VUpload: true },
			},
		});

		await flushPromises();
		expect(created).toHaveLength(1);

		// Trigger a render — second EditorJS instance will be created, render() blocks
		wrapper.setProps({ value: { blocks: [{ type: 'paragraph', data: { text: 'first-update' } }] } });
		await flushPromises();
		expect(created).toHaveLength(2); // second instance created, render blocked

		// Second update arrives while first renderValue is still in progress → goes to pendingRender
		wrapper.setProps({ value: { blocks: [{ type: 'paragraph', data: { text: 'queued-update' } }] } });
		await flushPromises();
		expect(created).toHaveLength(2); // no new instance yet, still blocked

		// Unblock the blocked render → pendingRender should be drained → third instance created
		resolveBlockedRender!();
		await flushPromises();

		expect(created).toHaveLength(3);

		expect(created[2]!.render).toHaveBeenCalledWith(
			expect.objectContaining({
				blocks: [{ type: 'paragraph', data: { text: 'queued-update' } }],
			}),
		);

		wrapper.unmount();
	});

	test('should not clear content when value becomes null while disabled', async () => {
		const clear = vi.fn();

		vi.mocked(EditorJS).mockImplementation(
			() =>
				({
					isReady: Promise.resolve(),
					render: vi.fn().mockResolvedValue(undefined),
					clear,
					destroy: vi.fn(),
					focus: vi.fn(),
					on: vi.fn(),
					saver: { save: vi.fn().mockResolvedValue({ blocks: [] }) },
					readOnly: { toggle: vi.fn() },
				}) as any,
		);

		const wrapper = mount(InputBlockEditor, {
			props: {
				disabled: false,
				value: { blocks: [{ type: 'paragraph', data: { text: 'initial' } }] },
			},
			global: {
				directives: { 'prevent-focusout': {} },
				stubs: { VDrawer: true, VUpload: true },
			},
		});

		await flushPromises();

		await wrapper.setProps({ disabled: true });
		await flushPromises();

		await wrapper.setProps({ value: null });
		await flushPromises();

		// clear() must not be called — the watcher exits early when value is null and disabled is true
		expect(clear).not.toHaveBeenCalled();

		wrapper.unmount();
	});

	test('should not block external value updates after a no-op onChange (haveValuesChanged fix)', async () => {
		let onChangeHandler: ((api: EditorJS.API | EditorJS) => void) | undefined;

		const save = vi.fn().mockResolvedValue({
			blocks: [{ type: 'paragraph', data: { text: 'current' } }],
		});

		const created: any[] = [];

		vi.mocked(EditorJS).mockImplementation((options: any) => {
			onChangeHandler = options.onChange;

			const inst = {
				isReady: Promise.resolve(),
				render: vi.fn().mockResolvedValue(undefined),
				clear: vi.fn(),
				destroy: vi.fn(),
				focus: vi.fn(),
				on: vi.fn(),
				saver: { save },
				readOnly: { toggle: vi.fn() },
			} as any;

			created.push(inst);
			return inst;
		});

		const wrapper = mount(InputBlockEditor, {
			props: { value: { blocks: [{ type: 'paragraph', data: { text: 'current' } }] } },
			global: {
				directives: { 'prevent-focusout': {} },
				stubs: { VDrawer: true, VUpload: true },
			},
		});

		await flushPromises();

		// onChange fires but save() returns content equal to props.value → isEqual bails, no emit.
		// Previously this set haveValuesChanged=true which blocked the next real update.
		onChangeHandler!(created[0]!);
		await flushPromises();
		expect(wrapper.emitted('input')).toBeUndefined();

		const instancesBefore = created.length;

		// A real external update should NOT be blocked
		await wrapper.setProps({
			value: { blocks: [{ type: 'paragraph', data: { text: 'from-server' } }] },
		});

		await flushPromises();

		// Destroy/recreate should have happened — exactly one new instance
		expect(created.length).toBe(instancesBefore + 1);

		wrapper.unmount();
	});

	test('should ignore emits triggered during programmatic render (isRendering guard)', async () => {
		let onChangeHandler: ((api: EditorJS.API | EditorJS) => void) | undefined;

		const save = vi.fn().mockResolvedValue({
			blocks: [{ type: 'paragraph', data: { text: 'stale-during-render' } }],
		});

		const editorInstance = {
			isReady: Promise.resolve(),
			render: vi.fn(async () => {
				onChangeHandler?.(editorInstance as any);
			}),
			clear: vi.fn(),
			destroy: vi.fn(),
			focus: vi.fn(),
			on: vi.fn(),
			saver: { save },
			readOnly: { toggle: vi.fn() },
		} as any;

		vi.mocked(EditorJS).mockImplementation((options: any) => {
			onChangeHandler = options.onChange;
			return editorInstance;
		});

		const wrapper = mount(InputBlockEditor, {
			props: {
				disabled: false,
				value: { blocks: [{ type: 'paragraph', data: { text: 'initial' } }] },
			},
			global: {
				directives: { 'prevent-focusout': {} },
				stubs: { VDrawer: true, VUpload: true },
			},
		});

		await flushPromises();

		await wrapper.setProps({
			value: { blocks: [{ type: 'paragraph', data: { text: 'server-refresh' } }] },
		});

		await flushPromises();

		expect(save).not.toHaveBeenCalled();
		expect(wrapper.emitted('input')).toBeUndefined();

		wrapper.unmount();
	});

	test('should skip re-render when parent echoes back the same blocks we just emitted', async () => {
		let onChangeHandler: ((api: EditorJS.API | EditorJS) => void) | undefined;
		const userBlocks = [{ type: 'paragraph', data: { text: 'typed' } }];

		const created: any[] = [];

		vi.mocked(EditorJS).mockImplementation((options: any) => {
			onChangeHandler = options.onChange;

			const inst = {
				isReady: Promise.resolve(),
				render: vi.fn().mockResolvedValue(undefined),
				clear: vi.fn(),
				destroy: vi.fn(),
				focus: vi.fn(),
				on: vi.fn(),
				saver: { save: vi.fn().mockResolvedValue({ blocks: userBlocks }) },
				readOnly: { toggle: vi.fn() },
			} as any;

			created.push(inst);
			return inst;
		});

		const wrapper = mount(InputBlockEditor, {
			props: { value: null },
			global: {
				directives: { 'prevent-focusout': {} },
				stubs: { VDrawer: true, VUpload: true },
			},
		});

		await flushPromises();

		// User types something — we emit
		onChangeHandler!(created[0]!);
		await flushPromises();
		expect(wrapper.emitted('input')).toHaveLength(1);

		const instancesBefore = created.length;

		// Parent echoes back the exact same blocks — haveValuesChanged should skip re-render
		await wrapper.setProps({ value: { blocks: userBlocks } });
		await flushPromises();

		// No new editor instance should have been created (no destroy/recreate)
		expect(created.length).toBe(instancesBefore);

		wrapper.unmount();
	});
});
