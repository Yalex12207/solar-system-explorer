import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.jsx';
import './styles/global.css';

/**
 * Last line of defence: if anything throws during render we still show a branded
 * page instead of a blank screen.
 */
function mount() {
  const container = document.getElementById('root');
  if (!container) return;

  const fallback = document.getElementById('boot-fallback');
  if (fallback) fallback.remove();

  try {
    createRoot(container).render(
      <StrictMode>
        <App />
      </StrictMode>,
    );
  } catch (error) {
    container.innerHTML = `
      <div style="min-height:100vh;display:grid;place-items:center;background:#05070d;color:#e8ecf4;
                  font-family:ui-sans-serif,system-ui,sans-serif;text-align:center;padding:40px">
        <div>
          <p style="letter-spacing:.3em;font-size:12px;color:#8a94a6">SOLAR SYSTEM</p>
          <h1 style="font-weight:400;margin:18px 0">Something went wrong</h1>
          <p style="color:#8a94a6;max-width:46ch;margin:0 auto 24px">
            The interface failed to start on this device. Reloading usually resolves it.
          </p>
          <button onclick="location.reload()"
                  style="padding:14px 26px;border-radius:999px;border:1px solid rgba(255,255,255,.18);
                         background:transparent;color:#e8ecf4;letter-spacing:.18em;font-size:12px;cursor:pointer">
            RELOAD
          </button>
          <pre style="margin-top:28px;color:#5a6478;font-size:11px;white-space:pre-wrap">${String(
            error?.message || error,
          )}</pre>
        </div>
      </div>`;
  }
}

mount();
