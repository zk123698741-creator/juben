/**
 * 应用入口
 */

import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import { ErrorBoundary } from '@/components/common';
import './index.css';

// 初始化 Agents
import '@/store/agentStore';
import { useAuthStore } from '@/store/authStore';

async function bootstrap() {
  if (import.meta.env.VITE_DESKTOP === 'true' && window.jubenDesktop) {
    try {
      const session = await window.jubenDesktop.getSession();
      useAuthStore.setState({ ...session, isAuthenticated: true, isLoading: false });
    } catch (error) {
      console.error('Desktop login failed:', error);
    }
  }
  ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </React.StrictMode>
);
}
void bootstrap();
