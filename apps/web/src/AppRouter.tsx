import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { PUBLIC_BASE } from './env';
import { V3HomePage } from './V3HomePage';

export function AppRouter() {
  return (
    <BrowserRouter basename={PUBLIC_BASE}>
      <Routes>
        <Route path="/" element={<V3HomePage />} />
        <Route path="*" element={<V3HomePage />} />
      </Routes>
    </BrowserRouter>
  );
}
