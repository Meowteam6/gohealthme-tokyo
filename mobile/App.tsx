// GoHealthMe iPhone app: Apple Watch data into your GoHealthMe wallet.
//
// One screen, and the fewest taps that are honest. Pair once: the GoHealthMe
// website shows a code and, on this iPhone, a link that opens the app with
// the code already filled in, so the only tap here is Pair. Allow Apple
// Health when iOS asks. From then on the phone keeps the wallet's days
// current on its own: when HealthKit wakes it in the background, on launch,
// and whenever it returns to the foreground. Raw samples never leave the phone.
//
// The screen never claims success on its own. iOS does not tell an app what
// the user granted on the HealthKit sheet, so the only honest proof is how
// many days the server says it stored, and that is what is shown. A sync the
// server answered with nothing stored and nothing covered gets one plain
// line pointing at Settings, never a silent success; a read HealthKit
// refused outright gets one line and a retry.

import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  AppState,
  Linking,
  Platform,
  Pressable,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";

import { NotPairedError, redeemCode, type Pairing } from "./lib/api";
import { createBackgroundListener, type BackgroundListener } from "./lib/background";
import { healthDataAvailable, requestPermissions } from "./lib/healthkit";
import {
  clearPairing,
  codeFromUrl,
  loadConnected,
  loadPairing,
  saveConnected,
  savePairing,
} from "./lib/pairing-store";
import { syncNotice, syncNow, type SyncOutcome } from "./lib/sync";

const SYNC_DAYS = 30;

/**
 * The newest sync that landed, and whether this screen asked for it. A
 * background wake also reports here; its outcome drives the headline, but
 * the Settings line is only shown for a sync the person was waiting on.
 */
type LastSync = { outcome: SyncOutcome; manual: boolean };

/** How a failed step is retried: the same button, in place. */
type Failure = { message: string; retry: "pair" | "connect" | "sync" };

const REVOKED =
  "This iPhone is no longer paired. Get a new code on the GoHealthMe website and pair again.";

function shortAddress(address: string): string {
  return `${address.slice(0, 6)}...${address.slice(-4)}`;
}

