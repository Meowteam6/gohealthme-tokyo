// The GoHealthMe website inside the iPhone app.
//
// Everything a player does (sign in with email, join and create challenges,
// stake test USDC, verdicts, payouts, the name claim) is the website's own
// in-page code, so the app shows the site and adds the two things only a
// native app can do: read Apple Health and hold the pairing token in the
// Keychain. The page and the shell talk through lib/shell/bridge.ts; where
// a navigation goes is decided by lib/shell/route-request.ts.
//
// ROUTING, load-bearing. originWhitelist={ORIGIN_WHITELIST} (everything) is
// what lets classify decide at all: react-native-webview checks that list
// before onShouldStartLoadWithRequest and, on iOS, drops any URL it rejects
// (Linking.canOpenURL is false without LSApplicationQueriesSchemes). With the
// default of http and https only, gohealthme://pair and every wallet or
// World App scheme would never reach classify. classify is the only gate.
//
// SECURITY, not optional. The WebView also visits third-party OAuth pages
// (WHOOP, Junction). A message is acted on only when the WebView's current
// URL is on the site's own origin, a script is injected only while it is,
// and every message is parsed strictly. Nothing here logs a code or token.

import Constants from "expo-constants";
import * as WebBrowser from "expo-web-browser";
import React, { useCallback, useEffect, useImperativeHandle, useRef } from "react";
import { ActivityIndicator, Linking, StyleSheet, View } from "react-native";
import { WebView, type WebViewMessageEvent, type WebViewNavigation, type WebViewProps } from "react-native-webview";

import { apiBase } from "../lib/api";
import {
  isOnOrigin,
  navigateScript,
  originOf,
  parsePageMessage,
  shellEventScript,
  type ShellEvent,
  type ShellStatus,
} from "../lib/shell/bridge";
import { describeLoadFailure } from "../lib/shell/load-failure";
import { ORIGIN_WHITELIST, classify } from "../lib/shell/route-request";
import { colors } from "../lib/theme";

type ShouldStartLoad = NonNullable<WebViewProps["onShouldStartLoadWithRequest"]>;
type OpenWindowEvent = Parameters<NonNullable<WebViewProps["onOpenWindow"]>>[0];
type LoadEndEvent = Parameters<NonNullable<WebViewProps["onLoadEnd"]>>[0];
type LoadErrorEvent = Parameters<NonNullable<WebViewProps["onError"]>>[0];

const SITE = apiBase();
const SITE_ORIGIN = originOf(SITE) ?? SITE;
const VERSION = Constants.expoConfig?.version ?? "0.0.0";
/** Appended to the iPhone user agent; the page detects the shell by it. */
const USER_AGENT_TOKEN = `GoHealthMeShell/${VERSION}`;
/** Runs before any page script, so the page knows it is in the shell from its first render. */
const BEFORE_LOAD = `window.__gohealthmeShell=${JSON.stringify({ v: 1, platform: "ios", version: VERSION })};true;`;

const SHEET: WebBrowser.WebBrowserOpenOptions = {
  toolbarColor: colors.background,
  controlsColor: colors.foreground,
  dismissButtonStyle: "done",
};

export interface WebShellHandle {
  /** Hand the page one event. A no-op while the WebView is off the site. */
  inject(detail: ShellEvent): void;
  reload(): void;
}

/** A page that would not load, as the fallback needs it. */
export interface ShellLoadFailure {
  /** Reloads GoHealthMe when it is what the WebView holds; otherwise leaves the dead third-party page for the site. */
  retry: () => void;
  /** The host that would not load, or null when it was GoHealthMe itself. */
  host: string | null;
  /** iOS's description of the failure. */
  description: string;
}

export interface WebShellProps {
  ref?: React.Ref<WebShellHandle>;
  /** What the page is told about this phone, at load and whenever it changes. */
  status: ShellStatus;
  onPair: (code: string) => void;
  onSync: () => void;
  /** What stands in when a page cannot load. */
  renderFallback: (failure: ShellLoadFailure) => React.ReactElement;
}

function Loading(): React.JSX.Element {
  return (
    <View style={styles.fill}>
      <ActivityIndicator color={colors.haze} />
    </View>
  );
}

