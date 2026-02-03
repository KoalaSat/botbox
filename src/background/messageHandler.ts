/**
 * Message Handler Utility
 * Provides clean wrapper for async message handlers with automatic error handling
 */

interface MessageResponse {
  success: boolean;
  data?: any;
  error?: string;
}

type AsyncHandler<T = any> = () => Promise<T>;
type AsyncHandlerWithPayload<T = any, P = any> = (payload: P) => Promise<T>;

/**
 * Wraps an async handler function to automatically handle success/error responses
 * Returns true to indicate async response
 */
export function handleAsync<T>(
  handler: AsyncHandler<T>,
  sendResponse: (response: MessageResponse) => void
): boolean {
  handler()
    .then((data) => sendResponse({ success: true, data }))
    .catch((error) => sendResponse({ success: false, error: error.message }));
  return true;
}

/**
 * Wraps an async handler with payload to automatically handle success/error responses
 * Returns true to indicate async response
 */
export function handleAsyncWithPayload<T, P>(
  handler: AsyncHandlerWithPayload<T, P>,
  payload: P,
  sendResponse: (response: MessageResponse) => void
): boolean {
  handler(payload)
    .then((data) => sendResponse({ success: true, data }))
    .catch((error) => sendResponse({ success: false, error: error.message }));
  return true;
}

/**
 * Wraps an async handler that returns void
 * Returns true to indicate async response
 */
export function handleAsyncVoid(
  handler: AsyncHandler<void>,
  sendResponse: (response: MessageResponse) => void
): boolean {
  handler()
    .then(() => sendResponse({ success: true }))
    .catch((error) => sendResponse({ success: false, error: error.message }));
  return true;
}

/**
 * Wraps an async handler with payload that returns void
 * Returns true to indicate async response
 */
export function handleAsyncVoidWithPayload<P>(
  handler: AsyncHandlerWithPayload<void, P>,
  payload: P,
  sendResponse: (response: MessageResponse) => void
): boolean {
  handler(payload)
    .then(() => sendResponse({ success: true }))
    .catch((error) => sendResponse({ success: false, error: error.message }));
  return true;
}
