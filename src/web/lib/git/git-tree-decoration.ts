import { gitStatusStore } from './git-status-store.js';
import './git.css';

export interface TreeRow { contextId: string; path: string; name?: string; type?: string }

const parentOf = (value: string) => value === '/' ? '/' : value.slice(0, value.lastIndexOf('/')) || '/';

/**
 * Svelte action for a filesystem tree row: adds the git status letter and
 * colour from the cached status map. Self-contained so the tree only needs
 * `use:gitDecoration={{contextId, path, name, type}}`.
 */
export function gitDecoration(node: HTMLElement, initial: TreeRow) {
  let row = initial;
  const badge = document.createElement('span');
  badge.className = 'git-tree-letter';
  badge.setAttribute('aria-hidden', 'true');
  const render = () => {
    const value = gitStatusStore.decoration(row.contextId, row.path);
    if (!value) { delete node.dataset.git; badge.remove(); node.removeAttribute('data-git-title'); return; }
    node.dataset.git = value.tone;
    node.dataset.gitTitle = value.title;
    badge.textContent = value.letter;
    badge.title = value.title;
    badge.classList.toggle('folder', value.folder);
    if (badge.parentElement !== node) node.append(badge);
  };
  const observe = () => {
    gitStatusStore.observe(row.contextId, parentOf(row.path));
    if (row.name === '.git') gitStatusStore.noteRepository(row.contextId, parentOf(row.path));
  };
  const unsubscribe = gitStatusStore.subscribe(render);
  observe(); render();
  return {
    update(next: TreeRow) { const moved = next.path !== row.path || next.contextId !== row.contextId; row = next; if (moved) { observe(); render(); } },
    destroy() { unsubscribe(); badge.remove(); },
  };
}
