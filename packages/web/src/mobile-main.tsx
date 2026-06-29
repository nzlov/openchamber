import { createConfiguredWebAPIs } from './runtimeConfig';
import { renderMobileApp } from '@openchamber/ui/apps/renderMobileApp';
import '@openchamber/ui/index.css';
import '@openchamber/ui/styles/fonts';

renderMobileApp(createConfiguredWebAPIs());
