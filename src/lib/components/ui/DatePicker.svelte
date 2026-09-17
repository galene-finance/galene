<script lang="ts">
	import { DatePicker as BitsDatePicker } from 'bits-ui';
	import { CalendarDate, type DateValue } from '@internationalized/date';

	let {
		value = $bindable(''),
		name = '',
		placeholder = 'Select date',
		class: className = '',
		required = false,
		disabled = false
	}: {
		value?: string;
		name?: string;
		placeholder?: string;
		class?: string;
		required?: boolean;
		disabled?: boolean;
	} = $props();

	const pad = (n: number) => String(n).padStart(2, '0');
	const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

	function toISO(d: DateValue | undefined): string {
		if (!d) return '';
		return `${d.year}-${pad(d.month)}-${pad(d.day)}`;
	}

	// Friendly, locale-independent display for the trigger (deterministic for SSR).
	function formatDisplay(iso: string): string {
		const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
		if (!m) return iso;
		return `${MONTHS[Number(m[2]) - 1]} ${Number(m[3])}, ${m[1]}`;
	}

	// Internal DateValue kept in sync with the ISO string `value`. Only replaced
	// when the actual date changes, so bits-ui isn't handed a new object
	// reference (and re-rendered) for the same date.
	let dateValue = $state<DateValue | undefined>(undefined);

	$effect(() => {
		const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
		if (m) {
			const y = Number(m[1]);
			const mo = Number(m[2]);
			const d = Number(m[3]);
			const cur = dateValue;
			if (!cur || cur.year !== y || cur.month !== mo || cur.day !== d) {
				dateValue = new CalendarDate(y, mo, d);
			}
		} else if (dateValue) {
			dateValue = undefined;
		}
	});

	function onValueChange(d: DateValue | undefined) {
		dateValue = d;
		value = toISO(d);
	}

	let open = $state(false);

	const display = $derived(value ? formatDisplay(value) : '');
</script>

<BitsDatePicker.Root
	value={dateValue}
	bind:open
	{required}
	{disabled}
	granularity="day"
	{onValueChange}
>
	<BitsDatePicker.Trigger
		class="flex h-9 w-full items-center justify-between gap-2 rounded-md border border-input bg-surface px-3 text-sm focus:border-ring focus:outline-none focus:ring-2 focus:ring-ring/30 disabled:cursor-not-allowed disabled:opacity-50 {className}"
	>
		<span class={value ? '' : 'text-muted-foreground'}>{display || placeholder}</span>
		<svg
			class="size-4 shrink-0 text-muted-foreground"
			viewBox="0 0 24 24"
			fill="none"
			stroke="currentColor"
			stroke-width="2"
			stroke-linecap="round"
			stroke-linejoin="round"
			aria-hidden="true"
		>
			<rect x="3" y="4" width="18" height="18" rx="2" />
			<path d="M16 2v4M8 2v4M3 10h18" />
		</svg>
	</BitsDatePicker.Trigger>
	<BitsDatePicker.Content class="z-50 w-72 rounded-md border border-border bg-surface p-3 shadow-md" sideOffset={4}>
		<BitsDatePicker.Calendar>
			{#snippet children({ months, weekdays })}
				{#each months as month (month.value)}
					<div class="flex flex-col gap-3">
						<BitsDatePicker.Header class="mb-1 flex items-center justify-between">
							<BitsDatePicker.PrevButton
								class="flex size-8 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground"
							>
								<svg class="size-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">
									<path d="m15 18-6-6 6-6" />
								</svg>
							</BitsDatePicker.PrevButton>
							<BitsDatePicker.Heading class="text-sm font-medium" />
							<BitsDatePicker.NextButton
								class="flex size-8 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground"
							>
								<svg class="size-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">
									<path d="m9 18 6-6-6-6" />
								</svg>
							</BitsDatePicker.NextButton>
						</BitsDatePicker.Header>
						<BitsDatePicker.Grid class="w-full table-fixed border-collapse">
							<BitsDatePicker.GridHead>
								{#each weekdays as day}
									<BitsDatePicker.HeadCell class="px-1 py-1.5 text-center text-xs font-medium text-muted-foreground">
										{day}
									</BitsDatePicker.HeadCell>
								{/each}
							</BitsDatePicker.GridHead>
							<BitsDatePicker.GridBody>
								{#each month.weeks as week}
									<BitsDatePicker.GridRow>
										{#each week as day}
											<BitsDatePicker.Cell date={day} month={month.value} class="p-0.5 text-center">
												<BitsDatePicker.Day
													class="inline-flex size-8 cursor-pointer items-center justify-center rounded-md text-sm hover:bg-muted data-[selected]:bg-primary data-[selected]:text-primary-foreground data-[selected]:hover:bg-primary data-[outside-month]:text-muted-foreground/50 data-[today]:font-semibold data-[disabled]:pointer-events-none data-[disabled]:opacity-40"
												/>
											</BitsDatePicker.Cell>
										{/each}
									</BitsDatePicker.GridRow>
								{/each}
							</BitsDatePicker.GridBody>
						</BitsDatePicker.Grid>
					</div>
				{/each}
			{/snippet}
		</BitsDatePicker.Calendar>
	</BitsDatePicker.Content>
</BitsDatePicker.Root>
{#if name}
	<input type="hidden" {name} bind:value />
{/if}
