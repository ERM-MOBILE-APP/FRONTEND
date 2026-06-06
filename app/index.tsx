/**
 * Entry router — checks AsyncStorage for a saved token BEFORE redirecting.
 * Earlier we always sent users to /(auth)/login, so every cold start (or
 * swipe-from-recents kill) felt like a fresh logout. Now we:
 *   1. read the 'token' key (the same key services/api.ts writes on login)
 *   2. if present → straight to (tabs)
 *   3. otherwise → /(auth)/login
 *
 * Token validity is verified server-side on the next API call — if it has
 * expired or been revoked, the api.ts interceptor handles the 401 and
 * sends the user back to login. So this entry check is intentionally
 * "trust then verify" rather than blocking startup on a network round-trip.
 */
import { useEffect, useState } from 'react';
import { Redirect } from 'expo-router';
import { View, ActivityIndicator } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';

export default function Index() {
  const [target, setTarget] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      let token = '';
      try {
        token = (await AsyncStorage.getItem('token')) || '';
      } catch {
        /* AsyncStorage failure on cold start — treat as logged-out */
      }
      if (cancelled) return;
      setTarget(token ? '/(tabs)' : '/(auth)/login');
    })();
    return () => { cancelled = true; };
  }, []);

  if (target === null) {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: '#fff' }}>
        <ActivityIndicator size="large" color="#2E7D32" />
      </View>
    );
  }
  return <Redirect href={target as any} />;
}
