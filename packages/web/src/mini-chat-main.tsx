import { createConfiguredWebAPIs } from './runtimeConfig';
import { renderElectronMiniChatApp } from '@openchamber/ui/apps/renderElectronMiniChatApp';
import '@openchamber/ui/index.css';
import '@openchamber/ui/styles/fonts';

renderElectronMiniChatApp(createConfiguredWebAPIs());
