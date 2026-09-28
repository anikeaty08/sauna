import React, { lazy, Suspense } from 'react';
import { createRoot } from 'react-dom/client';
import Customizer from './sauna/Customizer';
import './style.css';

// Legacy demo configurator at /; the production configurator (modular engine,
// app/client/studio) at /studio. The studio is its own chunk, so the demo page
// never downloads it.
const Studio = lazy(() => import('./studio/StudioApp.tsx'));
const ArPage = lazy(() => import('./studio/ArPage.tsx'));
const route = location.pathname.replace(/\/+$/, '');
const isStudio = route === '/studio';
const isAr = route === '/studio/ar';

createRoot(document.getElementById('root')).render(
  isStudio || isAr
    ? <Suspense fallback={<div style={{ minHeight: '100svh', background: '#f6f5f1' }} />}>{isAr ? <ArPage /> : <Studio />}</Suspense>
    : <Customizer />
);
