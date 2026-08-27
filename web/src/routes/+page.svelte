<script lang="ts">
  import { goto } from '$app/navigation';
  /* v3 opened on the workflow view */
  $effect(() => { goto('/workflow', { replaceState: true }); });
</script>
