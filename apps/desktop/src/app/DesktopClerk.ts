import { createClerkBridge } from "@clerk/electron";
import { storage } from "@clerk/electron/storage";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Scope from "effect/Scope";

import * as ElectronApp from "../electron/ElectronApp.ts";
import * as ElectronProtocol from "../electron/ElectronProtocol.ts";
import * as ElectronWindow from "../electron/ElectronWindow.ts";
import * as DesktopEnvironment from "./DesktopEnvironment.ts";

export interface DesktopClerkShape {
  readonly configure: Effect.Effect<
    void,
    never,
    | DesktopEnvironment.DesktopEnvironment
    | ElectronApp.ElectronApp
    | ElectronWindow.ElectronWindow
    | Scope.Scope
  >;
}

export class DesktopClerk extends Context.Service<DesktopClerk, DesktopClerkShape>()(
  "@t3tools/desktop/app/DesktopClerk",
) {}

export function createDesktopClerkBridge(stateDir: string, isDevelopment: boolean) {
  return createClerkBridge({
    storage: storage({ path: stateDir }),
    renderer: {
      scheme: ElectronProtocol.getDesktopScheme(isDevelopment),
      host: ElectronProtocol.DESKTOP_HOST,
    },
  });
}

function isProtocolRegistrationManagedExternally(): boolean {
  return process.env.T3CODE_DESKTOP_PROTOCOL_REGISTRATION_MANAGED?.trim() === "1";
}

function resolveProtocolClientLaunchArgs(argv: readonly string[]): readonly string[] {
  return argv.slice(1);
}

function resolveConfiguredProtocolClient(): {
  readonly path: string;
  readonly args: readonly string[];
} | null {
  const path = process.env.T3CODE_DESKTOP_PROTOCOL_CLIENT_PATH?.trim();
  if (!path) return null;

  return {
    path,
    args: (process.env.T3CODE_DESKTOP_PROTOCOL_CLIENT_ARGS ?? "")
      .split("\n")
      .map((arg) => arg.trim())
      .filter((arg) => arg.length > 0),
  };
}

const make = DesktopClerk.of({
  configure: Effect.gen(function* () {
    const electronApp = yield* ElectronApp.ElectronApp;
    const electronWindow = yield* ElectronWindow.ElectronWindow;
    const environment = yield* DesktopEnvironment.DesktopEnvironment;
    const context = yield* Effect.context<ElectronWindow.ElectronWindow>();
    const runPromise = Effect.runPromiseWith(context);

    if (!(yield* electronApp.requestSingleInstanceLock)) {
      yield* electronApp.quit;
      return yield* Effect.interrupt;
    }

    const scheme = ElectronProtocol.getDesktopScheme(environment.isDevelopment);

    if (isProtocolRegistrationManagedExternally()) {
      // macOS development launchers register the URL handler externally via
      // Info.plist and LaunchServices before the Electron process starts.
    } else if (environment.isDevelopment) {
      const configuredClient = resolveConfiguredProtocolClient();
      if (configuredClient) {
        yield* electronApp.setAsDefaultProtocolClient(
          scheme,
          configuredClient.path,
          configuredClient.args,
        );
      } else {
        yield* electronApp.setAsDefaultProtocolClient(
          scheme,
          process.execPath,
          resolveProtocolClientLaunchArgs(process.argv),
        );
      }
    } else {
      yield* electronApp.setAsDefaultProtocolClient(scheme);
    }

    yield* Effect.acquireRelease(
      Effect.sync(() => createDesktopClerkBridge(environment.stateDir, environment.isDevelopment)),
      (bridge) => Effect.sync(() => bridge.cleanup()),
    );

    yield* electronApp.on("second-instance", () => {
      void runPromise(
        Effect.gen(function* () {
          const mainWindow = yield* electronWindow.currentMainOrFirst;
          if (Option.isSome(mainWindow)) {
            yield* electronWindow.reveal(mainWindow.value);
          }
        }),
      );
    });
  }).pipe(Effect.withSpan("desktop.clerk.configure")),
});

export const layer = Layer.succeed(DesktopClerk, make);
