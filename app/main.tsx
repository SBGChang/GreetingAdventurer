// app/main.tsx — renderer 進入點。掛載 React App。
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';

const rootEl = document.getElementById('root');
if (rootEl === null) throw new Error('找不到 #root');
createRoot(rootEl).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
