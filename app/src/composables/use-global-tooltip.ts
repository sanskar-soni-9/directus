import type { ReferenceElement } from 'reka-ui';
import { reactive } from 'vue';

export interface TooltipPayload {
	content: string;
	side: 'top' | 'bottom' | 'left' | 'right';
	align: 'start' | 'center' | 'end';
	inverted: boolean;
	monospace: boolean;
	delayDuration: number;
	virtualRef: ReferenceElement | null;
}

interface TooltipState extends TooltipPayload {
	open: boolean;
}

const state = reactive<TooltipState>({
	open: false,
	content: '',
	side: 'top',
	align: 'center',
	inverted: false,
	monospace: false,
	delayDuration: 500,
	virtualRef: null,
});

let timer: ReturnType<typeof setTimeout> | null = null;

function openTooltip(payload: TooltipPayload): void {
	if (timer) clearTimeout(timer);

	timer = setTimeout(() => {
		Object.assign(state, payload);
		state.open = true;
	}, payload.delayDuration);
}

function closeTooltip(): void {
	if (timer) clearTimeout(timer);
	timer = null;
	state.open = false;
}

export function useGlobalTooltip() {
	return { state, openTooltip, closeTooltip };
}
