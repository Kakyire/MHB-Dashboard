import { initializeApp } from "firebase/app";
import { browserSessionPersistence, getAuth, GoogleAuthProvider, setPersistence } from "firebase/auth";
import { getFunctions } from "firebase/functions";
import { getToken, ReCaptchaEnterpriseProvider, initializeAppCheck } from "firebase/app-check";

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

const appCheck = firebaseConfigurationError
  ? null
  : initializeAppCheck(app, {
    provider: new ReCaptchaEnterpriseProvider(appCheckSiteKey),
    isTokenAutoRefreshEnabled: true,
  });

/** Ensures an App Check token exists before calling a protected admin endpoint. */
export async function requireAppCheckToken(): Promise<void> {
  if (!appCheck) throw new Error("App Check is not configured for this dashboard.");
  try {
    await getToken(appCheck, false);
  } catch {
    throw new Error("App Check could not verify this dashboard. Register the production Web app with its reCAPTCHA Enterprise key in Firebase App Check, then refresh this page.");
  }
}

export const auth = firebaseConfigurationError ? null : getAuth(app);
/**
 * Source-management sessions must not survive a browser restart. The UI adds
 * a shorter inactivity timeout before this Firebase session can be reused.
 */
export const authReady = auth ? setPersistence(auth, browserSessionPersistence) : Promise.resolve();
export const functions = firebaseConfigurationError ? null : getFunctions(app, "us-central1");
export const googleProvider = new GoogleAuthProvider();
googleProvider.setCustomParameters({ prompt: "select_account" });
