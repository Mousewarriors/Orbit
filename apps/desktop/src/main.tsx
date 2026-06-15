import React from 'react';
import ReactDOM from 'react-dom/client';
import { App } from './App.js';
import { Settings } from './settings/Settings.js';
import { ErrorBoundary } from './components/ErrorBoundary.js';
import { selectView } from './route.js';
import { currentWindowLabel } from './native.js';
import './styles.css';
import './settings/settings.css';

const root = document.getElementById('root');
if (!root) throw new Error('missing #root');

// The Settings window loads the same bundle as the launcher (one Vite entry).
// Choose the root component from the window label / query string (see route.ts).
// A query param (`?view=settings`) is used instead of a `#/settings` hash so the
// shell can never treat the route as part of an asset path.
const view = selectView({
  label: currentWindowLabel(),
  search: window.location.search,
  hash: window.location.hash,
});

// Wrapped in an ErrorBoundary so a render failure shows a visible diagnostic
// rather than a silent blank window.
ReactDOM.createRoot(root).render(
  <React.StrictMode>
    <ErrorBoundary>{view === 'settings' ? <Settings /> : <App />}</ErrorBoundary>
  </React.StrictMode>,
);
