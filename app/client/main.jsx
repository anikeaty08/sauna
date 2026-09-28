import React, { lazy, Suspense } from 'react';
import { createRoot } from 'react-dom/client';
import Customizer from './sauna/Customizer';
import './style.css';

// Two independent UIs over the same data and 3D engine: the classic
// configurator at / and the Studio design at /studio. The Studio is its own
// chunk, so the classic page never downloads it.
const Studio = lazy(() => import('./sauna/studio/Studio'));
const isStudio = location.pathname.replace(/\/+$/, '') === '/studio';

createRoot(document.getElementById('root')).render(
  isStudio
    ? <Suspense fallback={<div style={{ minHeight: '100svh', background: '#f6f5f1' }} />}><Studio /></Suspense>
    : <Customizer />
);
