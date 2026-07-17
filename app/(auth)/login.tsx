import React, { useState, useMemo, useEffect } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  Alert,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  Image,
  StatusBar,
  Dimensions,
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { authAPI, wakeBackend } from '../../services/api';

const { width: SCREEN_W, height: SCREEN_H } = Dimensions.get('window');

// ---------- Grid Background (matches Figma green grid) ----------
const GRID_SIZE = 28;
function GridBackground() {
  const cols = Math.ceil(SCREEN_W / GRID_SIZE) + 1;
  const rows = Math.ceil(SCREEN_H / GRID_SIZE) + 1;

  const vLines = useMemo(
    () =>
      Array.from({ length: cols }).map((_, i) => (
        <View
          key={`v${i}`}
          style={[styles.gridVLine, { left: i * GRID_SIZE }]}
        />
      )),
    [cols]
  );
  const hLines = useMemo(
    () =>
      Array.from({ length: rows }).map((_, i) => (
        <View
          key={`h${i}`}
          style={[styles.gridHLine, { top: i * GRID_SIZE }]}
        />
      )),
    [rows]
  );

  // tiny dots at intersections, like Figma
  const dots = useMemo(() => {
    const out: React.ReactNode[] = [];
    for (let r = 0; r < rows; r += 2) {
      for (let c = 0; c < cols; c += 2) {
        out.push(
          <View
            key={`d${r}-${c}`}
            style={[
              styles.gridDot,
              { left: c * GRID_SIZE - 1, top: r * GRID_SIZE - 1 },
            ]}
          />
        );
      }
    }
    return out;
  }, [rows, cols]);

  return (
    <View pointerEvents="none" style={StyleSheet.absoluteFill}>
      {vLines}
      {hLines}
      {dots}
    </View>
  );
}

