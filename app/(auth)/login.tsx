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

  const validateEmail = (e: string) =>
    /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e.trim());

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
      Alert.alert('Invalid email', 'Please enter a valid email address.');
      return;
    }

    try {
      setLoading(true);
      const res = await authAPI.login(email.trim(), password);
      await AsyncStorage.setItem('token', res.data.token);
      await AsyncStorage.setItem('user', JSON.stringify(res.data.user));
      if (remember) {
        await AsyncStorage.setItem('rememberedEmail', email.trim());
      } else {
        await AsyncStorage.removeItem('rememberedEmail');
      }
      router.replace('/(tabs)/');
    } catch (err: any) {
      Alert.alert(
        'Login Failed',
        err?.response?.data?.message || 'Invalid credentials'
      );
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
    paddingVertical: 40,
    justifyContent: 'center', // vertically center card like Figma
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
