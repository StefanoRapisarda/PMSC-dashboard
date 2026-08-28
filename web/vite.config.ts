import adapter from '@sveltejs/adapter-static';
import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vite';

/* Where this build will be served from.
   A container serves the app at the root of its own address, so the prefix is
   empty. GitHub Pages serves a project site from a subdirectory named after the
   repository, so every asset and every data file has to be addressed as
   /PMSC-dashboard/... instead. The Pages workflow sets BASE_PATH; nothing else
   does, and an empty value is the correct default everywhere else. */
/* SvelteKit types this as either empty or a path beginning with a slash, which
   an environment variable cannot promise on its own. */
const basePath = (process.env.BASE_PATH ?? '') as '' | `/${string}`;

/* The fallback is always index.html, so that the site has a real front page that
   answers with 200 rather than only a 404 document. GitHub Pages additionally
   needs a copy of it named 404.html, because that is the only way to tell Pages
   what to do with /graph and /dashboard, which are routes the application knows
   about and the server does not. `npm run build:pages` makes that copy. */
const fallback = 'index.html';

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
			   same page so that /graph and /dashboard work on a refresh.
			   The scaffold's adapter-auto guesses a hosting platform, which is
			   the wrong question for something that ships in a container. */
			adapter: adapter({ fallback }),

			paths: { base: basePath }
		})
	]
});
