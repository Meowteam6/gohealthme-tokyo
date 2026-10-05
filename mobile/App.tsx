// GoHealthMe iPhone app: Apple Watch data into your GoHealthMe wallet.
//
// Two steps, once each. Pair: type the code the GoHealthMe website showed you
// (or open its link), and this phone is tied to that wallet. Connect: allow
// Apple Health, and the last 30 days of daily totals are aggregated on device
// and posted. After that the app syncs every time it is opened. Raw samples
// never leave the phone.
//
// The screen deliberately never claims success on its own. iOS does not tell an
// app what the user granted on the HealthKit sheet, so the only honest proof is
// how many day rows the server says it stored.

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

import { apiBase, NotPairedError, redeemCode, type Pairing } from "./lib/api";
import { healthDataAvailable, requestPermissions } from "./lib/healthkit";
import {
  clearPairing,
  codeFromUrl,
  loadConnected,
  loadPairing,
  saveConnected,
  savePairing,
} from "./lib/pairing-store";
import { syncNow } from "./lib/sync";

type Phase = "idle" | "working" | "done" | "error";

const SYNC_DAYS = 30;

function shortAddress(address: string): string {
  return `${address.slice(0, 6)}...${address.slice(-4)}`;
}

export default function App(): React.JSX.Element {
  // undefined while the Keychain is being read, null when unpaired.
  const [pairing, setPairing] = useState<Pairing | null | undefined>(undefined);
  const [code, setCode] = useState("");
  const [pairing_busy, setPairingBusy] = useState(false);
  const [pairError, setPairError] = useState<string | null>(null);
  const [phase, setPhase] = useState<Phase>("idle");
  const [sent, setSent] = useState<number | null>(null);
  const [stored, setStored] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [log, setLog] = useState<string[]>([]);
  const [available, setAvailable] = useState<boolean | null>(null);
  const [lastSync, setLastSync] = useState<Date | null>(null);
  const [connected, setConnected] = useState(false);
  const syncing = useRef(false);

  const addLine = (line: string): void =>
    setLog((prev) => [
      ...prev.slice(-99),
      `${new Date().toLocaleTimeString()}  ${line}`,
    ]);

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
  // app cold or arrived while it was running.
  useEffect(() => {
    void Linking.getInitialURL().then((url) => {
      const c = codeFromUrl(url);
      if (c !== null) setCode(c);
    });
    const sub = Linking.addEventListener("url", ({ url }) => {
      const c = codeFromUrl(url);
      if (c !== null) setCode(c);
    });
    return () => sub.remove();
  }, []);

  const busy = phase === "working";

  const run = useCallback(
    async (askFirst: boolean, current: Pairing): Promise<void> => {
      if (syncing.current) return;
      syncing.current = true;
      setError(null);
      setPhase("working");
      try {
        if (askFirst) {
          addLine("Asking for Apple Health read access");
          await requestPermissions();
          // iOS hides grant and deny from apps by design, so there is nothing
          // truthful to report here beyond "the sheet was shown".
          addLine("Permission sheet closed. iOS does not say what was allowed.");
          await saveConnected().catch(() => undefined);
          setConnected(true);
        }

        addLine(`Reading the last ${SYNC_DAYS} days and aggregating on device`);
        const { sent: sentRows, result } = await syncNow(current.deviceToken, SYNC_DAYS);
        setSent(sentRows);
        setStored(result.stored);
        setLastSync(new Date());
        addLine(`Sent ${sentRows} day rows, server stored ${result.stored}`);
        setPhase("done");
      } catch (err) {
        if (err instanceof NotPairedError) {
          // Revoked: this wallet paired another phone, or the pairing is gone.
          await clearPairing().catch(() => undefined);
          setPairing(null);
          setPairError(
            "This iPhone is no longer paired. Get a new code on the GoHealthMe website and pair again.",
          );
          setPhase("idle");
          return;
        }
        const message = err instanceof Error ? err.message : String(err);
        setError(message);
        addLine(`ERROR: ${message}`);
        setPhase("error");
      } finally {
        syncing.current = false;
      }
    },
    [],
  );

  // Once paired and connected, sync on launch and every time the app comes to
  // the front, so a goal's days are on the server before the verdict reads
  // them. Never before the player tapped Connect: that read would be empty.
  useEffect(() => {
    if (pairing === null || pairing === undefined || !connected) return;
    void run(false, pairing);
    const sub = AppState.addEventListener("change", (state) => {
      if (state === "active") void run(false, pairing);
    });
    return () => sub.remove();
  }, [pairing, connected, run]);

  const pair = async (): Promise<void> => {
    setPairError(null);
    setPairingBusy(true);
    try {
      const result = await redeemCode(code.trim());
      await savePairing(result);
      setPairing(result);
      setCode("");
      addLine(`Paired with ${shortAddress(result.address)}`);
    } catch (err) {
      setPairError(err instanceof Error ? err.message : String(err));
    } finally {
      setPairingBusy(false);
    }
  };

  const unpair = async (): Promise<void> => {
    await clearPairing().catch(() => undefined);
    setPairing(null);
    setPhase("idle");
    setSent(null);
    setStored(null);
  };

  const verdict = ((): { title: string; body: string; good: boolean } | null => {
    if (phase !== "done" || stored === null) return null;
    if (stored > 0) {
      return {
        good: true,
        title: `${stored} days of Apple Health are now in your wallet`,
        body:
          "GoHealthMe can verify a goal from this. Only the daily totals were " +
          "sent: no individual readings, no times, no locations.",
      };
    }
    return {
      good: false,
      title: "Nothing was sent, and this is inconclusive",
      body:
        "Three things look identical from here and iOS will not tell an app " +
        "which one happened: Apple Health has no data for the last " +
        `${SYNC_DAYS} days, the watch has not synced to this iPhone yet, or ` +
        "access was denied on the permission sheet. Check the Health app has " +
        "data, then run it again.",
    };
  })();

  return (
    <SafeAreaView style={styles.safe}>
      <ScrollView contentContainerStyle={styles.container}>
        <Text style={styles.h1}>GoHealthMe</Text>
        <Text style={styles.subtitle}>
          Apple Watch to your wallet. Daily totals only, never raw health data.
        </Text>

        {pairing === undefined ? (
          <ActivityIndicator />
        ) : pairing === null ? (
          <View style={styles.card}>
            <Text style={styles.cardTitle}>Pair this iPhone</Text>
            <Text style={styles.hint}>
              On the GoHealthMe website, choose Apple Health as your wearable.
              It shows a code. Type it here, or open the link it gives you on
              this iPhone.
            </Text>
            <TextInput
              style={[styles.input, styles.codeInput]}
              value={code}
              onChangeText={setCode}
              autoCapitalize="characters"
              autoCorrect={false}
              placeholder="XXXX-XXXX"
              maxLength={9}
              editable={!pairing_busy}
            />
            <Pressable
              style={[styles.button, (pairing_busy || code.trim().length < 8) && styles.buttonDisabled]}
              onPress={() => void pair()}
              disabled={pairing_busy || code.trim().length < 8}
            >
              {pairing_busy ? (
                <ActivityIndicator color="#fff" />
              ) : (
                <Text style={styles.buttonText}>Pair</Text>
              )}
            </Pressable>
            {pairError && (
              <View style={[styles.banner, styles.bannerError]}>
                <Text style={styles.bannerText}>{pairError}</Text>
              </View>
            )}
            <Text style={styles.hint}>Pairing with {apiBase()}</Text>
          </View>
        ) : (
          <>
            <View style={styles.card}>
              <Text style={styles.label}>Paired wallet</Text>
              <Text style={styles.mono}>{shortAddress(pairing.address)}</Text>
              {lastSync && (
                <Text style={styles.hint}>
                  Last synced {lastSync.toLocaleTimeString()}. Opening this app
                  syncs again.
                </Text>
              )}
              <Pressable onPress={() => void unpair()} disabled={busy}>
                <Text style={styles.link}>Pair a different wallet</Text>
              </Pressable>
            </View>

            {available === false && (
              <View style={[styles.banner, styles.bannerWarn]}>
                <Text style={styles.bannerText}>
                  Apple Health is not available on this device. HealthKit needs
                  a real iPhone; it does not exist in the simulator.
                </Text>
              </View>
            )}

            <Pressable
              style={[styles.button, busy && styles.buttonDisabled]}
              onPress={() => void run(true, pairing)}
              disabled={busy}
            >
              {busy ? (
                <ActivityIndicator color="#fff" />
              ) : (
                <Text style={styles.buttonText}>
                  {connected ? "Sync now" : "Connect Apple Health"}
                </Text>
              )}
            </Pressable>
          </>
        )}

        {error && (
          <View style={[styles.banner, styles.bannerError]}>
            <Text style={styles.bannerText}>{error}</Text>
          </View>
        )}

        {verdict && (
          <View
            style={[
              styles.banner,
              verdict.good ? styles.bannerGood : styles.bannerWarn,
            ]}
          >
            <Text style={styles.bannerTitle}>{verdict.title}</Text>
            <Text style={styles.bannerText}>{verdict.body}</Text>
          </View>
        )}

        {sent !== null && (
          <View style={styles.card}>
            <Text style={styles.cardTitle}>Last sync</Text>
            <Row k="day rows sent" v={String(sent)} />
            <Row k="stored by server" v={stored === null ? "-" : String(stored)} />
            <Row k="window" v={`${SYNC_DAYS} days`} />
          </View>
        )}

        <View style={styles.card}>
          <Text style={styles.cardTitle}>Log</Text>
          {log.length === 0 ? (
            <Text style={styles.hint}>No activity yet.</Text>
          ) : (
            log.map((line, i) => (
              <Text key={i} style={styles.logLine}>
                {line}
              </Text>
            ))
          )}
        </View>

        <Text style={styles.footer}>Platform: {Platform.OS}</Text>
      </ScrollView>
    </SafeAreaView>
  );
}

