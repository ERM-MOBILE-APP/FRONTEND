import React, { useMemo } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
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

const { width: SCREEN_W, height: SCREEN_H } = Dimensions.get('window');

// ---------- Grid Background (shared visual) ----------
const GRID_SIZE = 28;
function GridBackground() {
  const cols = Math.ceil(SCREEN_W / GRID_SIZE) + 1;
  const rows = Math.ceil(SCREEN_H / GRID_SIZE) + 1;

  const vLines = useMemo(
    () => Array.from({ length: cols }).map((_, i) => (
      <View key={`v${i}`} style={[styles.gridVLine, { left: i * GRID_SIZE }]} />
    )),
    [cols]
  );
  const hLines = useMemo(
    () => Array.from({ length: rows }).map((_, i) => (
      <View key={`h${i}`} style={[styles.gridHLine, { top: i * GRID_SIZE }]} />
    )),
    [rows]
  );
  const dots = useMemo(() => {
    const out: React.ReactNode[] = [];
    for (let r = 0; r < rows; r += 2) {
      for (let c = 0; c < cols; c += 2) {
        out.push(
          <View
            key={`d${r}-${c}`}
            style={[styles.gridDot, { left: c * GRID_SIZE - 1, top: r * GRID_SIZE - 1 }]}
          />
        );
      }
    }
    return out;
  }, [rows, cols]);

  return (
    <View pointerEvents="none" style={StyleSheet.absoluteFill}>
      {vLines}{hLines}{dots}
    </View>
  );
}

// ---------- Success Screen ----------
export default function SuccessScreen() {
  const handleGoToLogin = async () => {
    // #440 — Guard the storage clear: a rejecting multiRemove would become an
    // unhandled promise rejection (Android SIGTERM risk) AND skip navigation.
    // Navigate in `finally` so the user always gets to login.
    try {
      // clear any cached session so user must re-login with new password
      await AsyncStorage.multiRemove(['token', 'user']);
    } catch (e: any) {
      console.warn('[success] session clear failed (non-fatal):', e?.message || e);
    } finally {
      try { router.replace('/(auth)/login'); } catch {}
    }
  };

  return (
    <View style={styles.root}>
      <StatusBar barStyle="light-content" backgroundColor={GREEN_BG} translucent={false} />
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
          {/* Logo */}
          <View style={styles.logoWrap}>
            <Image
              source={require('../../assets/logo.png')}
              style={styles.logo}
              resizeMode="contain"
            />
          </View>

          {/* Card */}
          <View style={styles.card}>
            {/* Check circle */}
            <View style={styles.checkWrap}>
              <View style={styles.checkCircleOuter}>
                <View style={styles.checkCircleInner}>
                  <Ionicons name="checkmark" size={30} color="#fff" />
                </View>
              </View>
            </View>

            <Text style={styles.title}>All done!</Text>
            <Text style={styles.subtitle}>
              Your password has been changed{'\n'}successfully. Use your new
              {'\n'}password to log in.
            </Text>

            <TouchableOpacity
              style={styles.btn}
              onPress={handleGoToLogin}
              activeOpacity={0.9}
            >
              <Text style={styles.btnText}>Go To Login</Text>
            </TouchableOpacity>

            {/* Security verified pill */}
            <View style={styles.badgeRow}>
              <View style={styles.badge}>
                <Ionicons
                  name="shield-checkmark"
                  size={12}
                  color="#5a6f55"
                  style={{ marginRight: 4 }}
                />
                <Text style={styles.badgeText}>Security verified</Text>
              </View>
            </View>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </View>
  );
}

// ---------- Theme ----------
const GREEN_BG = '#2E8C2C';
const GREEN_BG_DARK = '#1F6A1E';
const GREEN_PRIMARY = '#3FAE3B';
const GREEN_SOFT = '#E8F5E5';
const GRID_LINE = 'rgba(255,255,255,0.06)';
const GRID_DOT = 'rgba(255,255,255,0.18)';

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: GREEN_BG },

  gridVLine: { position: 'absolute', top: 0, bottom: 0, width: 1, backgroundColor: GRID_LINE },
  gridHLine: { position: 'absolute', left: 0, right: 0, height: 1, backgroundColor: GRID_LINE },
  gridDot: { position: 'absolute', width: 2, height: 2, borderRadius: 1, backgroundColor: GRID_DOT },

  scroll: {
    flexGrow: 1,
    paddingHorizontal: 24,
    paddingVertical: 40,
    justifyContent: 'center',
  },

  logoWrap: { alignItems: 'center', marginBottom: 28 },
  logo: { width: 190, height: 52 },

  card: {
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    paddingHorizontal: 22,
    paddingTop: 28,
    paddingBottom: 22,
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.18,
    shadowRadius: 18,
    elevation: 12,
  },

  checkWrap: { marginBottom: 16 },
  checkCircleOuter: {
    width: 72,
    height: 72,
    borderRadius: 36,
    backgroundColor: GREEN_SOFT,
    alignItems: 'center',
    justifyContent: 'center',
  },
  checkCircleInner: {
    width: 50,
    height: 50,
    borderRadius: 25,
    backgroundColor: GREEN_PRIMARY,
    alignItems: 'center',
    justifyContent: 'center',
  },

  title: {
    color: '#1A1A1A',
    fontSize: 22,
    fontWeight: '800',
    textAlign: 'center',
    marginBottom: 10,
  },
  subtitle: {
    color: '#7E7E7E',
    fontSize: 12.5,
    lineHeight: 18,
    textAlign: 'center',
    marginBottom: 22,
  },

  btn: {
    alignSelf: 'stretch',
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
  btnText: {
    color: '#FFFFFF',
    fontSize: 15,
    fontWeight: '700',
    letterSpacing: 0.3,
  },

  badgeRow: { marginTop: 16 },
  badge: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#F0F2EF',
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 999,
  },
  badgeText: {
    color: '#5a6f55',
    fontSize: 11,
    fontWeight: '600',
  },
});
