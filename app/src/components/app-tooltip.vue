<script setup lang="ts">
import { TooltipContent, TooltipPortal, TooltipRoot, TooltipTrigger } from 'reka-ui';
import { useGlobalTooltip } from '@/composables/use-global-tooltip';

const { state, closeTooltip } = useGlobalTooltip();
</script>

<template>
	<TooltipRoot :open="state.open" @update:open="(v) => !v && closeTooltip()">
		<TooltipTrigger as="span" :reference="state.virtualRef" aria-hidden="true" :tabindex="-1" style="display: none" />
		<TooltipPortal>
			<TooltipContent
				id="app-tooltip-content"
				:side="state.side"
				:align="state.align"
				:side-offset="8"
				class="tooltip"
				:class="{ inverted: state.inverted, monospace: state.monospace }"
			>
				{{ state.content }}
			</TooltipContent>
		</TooltipPortal>
	</TooltipRoot>
</template>
