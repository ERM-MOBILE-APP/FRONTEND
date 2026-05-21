import React, { useState, useEffect, useRef, useMemo } from 'react';
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
import { router, useLocalSearchParams } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { authAPI } from '../../services/api';

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

// ---------- OTP Screen ----------
const OTP_LENGTH = 6;
const OTP_VALIDITY_SEC = 10 * 60; // 10 min
const RESEND_COOLDOWN_SEC = 55;

export default function OtpScreen() {
  const params = useLocalSearchParams<{ email?: string }>();
  const email = (params.email as string) || '';

  const [digits, setDigits] = useState<string[]>(
    Array(OTP_LENGTH).fill('')
  );
  const [loading, setLoading] = useState(false);
  const [resending, setResending] = useState(false);
  const [validitySec, setValiditySec] = useState(OTP_VALIDITY_SEC);
  const [resendIn, setResendIn] = useState(RESEND_COOLDOWN_SEC);
  const inputs = useRef<Array<TextInput | null>>([]);

  // Validity countdown
  useEffect(() => {
    if (validitySec <= 0) return;
    const t = setInterval(() => setValiditySec((s) => Math.max(0, s - 1)), 1000);
    return () => clearInterval(t);
  }, [validitySec]);

  // Resend cooldown
  useEffect(() => {
    if (resendIn <= 0) return;
    const t = setInterval(() => setResendIn((s) => Math.max(0, s - 1)), 1000);
    return () => clearInterval(t);
  }, [resendIn]);

  const fmt = (s: number) => {
    const m = Math.floor(s / 60).toString().padStart(2, '0');
    const ss = (s % 60).toString().padStart(2, '0');
    return `${m}:${ss}`;
  };

  const maskedEmail = useMemo(() => {
    if (!email || !email.includes('@')) return email;
    const [local, domain] = email.split('@');
    if (local.length <= 2) return `${local[0]}***@${domain}`;
    return `${local.slice(0, 2)}${'*'.repeat(Math.max(1, local.length - 4))}${local.slice(-2)}@${domain}`;
  }, [email]);

  const handleChange = (text: string, index: number) => {
    // accept paste of full code
    if (text.length > 1) {
      const chars = text.replace(/\D/g, '').slice(0, OTP_LENGTH).split('');
      const next = [...digits];
      chars.forEach((c, i) => {
        if (index + i < OTP_LENGTH) next[index + i] = c;
      });
      setDigits(next);
      const lastIdx = Math.min(index + chars.length, OTP_LENGTH - 1);
      inputs.current[lastIdx]?.focus();
      return;
    }

    const ch = text.replace(/\D/g, '');
    const next = [...digits];
    next[index] = ch;
    setDigits(next);
    if (ch && index < OTP_LENGTH - 1) inputs.current[index + 1]?.focus();
  };

  const handleKeyPress = (e: any, index: number) => {
    if (e.nativeEvent.key === 'Backspace' && !digits[index] && index > 0) {
      inputs.current[index - 1]?.focus();
      const next = [...digits];
      next[index - 1] = '';
      setDigits(next);
    }
  };

  const handleVerify = async () => {
    const code = digits.join('');
    if (code.length !== OTP_LENGTH) {
      Alert.alert('Incomplete OTP', `Please enter all ${OTP_LENGTH} digits.`);
      return;
    }
    if (validitySec <= 0) {
      Alert.alert('OTP expired', 'Please resend the OTP and try again.');
      return;
    }

    try {
      setLoading(true);
      const res = await authAPI.verifyOtp(email, code);
      const resetToken = res?.data?.resetToken;
      // → go to new-password screen (NOT directly to success)
      router.replace({
        pathname: '/(auth)/new-password',
        params: { email, resetToken: resetToken || '' },
      });
    } catch (err: any) {
      Alert.alert(
        'Verification failed',
        err?.response?.data?.message || 'Invalid OTP. Please try again.'
      );
    } finally {
      setLoading(false);
    }
  };

  const handleResend = async () => {
    if (resendIn > 0) return;
    try {
      setResending(true);
      await authAPI.sendOtp(email);
      setValiditySec(OTP_VALIDITY_SEC);
      setResendIn(RESEND_COOLDOWN_SEC);
      setDigits(Array(OTP_LENGTH).fill(''));
      inputs.current[0]?.focus();
      Alert.alert('OTP Resent', `A new OTP has been sent to ${email}`);
    } catch (err: any) {
      Alert.alert(
        'Could not resend',
        err?.response?.data?.message || 'Try again in a moment.'
      );
    } finally {
      setResending(false);
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
            {/* Back link */}
            <TouchableOpacity
              style={styles.backRow}
              onPress={() => router.back()}
              activeOpacity={0.7}
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            >
              <Ionicons name="chevron-back" size={16} color="#3A3A3A" />
              <Text style={styles.backText}>Back</Text>
            </TouchableOpacity>

            {/* Shield icon */}
            <View style={styles.shieldWrap}>
              <View style={styles.shieldCircle}>
                <Ionicons name="shield-checkmark" size={26} color={GREEN_PRIMARY} />
              </View>
            </View>

            <Text style={styles.title}>Enter OTP</Text>
            <Text style={styles.subtitle}>
              Sent to {maskedEmail || 'your registered email'}
            </Text>

            {/* OTP Boxes */}
            <View style={styles.otpRow}>
              {digits.map((d, i) => (
                <TextInput
                  key={i}
                  ref={(r) => { inputs.current[i] = r; }}
                  style={[
                    styles.otpBox,
                    d ? styles.otpBoxFilled : null,
                  ]}
                  value={d}
                  onChangeText={(t) => handleChange(t, i)}
                  onKeyPress={(e) => handleKeyPress(e, i)}
                  keyboardType="number-pad"
                  maxLength={i === 0 ? OTP_LENGTH : 1}
                  selectTextOnFocus
                  textAlign="center"
                  returnKeyType="next"
                />
              ))}
            </View>

            {/* Validity */}
            <Text style={styles.validity}>
              OTP valid for{' '}
              <Text style={{ color: GREEN_PRIMARY, fontWeight: '700' }}>
                {fmt(validitySec)}
              </Text>
            </Text>

            {/* Verify Button */}
            {(() => {
              const canSubmit =
                digits.every((d) => d.length === 1) &&
                validitySec > 0 &&
                !loading;
              return (
                <TouchableOpacity
                  style={[styles.verifyBtn, !canSubmit && styles.verifyBtnDisabled]}
                  onPress={handleVerify}
                  disabled={!canSubmit}
                  activeOpacity={0.9}
                >
                  {loading ? (
                    <ActivityIndicator color="#fff" />
                  ) : (
                    <Text style={styles.verifyText}>Verify OTP</Text>
                  )}
                </TouchableOpacity>
              );
            })()}
          </View>

          {/* Resend OTP (outside card) */}
          <TouchableOpacity
            style={styles.resendRow}
            onPress={handleResend}
            disabled={resendIn > 0 || resending}
            activeOpacity={0.7}
          >
            <Ionicons
              name="refresh"
              size={14}
              color={resendIn > 0 ? 'rgba(255,255,255,0.55)' : '#fff'}
            />
            <Text
              style={[
                styles.resendText,
                resendIn > 0 && { color: 'rgba(255,255,255,0.55)' },
              ]}
            >
              {resending
                ? 'Resending…'
                : resendIn > 0
                ? `Resend OTP (${fmt(resendIn)})`
                : 'Resend OTP'}
            </Text>
          </TouchableOpacity>
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

  // KEY: justifyContent center vertically centers card
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
    paddingHorizontal: 20,
    paddingTop: 14,
    paddingBottom: 22,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.18,
    shadowRadius: 18,
    elevation: 12,
  },

  backRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 6 },
  backText: { color: '#3A3A3A', fontSize: 12.5, fontWeight: '600' },

  shieldWrap: { alignItems: 'center', marginTop: 4, marginBottom: 12 },
  shieldCircle: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: GREEN_SOFT,
    alignItems: 'center',
    justifyContent: 'center',
  },

  title: {
    color: '#1A1A1A',
    fontSize: 20,
    fontWeight: '700',
    textAlign: 'center',
    marginBottom: 4,
  },
  subtitle: {
    color: '#7E7E7E',
    fontSize: 12,
    textAlign: 'center',
    marginBottom: 20,
  },

  otpRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 16,
  },
  otpBox: {
    width: 42,
    height: 46,
    borderWidth: 1.2,
    borderColor: '#E5E5E5',
    borderRadius: 8,
    fontSize: 18,
    fontWeight: '700',
    color: '#1A1A1A',
    backgroundColor: '#FAFAFA',
  },
  otpBoxFilled: {
    borderColor: GREEN_PRIMARY,
    backgroundColor: '#F4FBF3',
  },

  validity: {
    textAlign: 'center',
    color: '#7E7E7E',
    fontSize: 12,
    marginBottom: 18,
  },

  verifyBtn: {
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
  verifyBtnDisabled: {
    backgroundColor: '#C6E5BF',
    shadowOpacity: 0,
    elevation: 0,
  },
  verifyText: {
    color: '#FFFFFF',
    fontSize: 15,
    fontWeight: '700',
    letterSpacing: 0.3,
  },

  resendRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 18,
    gap: 6,
  },
  resendText: {
    color: '#fff',
    fontSize: 12.5,
    fontWeight: '600',
  },
});
