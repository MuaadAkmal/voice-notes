import { createRoot } from 'react-dom/client';
import { App } from './App';
import './dashboard.css';

// Main sets nativeTheme.themeSource from the theme setting, so prefers-color-scheme already reflects
// System / Light / Dark; mirror it onto html.dark for Tailwind's class-based dark variant.
const media = window.matchMedia('(prefers-color-scheme: dark)');
const syncTheme = () => document.documentElement.classList.toggle('dark', media.matches);
syncTheme();
media.addEventListener('change', syncTheme);

createRoot(document.getElementById('root')!).render(<App />);
