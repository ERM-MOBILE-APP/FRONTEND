import React, { useState, useMemo } from 'react';
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

// ---------- New Password Screen ----------
export default function NewPasswordScreen() {
  const params = useLocalSearchParams<{ email?: string; resetToken?: string }>();
  const email = (params.email as string) || '';
  const resetToken = (params.resetToken as string) || '';

  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [showPw, setShowPw] = useState(false);
  const [showCfm, setShowCfm] = useState(false);
  const [loading, setLoading] = useState(false);

  const pwRules = useMemo(
    () => ({
      length: password.length >= 6,
      letter: /[A-Za-z]/.test(password),
      number: /\d/.test(password),
      match: password.length > 0 && password === confirm,
    }),
    [password, confirm]
  );

  const isValid = pwRules.length && pwRules.letter && pwRules.number && pwRules.match;

  const handleReset = async () => {
    if (!isValid) return;
    if (!resetToken) {
      Alert.alert('Session expired', 'Please start over from forgot password.');
      router.replace('/(auth)/login');
      return;
    }

    try {
      setLoading(true);
      await authAPI.resetPassword(resetToken, password);
      router.replace({
        pathname: '/(auth)/success',
        params: { email },
      });
    } catch (err: any) {
      Alert.alert(
        'Could not reset password',
        err?.response?.data?.message || 'Try again.'
      );
    } finally {
      setLoading(false);
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
            <TouchableOpacity
              style={styles.backRow}
              onPress={() => router.back()}
              activeOpacity={0.7}
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            >
              <Ionicons name="chevron-back" size={16} color="#3A3A3A" />
              <Text style={styles.backText}>Back</Text>
            </TouchableOpacity>

            <View style={styles.iconWrap}>
              <View style={styles.iconCircle}>
                <Ionicons name="lock-closed" size={24} color={GREEN_PRIMARY} />
              </View>
            </View>

            <Text style={styles.title}>Set New Password</Text>
            <Text style={styles.subtitle}>
              Create a new password for your account
            </Text>

            <Text style={styles.label}>New Password</Text>
            <View style={styles.inputWrap}>
              <TextInput
                style={[styles.input, { paddingRight: 44 }]}
                placeholder="Enter new password"
                placeholderTextColor="#B7B7B7"
                value={password}
                onChangeText={setPassword}
                secureTextEntry={!showPw}
                autoCapitalize="none"
                autoCorrect={false}
              />
              <TouchableOpacity
                onPress={() => setShowPw(!showPw)}
                style={styles.eyeBtn}
                hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
              >
                <Ionicons
                  name={showPw ? 'eye-outline' : 'eye-off-outline'}
                  size={18}
                  color="#9A9A9A"
                />
              </TouchableOpacity>
            </View>

            <Text style={styles.label}>Confirm Password</Text>
            <View style={styles.inputWrap}>
              <TextInput
                style={[styles.input, { paddingRight: 44 }]}
                placeholder="Re-enter new password"
                placeholderTextColor="#B7B7B7"
                value={confirm}
                onChangeText={setConfirm}
                secureTextEntry={!showCfm}
                autoCapitalize="none"
                autoCorrect={false}
              />
              <TouchableOpacity
                onPress={() => setShowCfm(!showCfm)}
                style={styles.eyeBtn}
                hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
              >
                <Ionicons
                  name={showCfm ? 'eye-outline' : 'eye-off-outline'}
                  size={18}
                  color="#9A9A9A"
                />
              </TouchableOpacity>
            </View>

            {/* Rules */}
            <View style={styles.rules}>
              <Rule ok={pwRules.length} text="At least 6 characters" />
              <Rule ok={pwRules.letter} text="Contains a letter" />
              <Rule ok={pwRules.number} text="Contains a number" />
              <Rule ok={pwRules.match} text="Passwords match" />
            </View>

            <TouchableOpacity
              style={[
                styles.btn,
                (!isValid || loading) && styles.btnDisabled,
              ]}
              onPress={handleReset}
              disabled={!isValid || loading}
              activeOpacity={0.9}
            >
              {loading ? (
                <ActivityIndicator color="#fff" />
              ) : (
                <Text style={styles.btnText}>Reset Password</Text>
              )}
            </TouchableOpacity>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </View>
  );
}

function Rule({ ok, text }: { ok: boolean; text: string }) {
  return (
    <View style={styles.ruleRow}>
      <Ionicons
        name={ok ? 'checkmark-circle' : 'ellipse-outline'}
        size={13}
        color={ok ? GREEN_PRIMARY : '#C9C9C9'}
      />
      <Text style={[styles.ruleText, ok && { color: '#3A3A3A' }]}>{text}</Text>
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

  iconWrap: { alignItems: 'center', marginTop: 4, marginBottom: 12 },
  iconCircle: {
    width: 56, height: 56, borderRadius: 28,
    backgroundColor: GREEN_SOFT,
    alignItems: 'center', justifyContent: 'center',
  },

  title: {
    color: '#1A1A1A', fontSize: 18, fontWeight: '700',
    textAlign: 'center', marginBottom: 4,
  },
  subtitle: {
    color: '#7E7E7E', fontSize: 12, textAlign: 'center', marginBottom: 18,
  },

  label: {
    color: '#3A3A3A', fontSize: 12, fontWeight: '600',
    marginBottom: 6, marginTop: 4,
  },

  inputWrap: { position: 'relative', marginBottom: 10 },
  input: {
    borderWidth: 1, borderColor: '#ECECEC', backgroundColor: '#FAFAFA',
    borderRadius: 10, paddingHorizontal: 14,
    paddingVertical: Platform.OS === 'ios' ? 14 : 12,
    fontSize: 13.5, color: '#111',
  },
  eyeBtn: {
    position: 'absolute', right: 8, top: 0, bottom: 0,
    paddingHorizontal: 8, alignItems: 'center', justifyContent: 'center',
  },

  rules: {
    backgroundColor: '#FAFCFA', borderRadius: 8,
    padding: 10, marginTop: 6, marginBottom: 16,
  },
  ruleRow: { flexDirection: 'row', alignItems: 'center', marginVertical: 2 },
  ruleText: { color: '#9A9A9A', fontSize: 11.5, marginLeft: 6 },

  btn: {
    backgroundColor: GREEN_PRIMARY, borderRadius: 999,
    paddingVertical: 15,
    alignItems: 'center', justifyContent: 'center',
    shadowColor: GREEN_BG_DARK,
    shadowOpacity: 0.35, shadowOffset: { width: 0, height: 6 },
    shadowRadius: 10, elevation: 5,
  },
  btnDisabled: {
    backgroundColor: '#C6E5BF',
    shadowOpacity: 0, elevation: 0,
  },
  btnText: {
    color: '#FFFFFF', fontSize: 15, fontWeight: '700', letterSpacing: 0.3,
  },
});