// ---------- Login Screen ----------
export default function LoginScreen() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [remember, setRemember] = useState(false);
  const [loading, setLoading] = useState(false);

  // Wake up Render free-tier server in the background so the first tap
  // doesn't hit a 30-60s cold start.
  useEffect(() => {
    wakeBackend();
  }, []);

  // #400 — Accept EITHER a valid email OR an employee id (e.g. "TES080",
  // "TES047"). The backend /auth/login handler already looks up by email,
  // employeeId, username, or emailHistory — so blocking employee IDs
  // client-side was preventing valid logins for anyone whose HRMS record
  // has no email column (older users, imports). Now we only reject
  // truly-empty or clearly-malformed input; the backend has the final
  // say on whether an id/email exists.
  const validateEmail = (e: string) => {
    const s = String(e || '').trim();
    if (!s) return false;
    // Email format is fine.
    if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s)) return true;
    // Employee id format (any alphanumeric id, at least 3 chars, no spaces)
    // — TES080, TES047, EMP123, etc.
    if (/^[A-Za-z0-9._-]{3,}$/.test(s)) return true;
    return false;
  };

  const canSubmit =
    email.trim().length > 0 &&
    password.length > 0 &&
    validateEmail(email) &&
    !loading;

  const handleLogin = async () => {
    if (!email.trim() || !password) {
      Alert.alert('Missing fields', 'Please enter your email and password.');
      return;
    }
    if (!validateEmail(email)) {
      Alert.alert('Invalid input', 'Please enter a valid email or employee ID (e.g. TES080).');
      return;
    }

    try {
      setLoading(true);
      const res = await authAPI.login(email.trim(), password);
      if (!res?.data?.token) {
        // Some intermediate proxy or old backend can return 200 without a
        // token payload. Surface that clearly instead of the silent crash
        // that used to happen when we tried to save `undefined` as the
        // token.
        throw new Error('Login response missing token — please try again.');
      }
      // #423 — HARDENED LOGIN SEQUENCE (supersedes #415 best-effort wipe).
      //
      // Order is critical:
      //   1) Nuke the OLD user's identity tokens FIRST. If any step below
      //      crashes, a fresh app open will re-hit the login screen
      //      rather than showing a home page where the token is new but
      //      the cache is old.
      //   2) Nuke the today snapshot explicitly (belt-and-braces — the
      //      home mount ownership guard would drop it anyway, but let's
      //      not rely on that on the login path).
      //   3) Run wipeUserScopedTracking — SQLite tracking_state, pending
      //      pings, all erm-* AsyncStorage keys.
      //   4) THEN write the new user's token/user.
      // If the wipe throws, we still proceed (the ownership guard on the
      // home mount is the second defensive layer) but we log loudly.
      try {
        await AsyncStorage.multiRemove(['token', 'user', 'userId', 'erm-today-v1']);
      } catch (e: any) {
        console.warn('[login] multiRemove failed (non-fatal, wipe will follow):', e?.message || e);
      }
      let wipeOk = false;
      try {
        const { wipeUserScopedTracking } = require('../../services/pingStore');
        await wipeUserScopedTracking();
        wipeOk = true;
      } catch (e: any) {
        console.warn('[login] wipeUserScopedTracking failed — ownership guard on home mount will still protect:', e?.message || e);
      }
      console.log('[login] pre-login wipe complete, wipeOk=', wipeOk);
      await AsyncStorage.setItem('token', res.data.token);
      await AsyncStorage.setItem('user', JSON.stringify(res.data.user || {}));
      if (remember) {
        await AsyncStorage.setItem('rememberedEmail', email.trim());
      } else {
        await AsyncStorage.removeItem('rememberedEmail');
      }
      router.replace('/(tabs)/');
    } catch (err: any) {
      // #400 — Show the ACTUAL reason for the failure so HR can act on
      // it. Previously we always said "Invalid credentials", which
      // masked network errors, cold-start failures, and server 500s.
      // Now:
      //   • 400/401 with a message  → show that message
      //   • no err.response (network/timeout) → clear "connection" text
      //   • 5xx                      → show "Server error, try again"
      let title = 'Login Failed';
      let msg;
      if (err?.response) {
        // Backend answered with an error status.
        const status = err.response.status;
        const backendMsg = err.response.data?.message;
        if (status === 401 || status === 400) {
          msg = backendMsg || 'Invalid credentials. Check your ID/email and password.';
        } else if (status >= 500) {
          msg = 'Server error. Please try again in a moment.';
        } else {
          msg = backendMsg || `Unexpected response (HTTP ${status}).`;
        }
      } else if (err?.code === 'ECONNABORTED' || /timeout/i.test(String(err?.message))) {
        title = 'Server waking up';
        msg = 'The server is starting up (this can take up to a minute on the free plan). Please try again in ~30 seconds.';
      } else if (/network/i.test(String(err?.message))) {
        msg = 'Connection lost. Please check your internet and try again.';
      } else {
        msg = err?.message || 'Something went wrong. Please try again.';
      }
      Alert.alert(title, msg);
    } finally {
      setLoading(false);
    }
  };

  return (
    <View style={styles.root}>
      <StatusBar
        barStyle="light-content"
        backgroundColor={GREEN_BG}
        translucent={false}
      />
      <GridBackground />

      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <ScrollView
          contentContainerStyle={styles.scroll}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          {/* Centered content wrapper — keeps everything vertically and
              horizontally centered on the mobile screen */}
          <View style={styles.centerWrap}>
            {/* Logo */}
            <View style={styles.logoWrap}>
              <Image
                source={require('../../assets/logo.png')}
                style={styles.logo}
                resizeMode="contain"
              />
            </View>

            {/* Title */}
            <Text style={styles.title}>Sign in to{'\n'}your Account</Text>
            <Text style={styles.subtitle}>
              Enter your email and password to log in
            </Text>

            {/* Card */}
            <View style={styles.card}>
            {/* Email input */}
            <View style={styles.inputWrap}>
              <TextInput
                style={styles.input}
                placeholder="Enter User Email Id"
                placeholderTextColor="#B7B7B7"
                value={email}
                onChangeText={setEmail}
                autoCapitalize="none"
                keyboardType="email-address"
                autoCorrect={false}
              />
            </View>

            {/* Password input */}
            <View style={styles.inputWrap}>
              <TextInput
                style={[styles.input, { paddingRight: 44 }]}
                placeholder="Enter Password"
                placeholderTextColor="#B7B7B7"
                secureTextEntry={!showPassword}
                value={password}
                onChangeText={setPassword}
                autoCapitalize="none"
                autoCorrect={false}
              />
              <TouchableOpacity
                onPress={() => setShowPassword(!showPassword)}
                style={styles.eyeBtn}
                hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
              >
                <Ionicons
                  name={showPassword ? 'eye-outline' : 'eye-off-outline'}
                  size={18}
                  color="#9A9A9A"
                />
              </TouchableOpacity>
            </View>

            {/* Remember + Forgot */}
            <View style={styles.rowBetween}>
              <TouchableOpacity
                style={styles.rememberRow}
                onPress={() => setRemember(!remember)}
                activeOpacity={0.7}
              >
                <View
                  style={[
                    styles.checkbox,
                    remember && styles.checkboxChecked,
                  ]}
                >
                  {remember && (
                    <Ionicons name="checkmark" size={11} color="#fff" />
                  )}
                </View>
                <Text style={styles.rememberText}>Remember me</Text>
              </TouchableOpacity>

              <TouchableOpacity
                onPress={() => router.push('/(auth)/email-verify')}
                activeOpacity={0.7}
              >
                <Text style={styles.forgotText}>Forgot password?</Text>
              </TouchableOpacity>
            </View>

              {/* Log In Button */}
              <TouchableOpacity
                style={[styles.loginBtn, !canSubmit && styles.loginBtnDisabled]}
                onPress={handleLogin}
                disabled={!canSubmit}
                activeOpacity={0.9}
              >
                {loading ? (
                  <ActivityIndicator color="#fff" />
                ) : (
                  <Text style={styles.loginText}>Log In</Text>
                )}
              </TouchableOpacity>
            </View>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </View>
  );
}

