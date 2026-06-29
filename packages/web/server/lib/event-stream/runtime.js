import { sendMessageStreamWsEvent } from './protocol.js';

export function createGlobalUiEventBroadcaster({
  sseClients,
  wsClients,
  writeSseEvent,
}) {
  return (payload, options = {}) => {
    const hasSseClients = sseClients.size > 0;
    const hasWsClients = wsClients.size > 0;
    if (!hasSseClients && !hasWsClients) {
      return;
    }

    if (hasSseClients) {
      for (const res of sseClients) {
        try {
          writeSseEvent(res, payload);
        } catch {
        }
      }
    }

    if (hasWsClients) {
      for (const socket of Array.from(wsClients)) {
        const sent = sendMessageStreamWsEvent(socket, payload, {
          directory: typeof options.directory === 'string' && options.directory.length > 0 ? options.directory : 'global',
          eventId: typeof options.eventId === 'string' && options.eventId.length > 0 ? options.eventId : undefined,
        });
        if (!sent) {
          wsClients.delete(socket);
        }
      }
    }
  };
}
