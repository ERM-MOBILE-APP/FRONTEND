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
  } catch { /* if we can't tell, fall through and let the native check decide */ }

  // CRITICAL — only touch Firebase if its NATIVE module is actually compiled
  // into THIS binary. When the JS packages are installed but the app hasn't been
  // rebuilt natively yet (an old dev/prod build, or Expo Go), requiring
  // @react-native-firebase/* evaluates FirebaseApp.js, which throws/logs
  // "Native module RNFBAppModule not found". Checking NativeModules.RNFBAppModule
  // first means we NEVER require the JS in that state — no crash, no red error.
  if (!_fbDisabled) {
    try {
      const { NativeModules } = require('react-native');
      if (!NativeModules || !NativeModules.RNFBAppModule) _fbDisabled = true;
    } catch {
      _fbDisabled = true;
    }
  }
  return _fbDisabled;
}

function getMessaging(): any | null {
  // firebaseUnavailable() has already confirmed the NATIVE RNFBAppModule exists
  // before we get here, so requiring the JS won't throw "RNFBAppModule not
  // found". Dynamic (variable) require keeps Metro from hard-resolving the
  // package at bundle time; still guarded so anything unexpected just no-ops.
  if (firebaseUnavailable()) return null;
  try { const mod = '@react-native-firebase/messaging'; return require(mod).default; } catch { return null; }
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

// ── Local display via expo-notifications (already a dependency, used for the
// tracking channel). RNFirebase auto-shows the `notification` payload when the
// app is BACKGROUND/QUIT, but (a) Android needs the 'default' channel to exist
// or it drops the notification, and (b) nothing shows in the FOREGROUND. We use
// expo-notifications to create that channel AND to render a system notification
// for foreground messages so real pushes appear in every app state.
function getExpoNotifications(): any | null {
  try { const mod = 'expo-notifications'; return require(mod); } catch { return null; }
}

// Foreground presentation handler — without this, expo-notifications suppresses
// the banner while the app is open. Registered once at module load.
(() => {
  const N = getExpoNotifications();
  if (!N || !N.setNotificationHandler) return;
  try {
    N.setNotificationHandler({
      handleNotification: async () => ({
        shouldShowAlert:  true, // Expo SDK ≤ 53
        shouldShowBanner: true, // Expo SDK 54+
        shouldShowList:   true,
        shouldPlaySound:  true,
        shouldSetBadge:   false,
      }),
    });
  } catch { /* non-fatal */ }
})();

/** Create the 'default' Android channel the backend's FCM messages target. */
async function ensureAndroidChannel() {
  if (Platform.OS !== 'android') return;
  const N = getExpoNotifications();
  if (!N || !N.setNotificationChannelAsync) return;
  try {
    await N.setNotificationChannelAsync('default', {
      name: 'General',
      importance: N.AndroidImportance ? N.AndroidImportance.MAX : 5,
      sound: 'default',
      vibrationPattern: [0, 250, 250, 250],
      lightColor: '#4CAF50',
    });
  } catch { /* non-fatal */ }
}

/** Render a system notification for a FOREGROUND FCM message. */
async function presentForeground(rm: any) {
  const N = getExpoNotifications();
  if (!N || !N.scheduleNotificationAsync) return;
  const n = (rm && rm.notification) || {};
  const title = n.title || 'Tesco ERM';
  const body  = n.body  || '';
  try {
    await N.scheduleNotificationAsync({
      content: {
        title,
        body,
        data: (rm && rm.data) || {},
        sound: 'default',
        ...(Platform.OS === 'android' ? { channelId: 'default' } : {}),
      },
      trigger: null, // deliver immediately
    });
  } catch { /* non-fatal */ }
}

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
  // Make sure the Android 'default' channel exists so background/quit pushes
  // display and the foreground ones we render have a channel to attach to.
  ensureAndroidChannel();

  // Tap on a notification we rendered ourselves (foreground) → deep-link.
  const N = getExpoNotifications();
  if (N && N.addNotificationResponseReceivedListener) {
    try {
      N.addNotificationResponseReceivedListener((resp: any) => {
        const link = resp?.notification?.request?.content?.data?.link;
        navigateWhenReady(link);
      });
    } catch { /* non-fatal */ }
  }

  const messaging = getMessaging();
  if (!messaging) return;
  try {
    // Foreground message: Android does NOT auto-display FCM notifications while
    // the app is open, so we render a system notification ourselves. The
    // in-app bell still updates from the backend row — no duplicate bell entry.
    messaging().onMessage(async (rm: any) => { presentForeground(rm); });

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
