import React from 'react';
import ReactDOM from 'react-dom/client';
import { App } from './App.js';
import { Settings } from './settings/Settings.js';
import './styles.css';
import './settings/settings.css';

const root = document.getElementById('root');
if (!root) throw new Error('missing #root');

// The Settings window loads the same bundle at `index.html#/settings`; everything
// else is the launcher. A hash route keeps a single Vite entry and bundle.
const isSettings = window.location.hash.replace(/^#\/?/, '').startsWith('settings');

ReactDOM.createRoot(root).render(
  <React.StrictMode>{isSettings ? <Settings /> : <App />}</React.StrictMode>,
);
