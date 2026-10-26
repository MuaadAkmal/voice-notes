import { createRoot } from 'react-dom/client';
import { App } from './App';
import './dashboard.css';
import { toWav } from '../common/to-wav';

// Main sets nativeTheme.themeSource from the theme setting, so prefers-color-scheme already reflects
// System / Light / Dark; mirror it onto html.dark for Tailwind's class-based dark variant.
const media = window.matchMedia('(prefers-color-scheme: dark)');
const syncTheme = () => document.documentElement.classList.toggle('dark', media.matches);
syncTheme();
media.addEventListener('change', syncTheme);

// Main has no audio decoder: it hands clips here to become WAV for transcription.
const api = window.dashboardApi;
api.onNeedWav(({ requestId, bytes }) =>
  toWav(bytes).then(
    (wav) => api.sendWav({ requestId, bytes: wav }),
    () => api.sendWav({ requestId, error: "Couldn't read the audio" }),
  ),
);

createRoot(document.getElementById('root')!).render(<App />);
