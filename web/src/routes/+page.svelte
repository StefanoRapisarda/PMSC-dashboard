<script lang="ts">
  import { base } from '$app/paths';
  import { goto } from '$app/navigation';
  /* v3 opened on the workflow view.

     `base` is not decoration. It is '' wherever the app owns the root of its
     address, which is development and the container, and '/PMSC-dashboard' on
     GitHub Pages, which serves a project from a subdirectory. Without it this
     sends the browser to the domain root, outside the site entirely — and the
     symptom is the page appearing for a moment and then being replaced by
     GitHub's own 404, which reads like a broken deployment rather than a bad
     link. */
  $effect(() => { goto(`${base}/workflow`, { replaceState: true }); });
</script>
