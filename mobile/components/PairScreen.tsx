// The standalone pairing screen: the app before it had the website inside.
//
// It stands in when a page cannot load, so a person who arrived from a
// Safari pairing link is never stranded: one line names what could not be
// reached (GoHealthMe itself, or a third-party page the site sent them to),
// one button goes back to the site, and the code field and Pair button below
// still work the moment the network is back.
//
// The screen never claims success on its own. iOS does not tell an app what
// the user granted on the HealthKit sheet, so the only honest proof is how
// many days the server says it stored, and that is what is shown.
//
// The look is Night Shift, the website's system, from lib/theme.ts.

import React, { useEffect, useState } from "react";
import {
  ActivityIndicator,
  Image,
  type ImageSourcePropType,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";

import { syncNotice } from "../lib/sync";
import { colors, controls, noticeTones, space, type, type NoticeTone } from "../lib/theme";
import type { ApplePairing } from "../lib/use-apple-pairing";

/** The brand mark: the otter, the same file as the app icon. */
const OTTER: ImageSourcePropType = require("../assets/icon.png");

const COULD_NOT_REACH = "The app could not reach GoHealthMe.";

function shortAddress(address: string): string {
  return `${address.slice(0, 6)}...${address.slice(-4)}`;
}

/** One quiet row with a left accent bar, like the web's Notice. Presentation only. */
function Notice({ tone, children }: { tone: NoticeTone; children: string }): React.JSX.Element {
  const t = noticeTones[tone];
  return (
    <View
      style={[controls.notice, { backgroundColor: t.background, borderColor: t.border }]}
      accessibilityRole={tone === "error" ? "alert" : undefined}
    >
      <View style={[controls.noticeBar, { backgroundColor: t.bar }]} />
      <Text style={[controls.noticeText, { color: t.text }]}>{children}</Text>
    </View>
  );
}

export interface PairScreenProps {
  pairing: ApplePairing;
  /** A code from a gohealthme://pair link, filled in so the only tap is Pair. */
  initialCode: string | null;
  /** What did not load (host null means GoHealthMe itself), and the way back. */
  loadError: { retry: () => void; host: string | null } | null;
}

export function PairScreen({ pairing: p, initialCode, loadError }: PairScreenProps): React.JSX.Element {
  const [code, setCode] = useState(initialCode ?? "");
  const [codeFromLink, setCodeFromLink] = useState(initialCode !== null);
  // The pair form over a paired screen: a new link arrived, or the person
  // asked to pair a different wallet.
  const [repairing, setRepairing] = useState(initialCode !== null);

  useEffect(() => {
    if (initialCode === null) return;
    setCode(initialCode);
    setCodeFromLink(true);
    setRepairing(true);
  }, [initialCode]);

  const pair = async (): Promise<void> => {
    const result = await p.pairWithCode(code);
    if (result?.pairing) {
      setRepairing(false);
      setCode("");
      setCodeFromLink(false);
    }
  };

  const { pairing, connected, busy, last, failure, available } = p;
  const showPairForm = pairing === null || repairing;
  const codeReady = code.trim().length >= 8;
  const stored = last?.outcome.result.stored ?? 0;
  // One line under the headline, only for a sync this screen asked for and
  // only while no error is showing in its place.
  const notice = last !== null && last.manual && failure === null ? syncNotice(last.outcome) : null;

  // The Pair button is disabled while busy or until a code is in; it only
  // dims when the person could not press it anyway, never while it is working.
  const pairDisabled = busy !== null || !codeReady;
  const pairDimmed = pairDisabled && busy !== "pairing";

  return (
    <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === "ios" ? "padding" : undefined}>
      <ScrollView
        contentContainerStyle={styles.container}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="interactive"
      >
        <View style={styles.brand}>
          <View style={styles.brandRow}>
            <Image source={OTTER} style={styles.mark} accessibilityIgnoresInvertColors />
            <Text style={type.wordmark}>GoHealthMe</Text>
          </View>
          <Text style={type.body}>
            Apple Watch to your wallet. Daily totals only, never raw health data.
          </Text>
        </View>

        {loadError !== null && (
          <View style={styles.offline}>
            <Notice tone="error">
              {loadError.host === null ? COULD_NOT_REACH : `The app could not reach ${loadError.host}.`}
            </Notice>
            <Pressable
              style={({ pressed }) => [controls.buttonSecondary, pressed && controls.buttonPressed]}
              onPress={loadError.retry}
              accessibilityRole="button"
            >
              <Text style={type.buttonSecondary}>
                {loadError.host === null ? "Try again" : "Back to GoHealthMe"}
              </Text>
            </Pressable>
          </View>
        )}

        {pairing === undefined ? (
          <ActivityIndicator color={colors.haze} style={styles.spinner} />
        ) : showPairForm ? (
          <View style={controls.card}>
            <Text style={type.heading}>
              {pairing === null ? "Pair this iPhone" : "Pair a different wallet"}
            </Text>
            {!codeFromLink && (
              <Text style={type.body}>
                On the GoHealthMe website, choose Apple Watch. Open the link it
                shows on this iPhone, or type the code here.
              </Text>
            )}
            <TextInput
              style={[controls.field, styles.codeInput]}
              value={code}
              onChangeText={(v) => {
                setCode(v);
                setCodeFromLink(false);
              }}
              autoCapitalize="characters"
              autoCorrect={false}
              placeholder="XXXX-XXXX"
              placeholderTextColor={colors.haze}
              keyboardAppearance="dark"
              selectionColor={colors.moonlight}
              returnKeyType="done"
              maxLength={9}
              editable={busy === null}
            />
            <Pressable
              style={({ pressed }) => [
                controls.buttonPrimary,
                pressed && !pairDisabled && controls.buttonPressed,
                pairDimmed && controls.buttonDisabled,
              ]}
              onPress={() => void pair()}
              disabled={pairDisabled}
              accessibilityRole="button"
            >
              {busy === "pairing" ? (
                <ActivityIndicator color={colors.accentForeground} />
              ) : (
                <Text style={[type.buttonPrimary, pairDimmed && styles.buttonTextDimmed]}>
                  {failure?.retry === "pair" ? "Try again" : "Pair"}
                </Text>
              )}
            </Pressable>
            {failure !== null && <Text style={type.danger}>{failure.message}</Text>}
            {pairing !== null && busy === null && (
              <Pressable
                style={controls.textAction}
                accessibilityRole="button"
                onPress={() => {
                  setRepairing(false);
                  setCode("");
                  setCodeFromLink(false);
                }}
              >
                <Text style={type.link}>Keep {shortAddress(pairing.address)}</Text>
              </Pressable>
            )}
          </View>
        ) : (
          <View style={controls.card}>
            <Text style={type.display}>
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

            {notice !== null && <Notice tone={stored === 0 ? "limit" : "info"}>{notice}</Notice>}

            {failure !== null && <Notice tone="error">{failure.message}</Notice>}

            {busy !== null ? (
              <ActivityIndicator color={colors.haze} style={styles.spinner} />
            ) : failure !== null ? (
              <Pressable
                style={({ pressed }) => [controls.buttonSecondary, pressed && controls.buttonPressed]}
                onPress={p.retry}
                accessibilityRole="button"
              >
                <Text style={type.buttonSecondary}>Try again</Text>
              </Pressable>
            ) : !connected ? (
              <Pressable
                style={({ pressed }) => [controls.buttonPrimary, pressed && controls.buttonPressed]}
                onPress={() => void p.syncNow()}
                accessibilityRole="button"
              >
                <Text style={type.buttonPrimary}>Allow Apple Health</Text>
              </Pressable>
            ) : last !== null && stored === 0 ? (
              <Pressable
                style={({ pressed }) => [controls.buttonSecondary, pressed && controls.buttonPressed]}
                onPress={() => void p.syncNow()}
                accessibilityRole="button"
              >
                <Text style={type.buttonSecondary}>Try again</Text>
              </Pressable>
            ) : null}

            <View style={styles.wallet}>
              <Text style={type.label}>Paired wallet</Text>
              <Text style={type.mono} selectable>
                {pairing.address}
              </Text>
            </View>
            {connected && (
              <Text style={type.body}>
                Syncs on its own when Apple Health changes, and every time you open
                this app.
              </Text>
            )}
            {busy === null && (
              <Pressable
                style={controls.textAction}
                accessibilityRole="button"
                onPress={() => setRepairing(true)}
              >
                <Text style={type.link}>Pair a different wallet</Text>
              </Pressable>
            )}
          </View>
        )}

        {available === false && (
          <Notice tone="limit">
            Apple Health is not available on this device. It needs a real iPhone, not
            the simulator.
          </Notice>
        )}

        <Text style={styles.footer}>GoHealthMe beta</Text>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

// Screen layout only; colours, type and controls come from lib/theme.ts.
const styles = StyleSheet.create({
  flex: { flex: 1 },
  container: {
    flexGrow: 1,
    paddingHorizontal: space.gutter,
    paddingTop: space.lg,
    paddingBottom: space.xxl,
    gap: space.xxl,
  },
  brand: { gap: space.sm },
  brandRow: { flexDirection: "row", alignItems: "center", gap: space.md },
  mark: { width: 32, height: 32, borderRadius: 16 },
  offline: { gap: space.md },
  // The code reads as the website shows it: mono, semibold, wide tracking, centred.
  codeInput: {
    fontFamily: type.mono.fontFamily,
    fontSize: 24,
    fontWeight: "600",
    letterSpacing: 5,
    textAlign: "center",
  },
  buttonTextDimmed: { color: colors.haze },
  wallet: { gap: space.xs },
  spinner: { paddingVertical: space.md, alignSelf: "flex-start" },
  footer: { ...type.fine, marginTop: "auto", paddingTop: space.lg },
});
