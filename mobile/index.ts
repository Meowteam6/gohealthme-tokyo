// App entry point.
//
// react-native-get-random-values MUST be imported before viem (used by
// lib/api.ts to sign the wallet-auth message). Hermes has no
// crypto.getRandomValues of its own, and viem's signing code expects it to
// exist. Importing this shim first installs it globally.
import "react-native-get-random-values";
import { registerRootComponent } from "expo";

import App from "./App";

registerRootComponent(App);
