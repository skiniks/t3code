let desktopBearerTokenPromise: Promise<string> | null = null;
let desktopBearerTokenExpiresAt = 0;

export function readDesktopPrimaryBearerToken(): Promise<string | null> {
  if (typeof window === "undefined") {
    return Promise.resolve(null);
  }
  const bridge = window.desktopBridge;
  if (!bridge) {
    return Promise.resolve(null);
  }

  if (desktopBearerTokenPromise === null || Date.now() >= desktopBearerTokenExpiresAt) {
    desktopBearerTokenPromise = bridge.getLocalEnvironmentBearerToken().catch((error) => {
      desktopBearerTokenPromise = null;
      desktopBearerTokenExpiresAt = 0;
      throw error;
    });
    desktopBearerTokenExpiresAt = Date.now() + 30 * 60_000;
  }
  return desktopBearerTokenPromise;
}

export function __resetDesktopPrimaryAuthForTests(): void {
  desktopBearerTokenPromise = null;
  desktopBearerTokenExpiresAt = 0;
}
