/**
 * Everything here is a browser client for the API.
 *
 * `ssr = false` says so: there is no server in the deployed container that
 * could render these pages, only one handing out files, and every view fetches
 * what it needs once it is running. `prerender = false` follows from the same
 * fact — a page cannot be baked at build time when its contents come from a
 * database queried at request time.
 */
export const ssr = false;
export const prerender = false;
