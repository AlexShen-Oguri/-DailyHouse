import React from 'react';
import ReactDOM from 'react-dom/client';
import { HashRouter } from 'react-router-dom';
import App from './App';
import { PreferencesProvider } from './personal/Preferences';
import './styles/global.css';
import './styles/garden.css';
import './styles/garden-details.css';
import './styles/preferences.css';
import './styles/night-garden.css';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <PreferencesProvider><HashRouter>
      <App />
    </HashRouter></PreferencesProvider>
  </React.StrictMode>
);
