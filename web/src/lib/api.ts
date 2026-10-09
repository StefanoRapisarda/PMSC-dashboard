/** Typed client for the API. One place to change when the backend moves.
 *
 * Two modes, chosen at build time.
 *
 * Against a server, which is development and the container, every call is an
 * HTTP request. `VITE_API_BASE` says where the API is: unset means
 * http://localhost:8000, which is right on a developer's machine where the two
 * halves run on separate ports; empty means "same origin as this page", which
 * is what the container sets so that every request becomes a relative one.
 *
 * Against files, which is the published GitHub Pages build, there is no API at
 * all. `VITE_STATIC_DATA=1` switches the three calls the application actually
 * makes over to JSON files written by api/export_static.py at build time. That
 * works only because the showcase's database is built from a seeded generator
 * and is never written to, so those three answers are fixed for a whole
 * release. It is a published build of a showcase, not a change of design.
 */
import { base } from '$app/paths';
import type { GraphPayload, Meta, Overview, SpecimenDetail } from './types';

const STATIC = import.meta.env.VITE_STATIC_DATA === '1';
const BASE = import.meta.env.VITE_API_BASE ?? 'http://localhost:8000';

/* `base` is '' when the site is served from the root of a domain and
   '/PMSC-dashboard' when GitHub Pages serves it from a project subdirectory, so
   the files have to be asked for relative to it rather than from '/'. */
const FILES: Record<string, string> = {
  '/api/meta': '/data/meta.json',
  '/api/overview': '/data/overview.json',
  '/api/graph': '/data/graph.json',
};

async function get<T>(path: string, fetcher: typeof fetch = fetch): Promise<T> {
  let url: string;
  if (STATIC) {
    /* the query string is dropped on purpose: the only parameterised call the
       application makes is graph(), and it never passes an argument */
    const file = FILES[path.split('?')[0]];
    if (!file) {
      throw new Error(
        `${path} has no published file. The static build carries only the three ` +
        `responses the application asks for; anything else needs the API.`);
    }
    url = `${base}${file}`;
  } else {
    url = `${BASE}${path}`;
  }

  const res = await fetcher(url);
  if (!res.ok) throw new Error(`${res.status} ${res.statusText} on ${url}`);
  return (await res.json()) as T;
}

export const api = {
  meta: (f?: typeof fetch) => get<Meta>('/api/meta', f),
  overview: (f?: typeof fetch) => get<Overview>('/api/overview', f),
  graph: (patients?: number, f?: typeof fetch) =>
    get<GraphPayload>(`/api/graph${patients ? `?patients=${patients}` : ''}`, f),
  specimen: (id: number, f?: typeof fetch) => get<SpecimenDetail>(`/api/specimens/${id}`, f),
  search: (q: string, f?: typeof fetch) =>
    get<{ query: string; hits: { value: string; scheme: string; owner_type: string;
                                 specimen_id: number | null }[] }>(
      `/api/search?q=${encodeURIComponent(q)}`, f),
};
