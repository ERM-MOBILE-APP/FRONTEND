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
import { router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { authAPI } from '../../services/api';

const { width: SCREEN_W, height: SCREEN_H } = Dimensions.get('window');

// ---------- Grid Background (shared visual with login) ----------
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

// ---------- Email Verify Screen ----------
export default function EmailVerifyScreen() {
  const [email, setEmail] = useState('');
  const [loading, setLoading] = useState(false);

  const validateEmail = (e: string) =>
    /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e.trim());

  const handleSendOtp = async () => {
    if (!email.trim()) {
      Alert.alert('Missing email', 'Please enter your registered email.');
      return;
    }
    if (!validateEmail(email)) {
      Alert.alert('Invalid email', 'Please enter a valid email address.');
      return;
    }

    try {
      setLoading(true);
      const res = await authAPI.sendOtp(email.trim());
      Alert.alert(
        'OTP Sent',
        res?.data?.message ||
          `An OTP has been sent to ${email.trim()}. Please check your inbox.`,
        [{ text: 'OK', onPress: () => router.back() }]
      );
    } catch (err: any) {
      Alert.alert(
        'Could not send OTP',
        err?.response?.data?.message ||
          'Something went wrong. Please try again.'
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

          {/* Card */}
          <View style={styles.card}>
            {/* Header row: back arrow + title */}
            <View style={styles.headerRow}>
              <TouchableOpacity
                style={styles.backBtn}
                onPress={() => router.back()}
                hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
                activeOpacity={0.7}
              >
                <Ionicons name="chevron-back" size={22} color="#222" />
              </TouchableOpacity>
              <Text style={styles.cardTitle}>Change your Password</Text>
              <View style={styles.backBtn} />
            </View>

            <Text style={styles.cardSubtitle}>
              We'll send an OTP to your work email
            </Text>

            {/* Email label */}
            <Text style={styles.label}>Your Registered Email</Text>

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

            {/* Info Box */}
            <View style={styles.infoBox}>
              <View style={styles.infoBoxAccent} />
              <Text style={styles.infoText}>
                An OTP will be sent to this email to verify your identity
                before setting a new password.
              </Text>
            </View>

            {/* Send OTP Button */}
            <TouchableOpacity
              style={[styles.sendBtn, loading && { opacity: 0.85 }]}
              onPress={handleSendOtp}
              disabled={loading}
              activeOpacity={0.9}
            >
              {loading ? (
                <ActivityIndicator color="#fff" />
              ) : (
                <Text style={styles.sendText}>Send OTP</Text>
              )}
            </TouchableOpacity>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </View>
  );
}

// ---------- Theme (must match login screen) ----------
const GREEN_BG = '#2E8C2C';
const GREEN_BG_DARK = '#1F6A1E';
const GREEN_PRIMARY = '#3FAE3B';
const GRID_LINE = 'rgba(255,255,255,0.06)';
const GRID_DOT = 'rgba(255,255,255,0.18)';

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: GREEN_BG },

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
    paddingTop: 90,
    paddingBottom: 40,
  },

  logoWrap: { alignItems: 'center', marginBottom: 40 },
  logo: {
    // matches logo.png native ratio 145:40 (~3.6:1)
    width: 190,
    height: 52,
  },

  card: {
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    paddingHorizontal: 20,
    paddingTop: 18,
    paddingBottom: 22,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.18,
    shadowRadius: 18,
    elevation: 12,
  },

  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 6,
  },
  backBtn: {
    width: 28,
    height: 28,
    alignItems: 'flex-start',
    justifyContent: 'center',
  },
  cardTitle: {
    flex: 1,
    textAlign: 'center',
    color: '#1A1A1A',
    fontSize: 16,
    fontWeight: '700',
  },
  cardSubtitle: {
    textAlign: 'center',
    color: '#7E7E7E',
    fontSize: 12,
    marginBottom: 22,
  },

  label: {
    color: '#3A3A3A',
    fontSize: 12.5,
    fontWeight: '600',
    marginBottom: 8,
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

  infoBox: {
    flexDirection: 'row',
    backgroundColor: '#F4FBF3',
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 12,
    marginBottom: 22,
    overflow: 'hidden',
  },
  infoBoxAccent: {
    position: 'absolute',
    left: 0,
    top: 0,
    bottom: 0,
    width: 3,
    backgroundColor: GREEN_PRIMARY,
    borderTopLeftRadius: 8,
    borderBottomLeftRadius: 8,
  },
  infoText: {
    color: '#4A4A4A',
    fontSize: 11.5,
    lineHeight: 16,
    flex: 1,
    marginLeft: 6,
  },

  sendBtn: {
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
  sendText: {
    color: '#FFFFFF',
    fontSize: 15,
    fontWeight: '700',
    letterSpacing: 0.3,
  },
});
