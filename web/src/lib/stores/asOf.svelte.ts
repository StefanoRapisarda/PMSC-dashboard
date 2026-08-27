/**
 * The "as of" date — a cross-cutting control every view derives from.
 *
 * This is the WORKED EXAMPLE of the pattern design-decisions.md §2 asks for:
 * "One reactive store per cross-cutting control that every view derives from."
 * Copy this shape for the other cross-cutting controls (facets, selection).
 *
 * Note the filename: `.svelte.ts`, not `.ts`. Runes ($state, $derived) only work
 * in `.svelte` and `.svelte.ts` files — a plain `.ts` file will fail to compile.
 */

/** Today as `YYYY-MM-DD`, which is what <input type="date"> expects. */
function today(): string {
	return new Date().toISOString().slice(0, 10);
}

class AsOf {
	/** $state makes this deeply reactive: any component reading it re-renders on change. */
	date = $state<string>(today());

	/** $derived recomputes automatically whenever `date` changes. Never assign to it. */
	asDate = $derived(new Date(this.date));

	reset() {
		this.date = today();
	}
}

/**
 * A single shared instance. Importing this from any component gives the same object,
 * so the header's date picker and every view stay in sync with no prop-passing.
 */
export const asOf = new AsOf();

/*
 * TODO (your next step, and a good first exercise):
 *
 * design-decisions.md §2 also says "State lives in the URL" — facet and selection
 * state should be encoded in the query string so any view is shareable in an email
 * and the demo is reproducible.
 *
 * That means this store should read its initial value from `page.url.searchParams`
 * and push changes back with `goto(..., { replaceState: true, keepFocus: true,
 * noScroll: true })` from `$app/navigation`.
 *
 * It is deliberately NOT done here: doing it well means deciding what belongs in the
 * URL (shareable intent) versus what does not (transient UI state), and that decision
 * is yours. Ask me when you get to it.
 */
