/**
 * #422 — Local Expo config plugin.
 *
 * Ensures the generated AndroidManifest.xml declares
 *   <service android:name="com.asterinet.react.bgactions.RNBackgroundActionsTask"
 *            android:foregroundServiceType="location" />
 *
 * WHY THIS IS NEEDED:
 * Android 14 (API 34) enforces a strict foregroundServiceType check at
 * startForeground() time. If the service tag in the manifest doesn't
 * declare `android:foregroundServiceType="location"`, the OS throws
 * ForegroundServiceStartNotAllowedException and the r-n-b-a FGS dies
 * within seconds of check-in — which manifests as "tracking stops when
 * the app goes to background."
 *
 * react-native-background-actions ships a plain <service> tag with no
 * type attribute, and Expo's managed workflow doesn't merge these
 * attributes for us. Setting `foregroundServiceType: 'location'` in the
 * JS options bag (see services/backgroundTracking.ts:428) is required
 * but not sufficient — the manifest side of the check is what this
 * plugin covers.
 *
 * The plugin is idempotent: safe to run multiple times, safe if the
 * service is already declared, safe on fresh installs.
 *
 * ─── HOW TO ACTIVATE ────────────────────────────────────────────
 * 1) This file lives at `./plugins/withRnbaForegroundServiceType.js`
 *    (relative to `frontend/`).
 * 2) It is registered in `app.json` under `expo.plugins`.
 * 3) It only takes effect via `npx expo prebuild` OR `eas build`.
 *    A hot reload / metro restart does NOT pick this up — it's a
 *    native manifest change, not a JS change.
 *
 * ─── VERIFY IT RAN ─────────────────────────────────────────────
 * After `npx expo prebuild --clean --platform android`, open
 *   android/app/src/main/AndroidManifest.xml
 * and grep for `RNBackgroundActionsTask`. You should see the tag
 * with `android:foregroundServiceType="location"` on it.
 * Also confirm the top-level permission
 *   <uses-permission android:name="android.permission.FOREGROUND_SERVICE_LOCATION"/>
 * is present (it's declared in app.json:49 already).
 */

const { withAndroidManifest } = require('@expo/config-plugins');

const RNBA_SERVICE_NAME  = 'com.asterinet.react.bgactions.RNBackgroundActionsTask';
const FGS_TYPE_ATTR       = 'android:foregroundServiceType';
const FGS_TYPE_VALUE      = 'location';
const FGS_PERMISSION_ATTR = 'android:permission';

module.exports = function withRnbaForegroundServiceType(config) {
  return withAndroidManifest(config, (cfg) => {
    try {
      const manifest = cfg.modResults;
      // Manifest structure from @expo/config-plugins parser:
      //   manifest.manifest.application[0].service[]
      const application = manifest?.manifest?.application?.[0];
      if (!application) {
        console.warn('[withRnbaForegroundServiceType] no <application> tag — skipping');
        return cfg;
      }

      if (!Array.isArray(application.service)) {
        application.service = [];
      }

      const existing = application.service.find(
        (s) => s && s.$ && s.$['android:name'] === RNBA_SERVICE_NAME
      );

      if (existing) {
        // Service tag exists (r-n-b-a's own <service /> from its manifest
        // merge) — just stamp the attribute if it's missing.
        const before = existing.$[FGS_TYPE_ATTR];
        existing.$[FGS_TYPE_ATTR] = FGS_TYPE_VALUE;
        // Also stamp exported="false" if not already set — best-practice
        // hardening. r-n-b-a's task is internal, no external app should
        // be able to bind it.
        if (existing.$['android:exported'] === undefined) {
          existing.$['android:exported'] = 'false';
        }
        console.log(
          `[withRnbaForegroundServiceType] stamped ${FGS_TYPE_ATTR}="${FGS_TYPE_VALUE}" ` +
          `on existing r-n-b-a service (was ${before || 'unset'})`
        );
      } else {
        // Service not declared yet — add it. Safer than assuming the
        // library will always merge it in.
        application.service.push({
          $: {
            'android:name':           RNBA_SERVICE_NAME,
            'android:exported':       'false',
            [FGS_TYPE_ATTR]:          FGS_TYPE_VALUE,
          },
        });
        console.log(
          `[withRnbaForegroundServiceType] added new <service> tag for r-n-b-a ` +
          `with ${FGS_TYPE_ATTR}="${FGS_TYPE_VALUE}"`
        );
      }

      return cfg;
    } catch (err) {
      console.warn(
        '[withRnbaForegroundServiceType] failed to modify manifest — build will proceed ' +
        'but Android 14+ tracking may be unreliable:',
        (err && err.message) || err
      );
      return cfg;
    }
  });
};
