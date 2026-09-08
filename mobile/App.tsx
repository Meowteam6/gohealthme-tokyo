// GoHealthMe iPhone app: Apple Watch data into your GoHealthMe wallet.
//
// One screen. Connect asks HealthKit for read access, aggregates the last 30
// days on device, and posts the daily numbers to GoHealthMe. Raw samples never
// leave the phone.
//
// The screen deliberately never claims success on its own. iOS does not tell an
// app what the user granted on the HealthKit sheet, so the only honest proof is
// how many day rows the server says it stored.

import React, { useEffect, useState } from "react";
import {
  ActivityIndicator,
  Platform,
  Pressable,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";

import { apiBase, devSignerAddress } from "./lib/api";
import { healthDataAvailable, requestPermissions } from "./lib/healthkit";
import { syncNow } from "./lib/sync";

type Phase = "idle" | "working" | "done" | "error";

const SYNC_DAYS = 30;

export default function App(): React.JSX.Element {
  const [address, setAddress] = useState<string>(() => {
    try {
      return devSignerAddress();
    } catch {
      return "";
    }
  });
  const [phase, setPhase] = useState<Phase>("idle");
  const [sent, setSent] = useState<number | null>(null);
  const [stored, setStored] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [log, setLog] = useState<string[]>([]);
  const [available, setAvailable] = useState<boolean | null>(null);

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
  }, []);

  const busy = phase === "working";

  const run = async (askFirst: boolean): Promise<void> => {
    setError(null);
    setPhase("working");
    try {
      if (askFirst) {
        addLine("Asking for Apple Health read access");
        await requestPermissions();
        // iOS hides grant and deny from apps by design, so there is nothing
        // truthful to report here beyond "the sheet was shown".
        addLine("Permission sheet closed. iOS does not say what was allowed.");
      }

      addLine(`Reading the last ${SYNC_DAYS} days and aggregating on device`);
      const { sent: sentRows, result } = await syncNow(address, SYNC_DAYS);
      setSent(sentRows);
      setStored(result.stored);
      addLine(`Sent ${sentRows} day rows, server stored ${result.stored}`);
      setPhase("done");
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setError(message);
      addLine(`ERROR: ${message}`);
      setPhase("error");
    }
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

        <View style={styles.card}>
          <Text style={styles.label}>Wallet</Text>
          <TextInput
            style={styles.input}
            value={address}
            onChangeText={setAddress}
            autoCapitalize="none"
            autoCorrect={false}
            placeholder="0x..."
            editable={!busy}
          />
          <Text style={styles.label}>Sending to</Text>
          <Text style={styles.mono}>{apiBase()}</Text>
          <Text style={styles.hint}>
            Every post is signed by this wallet. Without that signature anyone
            who knew your address could send step counts on your behalf.
          </Text>
        </View>

        {available === false && (
          <View style={[styles.banner, styles.bannerWarn]}>
            <Text style={styles.bannerText}>
              Apple Health is not available on this device. HealthKit needs a
              real iPhone; it does not exist in the simulator.
            </Text>
          </View>
        )}

        <Pressable
          style={[styles.button, busy && styles.buttonDisabled]}
          onPress={() => run(true)}
          disabled={busy}
        >
          {busy ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <Text style={styles.buttonText}>Connect Apple Health</Text>
          )}
        </Pressable>

        <Pressable
          style={[
            styles.buttonSecondary,
            (busy || phase === "idle") && styles.buttonDisabled,
          ]}
          onPress={() => run(false)}
          disabled={busy || phase === "idle"}
        >
          <Text style={styles.buttonSecondaryText}>Sync again</Text>
        </Pressable>

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
  button: {
    backgroundColor: "#059669",
    borderRadius: 12,
    paddingVertical: 15,
    alignItems: "center",
  },
  buttonText: { color: "#faf6ee", fontSize: 16, fontWeight: "700" },
  buttonSecondary: {
    backgroundColor: "#e7f2ed",
    borderWidth: 1,
    borderColor: "#ece3d2",
    borderRadius: 12,
    paddingVertical: 13,
    alignItems: "center",
  },
  buttonSecondaryText: { color: "#064e3b", fontSize: 15, fontWeight: "700" },
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
