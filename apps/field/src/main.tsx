import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import { App } from './App.jsx';
import './ui/theme.css';

const root = document.getElementById('root');
if (!root) throw new Error('no #root element');

// Registered after load so a service-worker failure can never stop the app starting —
// the operator is standing on a racecourse and does not care why.
if ('serviceWorker' in navigator && import.meta.env.PROD) {
  window.addEventListener('load', () => {
    void navigator.serviceWorker.register('/sw.js').catch(() => undefined);
  });
}

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
