import { mount } from 'svelte';
import App from './App.svelte';
import './theme.css';
import './styles.css';
import './enhancements.css';
import 'dockview/dist/styles/dockview.css';
import '@xterm/xterm/css/xterm.css';
import './workspace.css';
import './components/ui/form-controls.css';

mount(App, { target: document.getElementById('app')! });
