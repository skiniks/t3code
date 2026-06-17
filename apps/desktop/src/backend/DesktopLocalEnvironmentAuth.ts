import { bootstrapRemoteBearerSession } from "@t3tools/client-runtime";
import * as Clock from "effect/Clock";
import * as Context from "effect/Context";
import * as Data from "effect/Data";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Ref from "effect/Ref";
import * as Semaphore from "effect/Semaphore";
import { HttpClient } from "effect/unstable/http";

import * as DesktopBackendManager from "./DesktopBackendManager.ts";

export interface DesktopLocalEnvironmentAuthShape {
  readonly getBearerToken: Effect.Effect<string, DesktopLocalEnvironmentAuthError>;
}

export class DesktopLocalEnvironmentAuthError extends Data.TaggedError(
  "DesktopLocalEnvironmentAuthError",
)<{
  readonly message: string;
  readonly cause?: unknown;
}> {}

export class DesktopLocalEnvironmentAuth extends Context.Service<
  DesktopLocalEnvironmentAuth,
  DesktopLocalEnvironmentAuthShape
>()("@t3tools/desktop/backend/DesktopLocalEnvironmentAuth") {}

interface CachedToken {
  readonly token: string;
  readonly expiresAt: number;
}

const EXPIRY_SAFETY_MARGIN = 0.9;

export const layer = Layer.effect(
  DesktopLocalEnvironmentAuth,
  Effect.gen(function* () {
    const backendManager = yield* DesktopBackendManager.DesktopBackendManager;
    const httpClient = yield* HttpClient.HttpClient;
    const tokenRef = yield* Ref.make(Option.none<CachedToken>());
    const mutex = yield* Semaphore.make(1);

    const getBearerToken = mutex
      .withPermits(1)(
        Effect.gen(function* () {
          const now = yield* Clock.currentTimeMillis;
          const cached = yield* Ref.get(tokenRef);
          if (Option.isSome(cached) && now < cached.value.expiresAt) {
            return cached.value.token;
          }

          const configOption = yield* backendManager.currentConfig;
          if (Option.isNone(configOption)) {
            return yield* new DesktopLocalEnvironmentAuthError({
              message: "Local backend is not configured.",
            });
          }
          const config = configOption.value;
          const session = yield* bootstrapRemoteBearerSession({
            httpBaseUrl: config.httpBaseUrl.href,
            credential: config.bootstrap.desktopBootstrapToken,
            clientMetadata: {
              label: "T3 Code Desktop",
              deviceType: "desktop",
            },
          }).pipe(
            Effect.provideService(HttpClient.HttpClient, httpClient),
            Effect.mapError(
              (cause) =>
                new DesktopLocalEnvironmentAuthError({
                  message: "Failed to create the local desktop bearer session.",
                  cause,
                }),
            ),
          );
          const expiresAt = now + session.expires_in * 1000 * EXPIRY_SAFETY_MARGIN;
          yield* Ref.set(tokenRef, Option.some({ token: session.access_token, expiresAt }));
          return session.access_token;
        }),
      )
      .pipe(Effect.withSpan("desktop.localEnvironmentAuth.getBearerToken"));

    return DesktopLocalEnvironmentAuth.of({ getBearerToken });
  }),
);
