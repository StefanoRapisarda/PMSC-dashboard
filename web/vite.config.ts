import adapter from '@sveltejs/adapter-static';
import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vite';

export default defineConfig({
	plugins: [
		sveltekit({
			compilerOptions: {
				// Force runes mode for the project, except for libraries. Can be removed in svelte 6.
				runes: ({ filename }) =>
					filename.split(/[/\\]/).includes('node_modules') ? undefined : true
			},

			/* This application is a browser client for the API and nothing else:
			   every page fetches its data at runtime and none of it can be
			   rendered on a server that has not got the database. So the build
			   produces plain files — HTML, JavaScript, CSS — that any web server
			   can hand out, and `fallback` makes every unknown path return the
			   same index.html so that /graph and /dashboard work on a refresh.
			   The scaffold's adapter-auto guesses a hosting platform, which is
			   the wrong question for something that ships in a container. */
			adapter: adapter({ fallback: 'index.html' })
		})
	]
});
