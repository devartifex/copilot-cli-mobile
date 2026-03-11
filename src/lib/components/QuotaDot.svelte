<script lang="ts">
  import type { QuotaSnapshots } from '$lib/types/index.js';

  interface Props {
    quotaSnapshots: QuotaSnapshots | null;
  }

  const { quotaSnapshots }: Props = $props();

  const usagePercent = $derived.by(() => {
    if (!quotaSnapshots) return null;

    const snapshot =
      quotaSnapshots.copilot_premium ??
      quotaSnapshots.premium_requests ??
      quotaSnapshots.premium_interactions ??
      quotaSnapshots.chat;

    if (!snapshot) return null;

    if (snapshot.percentageUsed != null) return snapshot.percentageUsed;
    if (snapshot.remainingPercentage != null) return 100 - snapshot.remainingPercentage;

    return null;
  });

  const dotColor = $derived.by(() => {
    if (usagePercent == null) return null;
    if (usagePercent > 80) return 'red';
    if (usagePercent >= 50) return 'yellow';
    return 'green';
  });
</script>

{#if dotColor}
  <span class="quota-dot {dotColor}" title="{Math.round(usagePercent ?? 0)}% quota used"></span>
{/if}

<style>
  .quota-dot {
    width: 8px;
    height: 8px;
    border-radius: 50%;
    display: inline-block;
    flex-shrink: 0;
  }

  .quota-dot.green {
    background: var(--green);
  }

  .quota-dot.yellow {
    background: var(--yellow);
  }

  .quota-dot.red {
    background: var(--red);
  }
</style>
