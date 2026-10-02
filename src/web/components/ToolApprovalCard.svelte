<script lang="ts">
  export let approval: { approvalId: string; toolCallId?: string; summary: string; toolId?: string };
  export let onDecision: (decision: 'deny' | 'allow_once' | 'allow_conversation' | 'allow_durable' | 'allow_full_access') => void;
  export let onRevoke: () => void = () => {};
  let busy = false;
  async function decide(decision: 'deny' | 'allow_once' | 'allow_conversation' | 'allow_durable' | 'allow_full_access') { busy = true; try { await onDecision(decision); } finally { busy = false; } }
</script>

<article class="tool-approval" aria-label={`Approval required: ${approval.summary}`}>
  <header><strong>Approval required</strong><small>{approval.toolId ?? approval.toolCallId ?? 'Atlas tool'}</small></header>
  <p>{approval.summary}</p>
  <div class="approval-actions">
    <button disabled={busy} onclick={() => void decide('allow_once')}>Allow once</button>
    <button disabled={busy} onclick={() => void decide('allow_conversation')}>Allow conversation</button>
    <button disabled={busy} onclick={() => void decide('allow_durable')}>Remember</button>
    <button disabled={busy} onclick={() => void decide('allow_full_access')}>Grant full access</button>
    <button disabled={busy} class="danger" onclick={() => void decide('deny')}>Deny</button>
    <button disabled={busy} class="quiet" onclick={onRevoke}>Revoke</button>
  </div>
</article>
