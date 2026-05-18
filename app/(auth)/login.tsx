import React, { useState } from 'react';
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
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { authAPI } from '../../services/api';

export default function LoginScreen() {
  const [userId, setUserId] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [remember, setRemember] = useState(false);
  const [loading, setLoading] = useState(false);

  const handleLogin = async () => {
    if (!userId || !password) {
      Alert.alert('Error', 'Please fill all fields');
      return;
    }
    try {
      setLoading(true);
      const res = await authAPI.login(userId, password);
      await AsyncStorage.setItem('token', res.data.token);
      await AsyncStorage.setItem('user', JSON.stringify(res.data.user));
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
    <KeyboardAvoidingView
      style={styles.root}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <ScrollView
        contentContainerStyle={{ flexGrow: 1 }}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.hero}>
          <Image
            source={require('../../assets/logo.png')}
            style={styles.logo}
            resizeMode="contain"
          />
          <Text style={styles.title}>Sign in to your{'\n'}Account</Text>
          <Text style={styles.subtitle}>
            Enter your email and password to log in
          </Text>
        </View>

        <View style={styles.content}>
          <View style={styles.card}>
            <TextInput
              style={styles.input}
              placeholder="Enter user id"
              placeholderTextColor="#A8A8A8"
              value={userId}
              onChangeText={setUserId}
              autoCapitalize="none"
            />

            <View style={styles.passwordRow}>
              <TextInput
                style={styles.passwordInput}
                placeholder="Enter password"
                placeholderTextColor="#A8A8A8"
                secureTextEntry={!showPassword}
                value={password}
                onChangeText={setPassword}
              />
              <TouchableOpacity
                onPress={() => setShowPassword(!showPassword)}
                style={styles.eyeBtn}
              >
                <Ionicons
                  name={showPassword ? 'eye-outline' : 'eye-off-outline'}
                  size={20}
                  color="#7A7A7A"
                />
              </TouchableOpacity>
            </View>

            <TouchableOpacity
              style={styles.rememberRow}
              onPress={() => setRemember(!remember)}
              activeOpacity={0.7}
            >
              <View
                style={[styles.checkbox, remember && styles.checkboxChecked]}
              >
                {remember && (
                  <Ionicons name="checkmark" size={11} color="#fff" />
                )}
              </View>
              <Text style={styles.rememberText}>Remember me</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.loginBtn}
              onPress={handleLogin}
              disabled={loading}
              activeOpacity={0.88}
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
  );
}

const GREEN = '#4CAF50';
const GREEN_DARK = '#388E3C';

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#FFFFFF' },

  hero: {
    backgroundColor: GREEN,
    paddingTop: 80,
    paddingBottom: 110,
    paddingHorizontal: 24,
    alignItems: 'center',
  },
  logo: {
    width: 180,
    height: 60,
    marginBottom: 26,
  },
  title: {
    color: '#FFFFFF',
    fontSize: 26,
    fontWeight: '800',
    textAlign: 'center',
    lineHeight: 34,
  },
  subtitle: {
    color: 'rgba(255,255,255,0.9)',
    fontSize: 13,
    marginTop: 12,
    textAlign: 'center',
  },

  content: { paddingHorizontal: 22, paddingBottom: 32 },
  card: {
    backgroundColor: '#FFFFFF',
    marginTop: -80,
    borderRadius: 16,
    paddingHorizontal: 22,
    paddingTop: 24,
    paddingBottom: 24,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.12,
    shadowRadius: 14,
    elevation: 10,
  },

  input: {
    borderWidth: 1,
    borderColor: '#EAEAEA',
    borderRadius: 10,
    paddingHorizontal: 16,
    paddingVertical: 14,
    fontSize: 14,
    color: '#111',
    marginBottom: 14,
  },
  passwordRow: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#EAEAEA',
    borderRadius: 10,
    marginBottom: 16,
  },
  passwordInput: {
    flex: 1,
    paddingHorizontal: 16,
    paddingVertical: 14,
    fontSize: 14,
    color: '#111',
  },
  eyeBtn: { paddingHorizontal: 14, paddingVertical: 10 },

  rememberRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 22 },
  checkbox: {
    width: 16,
    height: 16,
    borderWidth: 1.4,
    borderColor: '#C7C7C7',
    borderRadius: 3,
    marginRight: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  checkboxChecked: { backgroundColor: GREEN, borderColor: GREEN },
  rememberText: { color: '#808080', fontSize: 13 },

  loginBtn: {
    backgroundColor: GREEN,
    borderRadius: 10,
    paddingVertical: 16,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: GREEN_DARK,
    shadowOpacity: 0.3,
    shadowOffset: { width: 0, height: 4 },
    shadowRadius: 8,
    elevation: 4,
  },
  loginText: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: '700',
  },
});
