import { mount } from 'svelte';
import App from './App.svelte';
import './theme.css';
import './styles.css';
import './enhancements.css';
import 'dockview/dist/styles/dockview.css';
import '@xterm/xterm/css/xterm.css';

mount(App, { target: document.getElementById('app')! });
