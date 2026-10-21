import { mount } from 'svelte';
import App from './App.svelte';
import { isDesktopApp, startDesktopEvents } from './lib/desktop-events.js';
import './theme.css';
import './styles.css';
import './enhancements.css';
import 'dockview/dist/styles/dockview.css';
import '@xterm/xterm/css/xterm.css';
import './workspace.css';
import './components/ui/form-controls.css';

// After a redeploy an open tab still asks for the old hashed chunks, which 404.
// Reload once to pick up the new build; the timestamp stops a reload loop.
window.addEventListener('vite:preloadError', event => {
  let last = 0;
  try { last = Number(sessionStorage.getItem('atlas:chunk-reload')) || 0; } catch {}
  if (Date.now() - last < 10_000) return;
  try { sessionStorage.setItem('atlas:chunk-reload', String(Date.now())); } catch {}
  event.preventDefault();
  location.reload();
});

mount(App, { target: document.getElementById('app')! });
if (isDesktopApp()) startDesktopEvents();
