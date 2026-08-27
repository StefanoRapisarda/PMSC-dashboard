/** Typed client for the API. One place to change when the backend moves. */
import type { GraphPayload, Meta, Overview, SpecimenDetail } from './types';

const BASE = import.meta.env.VITE_API_BASE ?? 'http://localhost:8000';

async function get<T>(path: string, fetcher: typeof fetch = fetch): Promise<T> {
  const res = await fetcher(`${BASE}${path}`);
  if (!res.ok) throw new Error(`${res.status} ${res.statusText} on ${path}`);
  return (await res.json()) as T;
}

export const api = {
  meta: (f?: typeof fetch) => get<Meta>('/api/meta', f),
  overview: (f?: typeof fetch) => get<Overview>('/api/overview', f),
  graph: (patients?: number, f?: typeof fetch) =>
    get<GraphPayload>(`/api/graph${patients ? `?patients=${patients}` : ''}`, f),
  specimen: (id: number, f?: typeof fetch) => get<SpecimenDetail>(`/api/specimens/${id}`, f),
  search: (q: string, f?: typeof fetch) =>
    get<{ query: string; hits: { value: string; system: string; owner_type: string;
                                 specimen_id: number | null }[] }>(
      `/api/search?q=${encodeURIComponent(q)}`, f),
};