export function WebShell({ ref, status, onPair, onSync, renderFallback }: WebShellProps): React.JSX.Element {
  const web = useRef<WebView>(null);
  const currentUrl = useRef<string>(SITE);
  // The last load that failed: what was asked for, and what the WebView held
  // when it failed. Read by renderError, which runs right after onError.
  const failed = useRef<{ requested: string; document: string }>({ requested: SITE, document: "" });
  const statusRef = useRef(status);
  statusRef.current = status;

  const inject = useCallback((detail: ShellEvent): void => {
    if (!isOnOrigin(currentUrl.current, SITE_ORIGIN)) return;
    web.current?.injectJavaScript(shellEventScript(detail));
  }, []);

  const reload = useCallback((): void => {
    web.current?.reload();
  }, []);

  // The way back when a third-party page took the WebView over and then died.
  // Deliberately past inject()'s origin guard: this script only navigates.
  const goHome = useCallback((): void => {
    web.current?.injectJavaScript(navigateScript(SITE));
  }, []);

  useImperativeHandle(ref, () => ({ inject, reload }), [inject, reload]);

  // The page asks for status with "hello" once it is listening; after that
  // it is told again whenever the phone's state changes.
  const pairedAddress = status.paired?.address ?? null;
  useEffect(() => {
    inject({ type: "status", ...statusRef.current });
  }, [inject, status.healthAvailable, pairedAddress, status.healthAsked]);

  // SFSafariViewController takes http(s) only, and one sheet at a time.
  const openInSheet = useCallback(
    async (url: string): Promise<void> => {
      if (originOf(url) === null) return;
      try {
        await WebBrowser.openBrowserAsync(url, SHEET);
      } catch {
        return;
      }
      inject({ type: "browser-closed" });
    },
    [inject],
  );

  const openInSystem = (url: string): void => {
    Linking.openURL(url).catch(() => undefined);
  };

  const onShouldStartLoadWithRequest: ShouldStartLoad = (request) => {
    const decision = classify({
      url: request.url,
      isTopFrame: request.isTopFrame,
      navigationType: request.navigationType,
    });
    if (decision === "allow") return true;
    if (decision.kind === "pair") onPair(decision.code);
    else openInSystem(decision.url);
    return false;
  };

  // target=_blank and window.open: explorer receipts, the ENS app, the
  // faucet, docs. They open over the site in a Safari sheet with Done.
  const onOpenWindow = (event: OpenWindowEvent): void => {
    const url = event.nativeEvent.targetUrl;
    const decision = classify({ url, isTopFrame: true, navigationType: "click" });
    if (decision === "allow") {
      void openInSheet(url);
    } else if (decision.kind === "pair") {
      onPair(decision.code);
    } else {
      openInSystem(decision.url);
    }
  };

  const onMessage = (event: WebViewMessageEvent): void => {
    if (!isOnOrigin(event.nativeEvent.url, SITE_ORIGIN)) return;
    const message = parsePageMessage(event.nativeEvent.data);
    if (message === null) return;
    switch (message.type) {
      case "hello":
        inject({ type: "status", ...statusRef.current });
        return;
      case "pair":
        onPair(message.code);
        return;
      case "sync":
        onSync();
        return;
      case "open-settings":
        // Health access lives in the Health app (Sharing > Apps), not in our
        // own Settings pane; fall back to Settings when Health is not there.
        Linking.openURL("x-apple-health://").catch(() =>
          Linking.openSettings().catch(() => undefined),
        );
        return;
      case "open-browser":
        void openInSheet(message.url);
        return;
    }
  };

  const onNavigationStateChange = (navigation: WebViewNavigation): void => {
    currentUrl.current = navigation.url;
  };

  const onLoadEnd = (event: LoadEndEvent): void => {
    currentUrl.current = event.nativeEvent.url;
  };

  // Runs before onLoadEnd, so currentUrl is still the load that was started
  // (the request that failed); the event's url is what the WebView holds now.
  const onError = (event: LoadErrorEvent): void => {
    failed.current = { requested: currentUrl.current, document: event.nativeEvent.url };
  };

  const renderError = (_domain: string | undefined, _code: number, description: string): React.ReactElement => {
    const { host, recovery } = describeLoadFailure(failed.current.requested, failed.current.document, SITE_ORIGIN);
    return (
      <View style={styles.fill}>
        {renderFallback({ retry: recovery === "home" ? goHome : reload, host, description })}
      </View>
    );
  };

  return (
    <WebView
      ref={web}
      source={{ uri: SITE }}
      style={styles.web}
      originWhitelist={ORIGIN_WHITELIST}
      applicationNameForUserAgent={USER_AGENT_TOKEN}
      injectedJavaScriptBeforeContentLoaded={BEFORE_LOAD}
      injectedJavaScriptObject={status}
      onMessage={onMessage}
      onShouldStartLoadWithRequest={onShouldStartLoadWithRequest}
      onOpenWindow={onOpenWindow}
      onNavigationStateChange={onNavigationStateChange}
      onLoadEnd={onLoadEnd}
      onError={onError}
      onContentProcessDidTerminate={reload}
      incognito={false}
      cacheEnabled
      useSharedProcessPool
      allowsBackForwardNavigationGestures
      pullToRefreshEnabled
      keyboardDisplayRequiresUserAction={false}
      hideKeyboardAccessoryView
      contentInsetAdjustmentBehavior="never"
      allowsLinkPreview={false}
      startInLoadingState
      renderLoading={() => <Loading />}
      renderError={renderError}
      webviewDebuggingEnabled={__DEV__}
    />
  );
}

const styles = StyleSheet.create({
  web: { flex: 1, backgroundColor: colors.background },
  fill: { ...StyleSheet.absoluteFillObject, backgroundColor: colors.background, justifyContent: "center" },
});
