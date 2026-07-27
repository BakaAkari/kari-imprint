import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { PUBLIC_BASE } from './env';
import { HomePage } from './HomePage';

export function AppRouter() {
  return (
    <BrowserRouter basename={PUBLIC_BASE}>
      <Routes>
        <Route path="/" element={<HomePage />} />
        <Route path="*" element={<HomePage />} />
      </Routes>
    </BrowserRouter>
  );
}
