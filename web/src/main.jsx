import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { NotificationProvider } from '@mittwald/flow-react-components';
import '@mittwald/flow-react-components/all.css';
import './styles.css';
import App from './App.jsx';
import Login from './Login.jsx';

// The server delivers this page for "/" and "/login"; the path decides what to show
const page = location.pathname === '/login' ? <Login /> : <App />;

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <NotificationProvider>{page}</NotificationProvider>
  </StrictMode>,
);
