import type { APIRoute } from 'astro';
// Inline the canonical repo-root llms.txt at build time (Vite ?raw) so there is
// one source of truth, no duplicate to keep in sync. Served at /infrawise/llms.txt.
import llms from '../../../llms.txt?raw';

export const GET: APIRoute = () =>
  new Response(llms, { headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
