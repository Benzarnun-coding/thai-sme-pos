import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App.tsx';
import { CatalogApp } from './CatalogPage.tsx';
import { GoSellApp } from './GoSellPage.tsx';
import { OrdersApp } from './OrdersPage.tsx';
import { UnitsApp } from './UnitsPage.tsx';
import { UiProvider } from './ui.tsx';
import './styles.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <UiProvider>
      {/^\/gosell\/?$/.test(location.pathname) ? <GoSellApp /> : /^\/catalog\/orders\/?$/.test(location.pathname) ? <OrdersApp /> : /^\/catalog\/sales\/?$/.test(location.pathname) ? <UnitsApp /> : /^\/catalog\/?$/.test(location.pathname) ? <CatalogApp /> : <App />}
    </UiProvider>
  </StrictMode>,
);
