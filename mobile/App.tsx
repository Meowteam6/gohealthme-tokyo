// GoHealthMe iPhone app: the whole product, with Apple Watch pairing native.
//
// The root is the GoHealthMe website in a WebView (components/WebShell.tsx):
// sign in with email, join and create challenges, stake, verdicts, payouts,
// all the site's own in-page code. The app adds what only an app can do:
// read Apple Health, hold the pairing token in the Keychain, and keep the
// wallet's days current in the background. That lives in
// lib/use-apple-pairing.ts and runs from here, so background delivery keeps
// going whatever page is in front.
//
// Pairing reaches the app three ways and all three land on the same hook:
// the page posts a code through the bridge, the page's own
// gohealthme://pair link is intercepted inside the WebView, or Safari opens
// the app with that link (cold or warm). Each step is handed back to the page
// as a pair-status event. The standalone pairing screen
// (components/PairScreen.tsx) shows only when the site cannot load, so a
// person holding a Safari-minted code is never stranded.
//
// The look is Night Shift, the website's system, from lib/theme.ts.

import React, { useEffect, useMemo, useRef, useState } from "react";
import { Linking, StatusBar, StyleSheet, View } from "react-native";
import { SafeAreaProvider, SafeAreaView } from "react-native-safe-area-context";

import { PairScreen } from "./components/PairScreen";
import { WebShell, type WebShellHandle } from "./components/WebShell";
import { codeFromUrl } from "./lib/pairing-store";
import type { ShellStatus } from "./lib/shell/bridge";
import { colors } from "./lib/theme";
import { codeSpent, useApplePairing } from "./lib/use-apple-pairing";

export default function App(): React.JSX.Element {
  const pairing = useApplePairing();
  const { pairWithCode, onStatus } = pairing;
  const shell = useRef<WebShellHandle>(null);
  // The last code a Safari link brought in, for the fallback screen's field.
  const [linkCode, setLinkCode] = useState<string | null>(null);

  // A gohealthme://pair?code=... link pairs on the spot, whether it opened the
  // app cold or arrived while it was running. Over an existing pairing it
  // means the person is pairing again: the old token is revoked when the new
  // one is issued, by design. Once the server has answered, the code is
  // spent and leaves the fallback's field; a redeem the network dropped
  // keeps it there to try again.
  useEffect(() => {
    const take = (url: string | null): void => {
      const code = codeFromUrl(url);
      if (code === null) return;
      setLinkCode(code);
      pairWithCode(code).then(
        (result) => {
          if (codeSpent(result)) setLinkCode((current) => (current === code ? null : current));
        },
        () => undefined,
      );
    };
    void Linking.getInitialURL().then(take);
    const sub = Linking.addEventListener("url", ({ url }) => take(url));
    return () => sub.remove();
  }, [pairWithCode]);

  // Every pairing and sync step goes to the page.
  useEffect(
    () => onStatus((status) => shell.current?.inject({ type: "pair-status", ...status })),
    [onStatus],
  );

  const address = pairing.pairing?.address ?? null;
  const status = useMemo<ShellStatus>(
    () => ({
      healthAvailable: pairing.available !== false,
      paired: address === null ? null : { address },
      healthAsked: pairing.connected,
    }),
    [pairing.available, address, pairing.connected],
  );

  return (
    <SafeAreaProvider>
      <View style={styles.root}>
        <StatusBar barStyle="light-content" />
        {/* Top inset only: the site pads its own bottom with the safe-area inset. */}
        <SafeAreaView edges={["top"]} style={styles.flex}>
          <WebShell
            ref={shell}
            status={status}
            onPair={(code) => void pairWithCode(code)}
            onSync={() => void pairing.syncNow()}
            renderFallback={({ retry, host }) => (
              <PairScreen pairing={pairing} initialCode={linkCode} loadError={{ retry, host }} />
            )}
          />
        </SafeAreaView>
      </View>
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.background },
  flex: { flex: 1 },
});
