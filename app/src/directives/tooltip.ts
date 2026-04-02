import type { Directive, DirectiveBinding } from 'vue';
import { useGlobalTooltip } from '@/composables/use-global-tooltip';

export function isDisabled(element: HTMLElement): boolean {
	return (
		element.hasAttribute('disabled') ||
		element.getAttribute('aria-disabled') === 'true' ||
		element.querySelector(':scope > :disabled, :scope > [aria-disabled="true"]') !== null
	);
}

export function resolveSide(binding: DirectiveBinding): 'top' | 'bottom' | 'left' | 'right' {
	if (binding.modifiers['bottom'] || binding.arg === 'bottom') return 'bottom';
	if (binding.modifiers['left'] || binding.arg === 'left') return 'left';
	if (binding.modifiers['right'] || binding.arg === 'right') return 'right';
	return 'top';
}

export function resolveAlign(binding: DirectiveBinding): 'start' | 'center' | 'end' {
	if (binding.modifiers['start']) return 'start';
	if (binding.modifiers['end']) return 'end';
	return 'center';
}

interface TooltipHandlers {
	enter: () => void;
	leave: () => void;
}

const handlerMap = new WeakMap<HTMLElement, TooltipHandlers>();

function beforeMount(element: HTMLElement, binding: DirectiveBinding): void {
	if (!binding.value) return;

	const { openTooltip, closeTooltip } = useGlobalTooltip();
	const virtualRef = { getBoundingClientRect: () => element.getBoundingClientRect() };

	const enter = () => {
		let delayDuration = 500;
		if (binding.modifiers['instant']) delayDuration = 0;
		else if (isDisabled(element)) delayDuration = 125;

		openTooltip({
			content: binding.value,
			side: resolveSide(binding),
			align: resolveAlign(binding),
			inverted: !!binding.modifiers['inverted'],
			monospace: !!binding.modifiers['monospace'],
			delayDuration,
			virtualRef,
		});
	};

	const leave = () => {
		closeTooltip();
	};

	handlerMap.set(element, { enter, leave });
	element.addEventListener('mouseenter', enter);
	element.addEventListener('mouseleave', leave);
	element.setAttribute('aria-describedby', 'app-tooltip-content');
}

function unmounted(element: HTMLElement): void {
	const handlers = handlerMap.get(element);

	if (handlers) {
		element.removeEventListener('mouseenter', handlers.enter);
		element.removeEventListener('mouseleave', handlers.leave);
		handlerMap.delete(element);
		element.removeAttribute('aria-describedby');
		const { closeTooltip } = useGlobalTooltip();
		closeTooltip();
	}
}

const Tooltip: Directive = {
	beforeMount,
	unmounted,
	updated(element, binding) {
		if (binding.value === binding.oldValue) return;
		unmounted(element);

		if (binding.value) {
			beforeMount(element, binding);
		}
	},
};

export default Tooltip;
