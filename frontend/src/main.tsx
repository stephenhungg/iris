import {StrictMode} from 'react';
import {createRoot} from 'react-dom/client';
import App from './App.tsx';
// Stephen's tailwind-based landing tokens
import './index.css';
// My studio tokens (black/chrome/white, IBM Plex, used by pages/Studio.tsx)
import './styles/global.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
