import React from 'react';
import { createRoot } from 'react-dom/client';
import { AppRouter } from './AppRouter';
import './styles.css';
import { registerFonts } from './fonts';

registerFonts();

createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <AppRouter />
  </React.StrictMode>
);
