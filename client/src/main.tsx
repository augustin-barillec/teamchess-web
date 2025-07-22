import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { initThemeMode } from 'flowbite-react';

import App from './App';
import './index.css';
import { ThemeInit } from '../.flowbite-react/init';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ThemeInit />
    <App />
  </StrictMode>,
);

initThemeMode();
