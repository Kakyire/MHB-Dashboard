import { initializeApp } from "firebase/app";
import { getAuth, GoogleAuthProvider } from "firebase/auth";
import { getFunctions } from "firebase/functions";
import { ReCaptchaEnterpriseProvider, initializeAppCheck } from "firebase/app-check";

const requiredConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY ?? "",
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN ?? "",
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID ?? "",
  appId: import.meta.env.VITE_FIREBASE_APP_ID ?? "",
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID ?? "",
};
const appCheckSiteKey = import.meta.env.VITE_FIREBASE_APP_CHECK_SITE_KEY ?? "";

const missingKeys = [
  ...Object.entries(requiredConfig),
  ["appCheckSiteKey", appCheckSiteKey],
]
  .filter(([, value]) => !value)
  .map(([key]) => key);

export const firebaseConfigurationError = missingKeys.length > 0
  ? `Missing dashboard Firebase configuration: ${missingKeys.join(", ")}`
  : null;

const app = initializeApp(requiredConfig);

if (!firebaseConfigurationError) {
  initializeAppCheck(app, {
    provider: new ReCaptchaEnterpriseProvider(appCheckSiteKey),
    isTokenAutoRefreshEnabled: true,
  });
}

export const auth = firebaseConfigurationError ? null : getAuth(app);
export const functions = firebaseConfigurationError ? null : getFunctions(app, "us-central1");
export const googleProvider = new GoogleAuthProvider();
googleProvider.setCustomParameters({ prompt: "select_account" });
