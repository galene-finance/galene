<script lang="ts">
 export type BadgeTone = 'neutral' | 'positive' | 'attention' | 'negative' | 'movement';
 let { label, value, tone = 'neutral' }: { label: string; value?: string; tone?: BadgeTone } = $props();
 const symbols: Record<BadgeTone, string> = { neutral: '•', positive: '✓', attention: '!', negative: '!', movement: '↔' };
</script>

<span class="financial-badge" data-tone={tone}>
 <span class="badge-symbol" aria-hidden="true">{symbols[tone]}</span>
 <span class="badge-content">{#if value !== undefined}<strong>{value}</strong>{/if}<span>{label}</span></span>
</span>

<style>
 .financial-badge{display:inline-flex;align-items:center;justify-content:center;gap:7px;border-radius:999px;padding:7px 12px;max-width:100%;background:var(--pill-neutral-fill);color:var(--pill-neutral-ink);vertical-align:middle;line-height:1.25}
 .badge-symbol{font-size:14px;font-weight:750;flex:none}
 .badge-content{display:flex;flex-direction:column;gap:2px;min-width:0;text-align:center}
 .badge-content strong{font-size:14px;font-weight:700;font-variant-numeric:tabular-nums;white-space:nowrap}
 .badge-content>span{font-size:11px;font-weight:600;overflow-wrap:anywhere}
 [data-tone="positive"]{background:var(--pill-positive-fill);color:var(--pill-positive-ink)}
 [data-tone="attention"]{background:var(--pill-attention-fill);color:var(--pill-attention-ink)}
 [data-tone="negative"]{background:var(--pill-negative-fill);color:var(--pill-negative-ink)}
 [data-tone="movement"]{background:var(--pill-movement-fill);color:var(--pill-movement-ink)}
</style>
