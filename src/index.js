import React from 'react';
import ReactDOM from 'react-dom/client';
import './index.css';
import App from './opticoat-designer';
import reportWebVitals from './reportWebVitals';
import { ClerkProvider } from '@clerk/clerk-react';

const CLERK_KEY = process.env.REACT_APP_CLERK_PUBLISHABLE_KEY;

const root = ReactDOM.createRoot(document.getElementById('root'));

// Wrap in ClerkProvider only if a key is configured
const AppWrapper = CLERK_KEY ? (
  <React.StrictMode>
    <ClerkProvider publishableKey={CLERK_KEY}>
      <App />
    </ClerkProvider>
  </React.StrictMode>
) : (
  <React.StrictMode>
    <App />
  </React.StrictMode>
);

root.render(AppWrapper);

// If you want to start measuring performance in your app, pass a function
// to log results (for example: reportWebVitals(console.log))
// or send to an analytics endpoint. Learn more: https://bit.ly/CRA-vitals
reportWebVitals();

// Unregister any existing service workers — they interfere with API streaming
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.getRegistrations().then((registrations) => {
    registrations.forEach((reg) => {
      reg.unregister();
      console.log('SW unregistered:', reg.scope);
    });
  });
}
