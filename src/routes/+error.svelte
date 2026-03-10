<script lang="ts">
  import { page } from '$app/stores';
</script>

<div class="error-page">
  <h1>{$page.status}</h1>
  <p>{$page.error?.message ?? 'Something went wrong'}</p>
  <a href="/">Return home</a>
</div>

<style>
  .error-page {
    height: 100dvh;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: var(--sp-3);
    color: var(--fg);
    font-family: var(--font-mono);
  }
  h1 { color: var(--red); font-size: 3em; }
  p { color: var(--fg-muted); }
  a { color: var(--purple); }
</style>