// ---------- Theme ----------
const GREEN_BG = '#2E8C2C';        // base green from Figma
const GREEN_BG_DARK = '#1F6A1E';   // darker tone for gradient/edge feel
const GREEN_PRIMARY = '#3FAE3B';   // button + accents
const GRID_LINE = 'rgba(255,255,255,0.06)';
const GRID_DOT = 'rgba(255,255,255,0.18)';

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: GREEN_BG },

  // grid pattern
  gridVLine: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    width: 1,
    backgroundColor: GRID_LINE,
  },
  gridHLine: {
    position: 'absolute',
    left: 0,
    right: 0,
    height: 1,
    backgroundColor: GRID_LINE,
  },
  gridDot: {
    position: 'absolute',
    width: 2,
    height: 2,
    borderRadius: 1,
    backgroundColor: GRID_DOT,
  },

  scroll: {
    flexGrow: 1,
    paddingHorizontal: 24,
    paddingVertical: 24,
    justifyContent: 'center', // vertically center card like Figma
    alignItems: 'center',     // horizontally center inner wrapper
  },

  // Wraps logo + title + card. We let it grow naturally but center it
  // both ways inside the ScrollView so the form sits in the middle of
  // the device — exactly what the Figma intends.
  centerWrap: {
    width: '100%',
    maxWidth: 420,
    alignSelf: 'center',
    justifyContent: 'center',
  },

  logoWrap: {
    alignItems: 'center',
    marginBottom: 28,
  },
  logo: {
    // matches logo.png native ratio 145:40 (~3.6:1)
    width: 200,
    height: 56,
  },

  title: {
    color: '#FFFFFF',
    fontSize: 28,
    fontWeight: '800',
    textAlign: 'center',
    lineHeight: 36,
    letterSpacing: 0.2,
  },
  subtitle: {
    color: 'rgba(255,255,255,0.92)',
    fontSize: 12.5,
    marginTop: 10,
    marginBottom: 28,
    textAlign: 'center',
  },

  card: {
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    paddingHorizontal: 20,
    paddingTop: 22,
    paddingBottom: 22,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.18,
    shadowRadius: 18,
    elevation: 12,
  },

  inputWrap: {
    position: 'relative',
    marginBottom: 14,
  },
  input: {
    borderWidth: 1,
    borderColor: '#ECECEC',
    backgroundColor: '#FAFAFA',
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: Platform.OS === 'ios' ? 14 : 12,
    fontSize: 13.5,
    color: '#111',
  },
  eyeBtn: {
    position: 'absolute',
    right: 8,
    top: 0,
    bottom: 0,
    paddingHorizontal: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },

  rowBetween: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 4,
    marginBottom: 22,
  },

  rememberRow: { flexDirection: 'row', alignItems: 'center' },
  checkbox: {
    width: 16,
    height: 16,
    borderWidth: 1.4,
    borderColor: '#C9C9C9',
    borderRadius: 3,
    marginRight: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  checkboxChecked: {
    backgroundColor: GREEN_PRIMARY,
    borderColor: GREEN_PRIMARY,
  },
  rememberText: { color: '#7E7E7E', fontSize: 12.5 },
  forgotText: {
    color: GREEN_PRIMARY,
    fontSize: 12.5,
    fontWeight: '600',
  },

  loginBtn: {
    backgroundColor: GREEN_PRIMARY,
    borderRadius: 999,
    paddingVertical: 15,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: GREEN_BG_DARK,
    shadowOpacity: 0.35,
    shadowOffset: { width: 0, height: 6 },
    shadowRadius: 10,
    elevation: 5,
  },
  loginBtnDisabled: {
    backgroundColor: '#C6E5BF',
    shadowOpacity: 0,
    elevation: 0,
  },
  loginText: {
    color: '#FFFFFF',
    fontSize: 15,
    fontWeight: '700',
    letterSpacing: 0.3,
  },
});
