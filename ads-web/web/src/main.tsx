import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App.tsx';
import { BotKbApp } from './BotKbPage.tsx';
import { CatalogApp } from './CatalogPage.tsx';
import { GoSellApp } from './GoSellPage.tsx';
import { OrdersApp } from './OrdersPage.tsx';
import { RequestsApp } from './RequestsPage.tsx';
import { ProfitApp } from './ProfitPage.tsx';
import { StockApp } from './StockPage.tsx';
import { StudioApp } from './StudioPage.tsx';
import { TrainApp } from './TrainPage.tsx';
import { PostsApp } from './PostsPage.tsx';
import { TodoApp } from './TodoPage.tsx';
import { UnitsApp } from './UnitsPage.tsx';
import { UiProvider } from './ui.tsx';
import './styles.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <UiProvider>
      {/^\/studio\/posts\/?$/.test(location.pathname) ? <PostsApp /> : /^\/studio\/train\/?$/.test(location.pathname) ? <TrainApp /> : /^\/studio\/?$/.test(location.pathname) ? <StudioApp /> : /^\/botkb\/?$/.test(location.pathname) ? <BotKbApp /> : /^\/requests\/?$/.test(location.pathname) ? <RequestsApp /> : /^\/gosell\/?$/.test(location.pathname) ? <GoSellApp /> : /^\/catalog\/orders\/?$/.test(location.pathname) ? <OrdersApp /> : /^\/catalog\/sales\/?$/.test(location.pathname) ? <UnitsApp /> : /^\/catalog\/todo\/?$/.test(location.pathname) ? <TodoApp /> : /^\/catalog\/profit\/?$/.test(location.pathname) ? <ProfitApp /> : /^\/catalog\/stock\/?$/.test(location.pathname) ? <StockApp /> : /^\/catalog\/?$/.test(location.pathname) ? <CatalogApp /> : <App />}
    </UiProvider>
  </StrictMode>,
);