function describe(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

export default function App(): React.JSX.Element {
  // undefined while the Keychain is being read, null when unpaired.
  const [pairing, setPairing] = useState<Pairing | null | undefined>(undefined);
  // Whether the Apple Health sheet has been shown on this phone.
  const [connected, setConnected] = useState(false);
  const [code, setCode] = useState("");
  const [codeFromLink, setCodeFromLink] = useState(false);
  // The pair form over a paired screen: a new link arrived, or the person
  // asked to pair a different wallet.
  const [repairing, setRepairing] = useState(false);
  const [busy, setBusy] = useState<"pairing" | "connecting" | "syncing" | null>(null);
  const [last, setLast] = useState<LastSync | null>(null);
  const [failure, setFailure] = useState<Failure | null>(null);
  const [available, setAvailable] = useState<boolean | null>(null);

  const syncing = useRef(false);
  // The one background listener this process holds. Pair, the permission
  // step and the launch effect all ask it to listen, often for the same
  // wallet within the same tick; it serialises them, because two live
  // subscriptions for one type silence each other on the native side.
  const listener = useRef<BackgroundListener | null>(null);

  useEffect(() => {
    try {
      setAvailable(healthDataAvailable());
    } catch {
      setAvailable(false);
    }
    loadConnected()
      .then(setConnected)
      .catch(() => setConnected(false));
    loadPairing()
      .then(setPairing)
      .catch(() => setPairing(null));
  }, []);

  // A gohealthme://pair?code=... link fills the code in, whether it opened the
  // app cold or arrived while it was running. Over a paired screen it means
  // the person is pairing again: the old token is revoked when the new one
  // is issued, by design.
  useEffect(() => {
    const take = (url: string | null): void => {
      const c = codeFromUrl(url);
      if (c === null) return;
      setCode(c);
      setCodeFromLink(true);
      setRepairing(true);
      setFailure(null);
    };
    void Linking.getInitialURL().then(take);
    const sub = Linking.addEventListener("url", ({ url }) => take(url));
    return () => sub.remove();
  }, []);

  const revoked = useCallback(async (): Promise<void> => {
    void listener.current?.stop();
    await clearPairing().catch(() => undefined);
    setPairing(null);
    setLast(null);
    setFailure({ message: REVOKED, retry: "pair" });
  }, []);

  const sync = useCallback(
    async (current: Pairing): Promise<void> => {
      if (syncing.current) return;
      syncing.current = true;
      setBusy("syncing");
      setFailure(null);
      try {
        setLast({ outcome: await syncNow(current.deviceToken, SYNC_DAYS), manual: true });
      } catch (err) {
        // HealthUnreadableError lands here too: its message is the one line
        // the person needs, and the retry is the same button.
        if (err instanceof NotPairedError) {
          await revoked();
        } else {
          setFailure({ message: describe(err), retry: "sync" });
        }
      } finally {
        syncing.current = false;
        setBusy(null);
      }
    },
    [revoked],
  );

  const listen = useCallback(
    async (current: Pairing): Promise<void> => {
      if (listener.current === null) {
        listener.current = createBackgroundListener({
          onSynced: (outcome) => setLast({ outcome, manual: false }),
          onError: (err) => {
            if (err instanceof NotPairedError) void revoked();
            else console.warn("[background]", describe(err));
          },
        });
      }
      await listener.current.listen(current.deviceToken);
    },
    [revoked],
  );

  // Allow Apple Health, then listen for it and read the first month. The
  // sheet is asked for exactly once per phone; iOS shows nothing on a second
  // request, so asking again would be a tap that does nothing.
  const connect = useCallback(
    async (current: Pairing): Promise<void> => {
      setBusy("connecting");
      setFailure(null);
      try {
        await requestPermissions();
        await saveConnected().catch(() => undefined);
        setConnected(true);
      } catch (err) {
        setFailure({ message: describe(err), retry: "connect" });
        setBusy(null);
        return;
      }
      await listen(current);
      await sync(current);
    },
    [listen, sync],
  );

  const pair = useCallback(async (): Promise<void> => {
    setBusy("pairing");
    setFailure(null);
    let result: Pairing;
    try {
      result = await redeemCode(code.trim());
      await savePairing(result);
    } catch (err) {
      setFailure({ message: describe(err), retry: "pair" });
      setBusy(null);
      return;
    }
    setPairing(result);
    setLast(null);
    setRepairing(false);
    setCode("");
    setCodeFromLink(false);
    if (connected) {
      await listen(result);
      await sync(result);
    } else {
      await connect(result);
    }
  }, [code, connected, connect, listen, sync]);

  // Once paired and allowed: listen for background delivery, sync on launch
  // and every time the app comes to the front. A launch in the background
  // (HealthKit woke us) skips the launch sync; the delivery itself syncs.
  useEffect(() => {
    if (pairing === null || pairing === undefined || !connected) return;
    void listen(pairing);
    if (AppState.currentState === "active") void sync(pairing);
    const sub = AppState.addEventListener("change", (state) => {
      if (state === "active") void sync(pairing);
    });
    return () => {
      sub.remove();
      void listener.current?.stop();
    };
  }, [pairing, connected, listen, sync]);

  const retry = (): void => {
    if (pairing === null || pairing === undefined || failure === null) return;
    if (failure.retry === "connect") void connect(pairing);
    else if (failure.retry === "sync") void sync(pairing);
  };

  const showPairForm = pairing === null || repairing;
  const codeReady = code.trim().length >= 8;
  const stored = last?.outcome.result.stored ?? 0;
  // One line under the headline, only for a sync this screen asked for and
  // only while no error is showing in its place.
  const notice = last !== null && last.manual && failure === null ? syncNotice(last.outcome) : null;

  return (
    <SafeAreaView style={styles.safe}>
      <ScrollView contentContainerStyle={styles.container} keyboardShouldPersistTaps="handled">
        <Text style={styles.h1}>GoHealthMe</Text>
        <Text style={styles.subtitle}>
          Apple Watch to your wallet. Daily totals only, never raw health data.
        </Text>

        {pairing === undefined ? (
          <ActivityIndicator />
        ) : showPairForm ? (
          <View style={styles.card}>
            <Text style={styles.cardTitle}>
              {pairing === null ? "Pair this iPhone" : "Pair a different wallet"}
            </Text>
            {!codeFromLink && (
              <Text style={styles.hint}>
                On the GoHealthMe website, choose Apple Watch. Open the link it
                shows on this iPhone, or type the code here.
              </Text>
            )}
            <TextInput
              style={[styles.input, styles.codeInput]}
              value={code}
              onChangeText={(v) => {
                setCode(v);
                setCodeFromLink(false);
              }}
              autoCapitalize="characters"
              autoCorrect={false}
              placeholder="XXXX-XXXX"
              maxLength={9}
              editable={busy === null}
            />
            {failure !== null && <Text style={styles.errorLine}>{failure.message}</Text>}
            <Pressable
              style={[styles.button, (busy !== null || !codeReady) && styles.buttonDisabled]}
              onPress={() => void pair()}
              disabled={busy !== null || !codeReady}
            >
              {busy === "pairing" ? (
                <ActivityIndicator color="#fff" />
              ) : (
                <Text style={styles.buttonText}>{failure?.retry === "pair" ? "Try again" : "Pair"}</Text>
              )}
            </Pressable>
            {pairing !== null && busy === null && (
              <Pressable
                onPress={() => {
                  setRepairing(false);
                  setCode("");
                  setCodeFromLink(false);
                  setFailure(null);
                }}
              >
                <Text style={styles.link}>Keep {shortAddress(pairing.address)}</Text>
              </Pressable>
            )}
          </View>
        ) : (
          <View style={styles.card}>
            <Text style={styles.headline}>
              {last !== null
                ? stored > 0
                  ? `Synced ${last.outcome.daysWithData} days for ${shortAddress(pairing.address)}`
                  : `Nothing synced for ${shortAddress(pairing.address)}`
                : busy === "syncing"
                  ? "Syncing Apple Health"
                  : busy === "connecting"
                    ? "Waiting for Apple Health"
                    : connected
                      ? `Paired with ${shortAddress(pairing.address)}`
                      : "Allow Apple Health to finish"}
            </Text>

            {notice !== null && (
              <Text style={stored === 0 ? styles.errorLine : styles.hint}>{notice}</Text>
            )}

            {failure !== null && <Text style={styles.errorLine}>{failure.message}</Text>}

            {busy !== null ? (
              <ActivityIndicator style={styles.spinner} />
            ) : failure !== null ? (
              <Pressable style={styles.button} onPress={retry}>
                <Text style={styles.buttonText}>Try again</Text>
              </Pressable>
            ) : !connected ? (
              <Pressable style={styles.button} onPress={() => void connect(pairing)}>
                <Text style={styles.buttonText}>Allow Apple Health</Text>
              </Pressable>
            ) : last !== null && stored === 0 ? (
              <Pressable style={styles.button} onPress={() => void sync(pairing)}>
                <Text style={styles.buttonText}>Try again</Text>
              </Pressable>
            ) : null}

            <Text style={styles.label}>Paired wallet</Text>
            <Text style={styles.mono}>{pairing.address}</Text>
            {connected && (
              <Text style={styles.hint}>
                Syncs on its own when Apple Health changes, and every time you open
                this app.
              </Text>
            )}
            {busy === null && (
              <Pressable
                onPress={() => {
                  setRepairing(true);
                  setFailure(null);
                }}
              >
                <Text style={styles.link}>Pair a different wallet</Text>
              </Pressable>
            )}
          </View>
        )}

        {available === false && (
          <Text style={styles.errorLine}>
            Apple Health is not available on this device. It needs a real iPhone, not
            the simulator.
          </Text>
        )}

        <Text style={styles.footer}>Platform: {Platform.OS}</Text>
      </ScrollView>
    </SafeAreaView>
  );
}

const mono = Platform.OS === "ios" ? "Menlo" : "monospace";

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: "#faf6ee" },
  container: { padding: 20, gap: 12 },
  h1: { fontSize: 30, fontWeight: "800", color: "#16211b" },
  subtitle: { fontSize: 13, color: "#5f6f64", marginBottom: 6 },
  card: {
    backgroundColor: "#ffffff",
    borderRadius: 16,
    padding: 16,
    borderWidth: 1,
    borderColor: "#ece3d2",
    gap: 10,
  },
  cardTitle: { fontSize: 15, fontWeight: "700", color: "#16211b" },
  headline: { fontSize: 20, fontWeight: "800", color: "#16211b", lineHeight: 26 },
  label: { fontSize: 12, fontWeight: "600", color: "#5f6f64", marginTop: 6 },
  mono: { fontSize: 12, color: "#16211b", fontFamily: mono },
  input: {
    borderWidth: 1,
    borderColor: "#ece3d2",
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 12,
    fontSize: 13,
    color: "#16211b",
    fontFamily: mono,
  },
  hint: { fontSize: 12, color: "#5f6f64", lineHeight: 17 },
  errorLine: { fontSize: 13, color: "#9f1d1d", lineHeight: 18 },
  codeInput: { fontSize: 22, letterSpacing: 4, textAlign: "center" },
  link: { fontSize: 13, color: "#064e3b", fontWeight: "600", marginTop: 4 },
  button: {
    backgroundColor: "#059669",
    borderRadius: 12,
    paddingVertical: 15,
    alignItems: "center",
  },
  buttonText: { color: "#faf6ee", fontSize: 16, fontWeight: "700" },
  buttonDisabled: { opacity: 0.5 },
  spinner: { paddingVertical: 12 },
  footer: { fontSize: 10, color: "#8a9089", textAlign: "center", marginTop: 4 },
});
