/**
 * Push notifications via DIRECT Firebase Cloud Messaging
 * (@react-native-firebase/messaging) — NOT Expo notifications.
 *
 * Delivers real Android system notifications when the app is open,
 * backgrounded, or fully closed, and deep-links to the right screen on tap.
 *
 * Requires a DEV / PRODUCTION build (config plugin @react-native-firebase/app
 * + google-services.json). In Expo Go the native module is absent, so every
 * call here no-ops safely (guarded require) — the app never crashes.
 *
 * The in-app notification bell is unchanged: it reads Notification rows from
 * the backend. FCM is a parallel delivery channel for the SAME event, so it
 * never creates duplicate bell entries.
 *
 * Public API (unchanged names so callers don't need edits):
 *   configurePushHandler()  — set up foreground + tap/deep-link listeners
 *   syncPushToken()         — request permission, get FCM token, register it
 *   unregisterPushToken()   — detach this device on logout
 */
import { Platform, PermissionsAndroid } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { router } from 'expo-router';
import { notificationAPI } from './api';

const TOKEN_KEY = 'erm-fcm-token';
let _cachedToken: string | null = null;

// Whether native Firebase is unavailable (Expo Go, or a build made before
// @react-native-firebase was added). In those runtimes importing the module
// throws "NativeRNFBTurboApp is not registered" and can surface a crash
// record, so we skip Firebase entirely and no-op. In a proper dev/production
// build (executionEnvironment 'standalone'/'bare') this returns false and
// Firebase works normally.
let _fbChecked = false;
let _fbDisabled = false;
function firebaseUnavailable(): boolean {
  if (_fbChecked) return _fbDisabled;
  _fbChecked = true;
  try {
    const Constants = require('expo-constants').default;
    const env = Constants?.executionEnvironment;
    if (env === 'storeClient' || Constants?.appOwnership === 'expo') {
      _fbDisabled = true; // running inside Expo Go — no native Firebase
    }
  } catch { /* if we can't tell, fall through and let the require guard decide */ }
  return _fbDisabled;
}

function getMessaging(): any | null {
  if (firebaseUnavailable()) return null;
  // @ts-ignore — resolved after `npm install @react-native-firebase/messaging`
  // and a native build; guarded so a missing native module no-ops.
  try { return require('@react-native-firebase/messaging').default; } catch { return null; }
}

// ── Background handler — MUST be registered at module scope (RNFirebase rule).
// Android auto-displays the `notification` block when the app is background /
// quit, so there's nothing to render here; this just satisfies the SDK and
// gives us a hook for any future data-only handling.
(() => {
  const messaging = getMessaging();
  if (!messaging) return;
  try {
    messaging().setBackgroundMessageHandler(async () => { /* no-op */ });
  } catch { /* non-fatal */ }
})();

/** Navigate to a deep link once a session + the router are ready. */
async function navigateWhenReady(link?: string) {
  if (!link || typeof link !== 'string') return;
  // Wait up to ~10s for an authenticated session (cold start goes through the
  // auth gate first). If still not logged in, drop it — the user lands home.
  for (let i = 0; i < 20; i++) {
    try {
      const token = await AsyncStorage.getItem('token');
      if (token) {
        try { router.push(link as any); } catch { /* router not ready yet */ }
        return;
      }
    } catch { /* ignore */ }
    await new Promise((r) => setTimeout(r, 500));
  }
}

/** Foreground + tap listeners. Call once from the root layout. */
export function configurePushHandler() {
  const messaging = getMessaging();
  if (!messaging) return;
  try {
    // Foreground message: the backend already wrote the Notification row, so
    // the in-app bell reflects it on next focus/poll. We intentionally do NOT
    // pop a second system notification here (avoids duplicates).
    messaging().onMessage(async (_rm: any) => { /* bell stays source of truth */ });

    // Tapped while the app was backgrounded.
    messaging().onNotificationOpenedApp((rm: any) => {
      navigateWhenReady(rm?.data?.link);
    });

    // Tapped from a fully-quit state (cold launch).
    messaging().getInitialNotification().then((rm: any) => {
      if (rm) navigateWhenReady(rm?.data?.link);
    }).catch(() => {});

    // Token rotation → keep the backend current.
    messaging().onTokenRefresh((t: string) => {
      _cachedToken = t;
      notificationAPI.registerDevice(t).catch(() => {});
      AsyncStorage.setItem(TOKEN_KEY, t).catch(() => {});
    });
  } catch { /* non-fatal */ }
}

/** Ask Android notification permission (13+). Returns granted?. */
async function requestPermission(): Promise<boolean> {
  const messaging = getMessaging();
  if (!messaging) return false;
  try {
    if (Platform.OS === 'android' && Number(Platform.Version) >= 33) {
      const res = await PermissionsAndroid.request(
        // POST_NOTIFICATIONS (Android 13+)
        (PermissionsAndroid.PERMISSIONS as any).POST_NOTIFICATIONS,
      );
      if (res !== PermissionsAndroid.RESULTS.GRANTED) return false;
    }
    const authStatus = await messaging().requestPermission();
    // AuthorizationStatus: 1 = AUTHORIZED, 2 = PROVISIONAL
    return authStatus === 1 || authStatus === 2 || authStatus === true;
  } catch {
    return false;
  }
}

/** Request permission, get the FCM token, and register it with the backend. */
export async function syncPushToken(): Promise<void> {
  const messaging = getMessaging();
  if (!messaging) return;
  try {
    const ok = await requestPermission();
    if (!ok) { console.log('[fcm] notification permission not granted'); return; }

    // Android may need the device registered for remote messages first.
    try {
      if (!messaging().isDeviceRegisteredForRemoteMessages) {
        await messaging().registerDeviceForRemoteMessages();
      }
    } catch { /* older API / not required */ }

    const token = await messaging().getToken();
    if (!token) return;
    _cachedToken = token;
    await notificationAPI.registerDevice(token).catch(() => {});
    try { await AsyncStorage.setItem(TOKEN_KEY, token); } catch { /* ignore */ }
    console.log('[fcm] device token registered');
  } catch (e: any) {
    console.log('[fcm] syncPushToken failed:', e?.message || e);
  }
}

/** Detach this device from the current user (call on logout). */
export async function unregisterPushToken(): Promise<void> {
  try {
    const token = _cachedToken || (await AsyncStorage.getItem(TOKEN_KEY).catch(() => null));
    if (token) await notificationAPI.unregisterDevice(token).catch(() => {});
    await AsyncStorage.removeItem(TOKEN_KEY).catch(() => {});
    _cachedToken = null;
  } catch { /* non-fatal */ }
}
