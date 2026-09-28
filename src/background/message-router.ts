export interface BackgroundMessageRoute {
  matches(message: unknown): boolean;
  handle(message: unknown): Promise<unknown>;
  createErrorResponse(error: unknown, message: unknown): unknown;
}

export type BackgroundMessageListener = (
  message: unknown,
  sender: chrome.runtime.MessageSender,
  sendResponse: (response?: unknown) => void
) => boolean;

/**
 * Creates one owner for the runtime response channel.
 *
 * Chrome keeps `sendResponse` alive only when the selected listener returns
 * literal `true`. Selecting the route synchronously also guarantees that one
 * incoming message is handled, and answered, by at most one route.
 */
export function createBackgroundMessageListener(
  routes: readonly BackgroundMessageRoute[]
): BackgroundMessageListener {
  return (message, _sender, sendResponse) => {
    const route = routes.find((candidate) => candidate.matches(message));
    if (route === undefined) {
      return false;
    }

    void Promise.resolve()
      .then(() => route.handle(message))
      .then((result) => sendResponse({ ok: true, result }))
      .catch((error: unknown) => {
        sendResponse(route.createErrorResponse(error, message));
      });

    return true;
  };
}