function Row({ k, v }: { k: string; v: string }): React.JSX.Element {
  return (
    <View style={styles.row}>
      <Text style={styles.rowKey}>{k}</Text>
      <Text style={styles.rowVal}>{v}</Text>
    </View>
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
    gap: 6,
  },
  cardTitle: {
    fontSize: 15,
    fontWeight: "700",
    color: "#16211b",
    marginBottom: 4,
  },
  label: { fontSize: 12, fontWeight: "600", color: "#5f6f64" },
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
  hint: { fontSize: 11, color: "#5f6f64", lineHeight: 15 },
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
  banner: { borderRadius: 12, padding: 14, gap: 4 },
  bannerGood: {
    backgroundColor: "#e7f2ed",
    borderWidth: 1,
    borderColor: "#a9dcc2",
  },
  bannerWarn: {
    backgroundColor: "#fdf3e0",
    borderWidth: 1,
    borderColor: "#f0d69a",
  },
  bannerError: {
    backgroundColor: "#fdecea",
    borderWidth: 1,
    borderColor: "#f2b8b0",
  },
  bannerTitle: { fontSize: 14, fontWeight: "700", color: "#16211b" },
  bannerText: { fontSize: 12, color: "#3d4a43", lineHeight: 17 },
  row: {
    flexDirection: "row",
    justifyContent: "space-between",
    paddingVertical: 3,
  },
  rowKey: { fontSize: 12, color: "#5f6f64", fontFamily: mono },
  rowVal: { fontSize: 12, color: "#16211b", fontWeight: "600", fontFamily: mono },
  logLine: { fontSize: 11, color: "#3d4a43", fontFamily: mono, lineHeight: 16 },
  footer: { fontSize: 10, color: "#8a9089", textAlign: "center", marginTop: 4 },
});
