import React, { useState, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
  Image,
  Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Feather } from '@expo/vector-icons';
import { router, useFocusEffect } from 'expo-router';
import { profileAPI, attendanceAPI } from '../../services/api';
import { stopBackgroundLocationUpdates } from '../../services/locationTask';
// #322 — Per-screen error boundary. If anything inside Profile throws
// during render, this catches it locally and shows a 'Try again' card.
// The rest of the app (other tabs, GPS task, session) stays alive
// instead of the whole app reloading.
import ScreenErrorBoundary from '../../components/ScreenErrorBoundary';


type UserProfile = {
  _id?: string;
  userId?: string;
  name?: string;
  designation?: string;
  email?: string;
  phone?: string;
  dob?: string;
  gender?: string;
  bloodGroup?: string;
  photoUrl?: string;
  address?: string;
};

// Placeholder for missing values. Kept in one place so no hard-coded test
// strings (like the old "20-09-2005" / "Bhvhjh@Gmail.Com") slip back in.
const EMPTY = 'Not set';

// Force joining date to plain dd-mm-yyyy. The backend stores it as an
// ISO string (e.g. '2024-09-20T00:00:00.000Z'). Any time/zone component
// is stripped before display.
const fmtJoiningDate = (v?: any): string => {
  if (!v) return EMPTY;
  const s = String(v).trim();
  if (!s) return EMPTY;
  // Already dd-mm-yyyy? leave it.
  const ddmm = s.match(/^(\d{2})-(\d{2})-(\d{4})/);
  if (ddmm) return `${ddmm[1]}-${ddmm[2]}-${ddmm[3]}`;
  // ISO yyyy-mm-dd or yyyy-mm-ddTHH:MM:SS
  const iso = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return `${iso[3]}-${iso[2]}-${iso[1]}`;
  // dd/mm/yyyy fallback
  const slash = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (slash) {
    const dd = slash[1].padStart(2, '0');
    const mm = slash[2].padStart(2, '0');
    return `${dd}-${mm}-${slash[3]}`;
  }
  // Last resort: parse as Date
  const d = new Date(s);
  if (!isNaN(d.getTime())) {
    const dd = String(d.getDate()).padStart(2, '0');
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    return `${dd}-${mm}-${d.getFullYear()}`;
  }
  return s;
};
// Render any value safely. If it arrives as an object (e.g. an old API
// response with nested address or a populated designation), flatten it to
// a readable string so the screen never displays "[object Object]" or a
// raw ObjectId hex.
const show = (v?: any): string => {
  if (v == null) return EMPTY;
  if (typeof v === 'string') {
    const s = v.trim();
    if (!s) return EMPTY;
    // Reject 24-char hex ObjectIds — they look like data but aren't readable.
    if (/^[a-f0-9]{24}$/i.test(s)) return EMPTY;
    return s;
  }
  if (typeof v === 'object') {
    if (typeof v.name  === 'string') return v.name;
    if (typeof v.title === 'string') return v.title;
    const flat = [v.street, v.city, v.state, v.zipCode, v.country].filter(Boolean).join(', ');
    if (flat) return flat;
    return EMPTY;
  }
  return String(v);
};

export default function ProfileScreen() {
  const [user, setUser] = useState<UserProfile>({});

  const loadProfile = useCallback(async () => {
    // Fast paint from cache, then refresh from server.
    try {
      const cached = await AsyncStorage.getItem('user');
      if (cached) setUser(JSON.parse(cached));
    } catch {}

    try {
      const res = await profileAPI.getProfile();
      const data = res?.data || {};
      setUser(data);
      AsyncStorage.setItem('user', JSON.stringify(data)).catch(() => {});
    } catch {
      // Network/server error → keep showing cached data.
    }
  }, []);

  useEffect(() => {
    loadProfile();
  }, [loadProfile]);

  // Re-fetch every time the Profile tab regains focus, so any change an
  // admin makes via admin.html appears immediately when the user comes
  // back to this screen.
  useFocusEffect(
    useCallback(() => {
      loadProfile();
    }, [loadProfile])
  );

  const handleLogout = async () => {
    Alert.alert('Log out', 'Are you sure you want to log out?', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Log out',
        style: 'destructive',
        onPress: async () => {
          // CRITICAL: stop the OS background location task BEFORE clearing
          // the token. Otherwise the task keeps running with a now-invalid
          // token, the foreground service notification stays up, and the
          // battery keeps draining for nothing. Mark the user offline on
          // the server too so HR sees the correct presence immediately.
          try { await attendanceAPI.setPresence('offline'); } catch {}
          try { await stopBackgroundLocationUpdates('user logout'); } catch {}
          await AsyncStorage.multiRemove(['token', 'user']);
          router.replace('/(auth)/login' as any);
        },
      },
    ]);
  };

  // Derived from the real name — no hard-coded "V" fallback.
  const initial = (user.name && user.name.trim()[0]?.toUpperCase()) || '?';

  return (
    <ScreenErrorBoundary name="Profile">
    <SafeAreaView edges={['top']} style={styles.safe}>

      <ScrollView
        contentContainerStyle={{ paddingBottom: 100 }}
        showsVerticalScrollIndicator={false}
      >
        {/* GREEN HEADER */}
        <View style={styles.greenHeader} />

        {/* AVATAR */}
        <View style={styles.avatarWrap}>
          <View style={styles.avatar}>
            {user.photoUrl ? (
              <Image source={{ uri: user.photoUrl }} style={styles.avatarImg} />
            ) : (
              <Text style={styles.avatarInitial}>{initial}</Text>
            )}
          </View>
        </View>

        {/* NAME + DESIGNATION */}
        <Text style={styles.name}>{user.name || EMPTY}</Text>
        <Text style={styles.designation}>
          {show(user.designation).toUpperCase()}
        </Text>

        {/* INFO CARDS — read-only.
            Profile fields can only be changed by HR / admin via the
            admin panel. Employees see their record but can't edit it. */}
        <View style={styles.infoList}>
          <InfoRow label="Employee ID" value={show((user as any).employeeId || user.userId)} />
          <InfoRow label="Mobile No"   value={show(user.phone)} />
          <InfoRow label="Email ID"    value={show(user.email)} />
          <InfoRow label="DOB"         value={show(user.dob)} />
          <InfoRow label="Blood Group" value={show(user.bloodGroup)} />
          <InfoRow label="Gender"      value={show(user.gender)} />
          <InfoRow label="Designation" value={show(user.designation)} />
          <InfoRow label="Department"  value={show((user as any).department)} />
          <InfoRow label="Joining Date" value={fmtJoiningDate((user as any).joiningDate)} />
          <InfoRow label="Address"     value={show(user.address)} />
        </View>

        {/* HR contact note — replaces the old inline-edit behaviour */}
        <View style={styles.noteBox}>
          <Feather name="info" size={14} color="#1565C0" />
          <Text style={styles.noteText}>
            To update any of these details, please contact HR.
          </Text>
        </View>

        {/* LOG OUT — round centered button (Jun 2026). Was an inline
            "Log out" link aligned left. HR asked for a primary action
            on its own row, so it now reads as a deliberate "log me out"
            tap and matches the destructive-but-recoverable design used
            for the Sign Out button in the desktop apps. */}
        <View style={styles.logoutWrap}>
          <TouchableOpacity
            style={styles.logoutCircle}
            onPress={handleLogout}
            activeOpacity={0.8}
            accessibilityLabel="Log out"
          >
            <Feather name="log-out" size={24} color="#FFFFFF" />
          </TouchableOpacity>
          <Text style={styles.logoutCaption}>Log out</Text>
        </View>
      </ScrollView>
    </SafeAreaView>
    </ScreenErrorBoundary>
  );;
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.infoCard}>
      <Text style={styles.infoLabel}>{label}</Text>
      <Text style={styles.infoValue}>{value}</Text>
    </View>
  );
}

const GREEN = '#4CAF50';

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#FFFFFF' },

  greenHeader: {
    backgroundColor: GREEN,
    height: 140,
    borderBottomLeftRadius: 18,
    borderBottomRightRadius: 18,
  },

  avatarWrap: {
    alignItems: 'center',
    marginTop: -65,
  },
  avatar: {
    width: 130,
    height: 130,
    borderRadius: 65,
    backgroundColor: '#E8F5E9',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 4,
    borderColor: '#FFFFFF',
    shadowColor: '#000',
    shadowOpacity: 0.12,
    shadowOffset: { width: 0, height: 6 },
    shadowRadius: 10,
    elevation: 6,
    overflow: 'hidden',
  },
  avatarImg: { width: '100%', height: '100%' },
  avatarInitial: {
    fontSize: 50,
    color: '#2E7D32',
    fontWeight: '800',
  },

  name: {
    textAlign: 'center',
    fontSize: 22,
    fontWeight: '800',
    color: '#1A1A1A',
    marginTop: 12,
  },
  designation: {
    textAlign: 'center',
    fontSize: 12,
    color: '#2E7D32',
    fontWeight: '700',
    letterSpacing: 1,
    marginTop: 4,
    marginBottom: 18,
  },

  infoList: { paddingHorizontal: 16 },
  infoCard: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    backgroundColor: '#FFFFFF',
    borderRadius: 30,
    paddingHorizontal: 18,
    paddingVertical: 14,
    marginBottom: 12,
    shadowColor: '#000',
    shadowOpacity: 0.06,
    shadowOffset: { width: 0, height: 2 },
    shadowRadius: 6,
    elevation: 2,
  },
  infoLabel: { fontSize: 12, color: '#777', fontWeight: '500' },
  infoValue: { fontSize: 14, color: '#1A1A1A', fontWeight: '700' },

  noteBox: {
    flexDirection: 'row',
    alignItems: 'center',
    marginHorizontal: 22,
    marginTop: 4,
    marginBottom: 18,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 10,
    backgroundColor: '#E3F2FD',
    borderWidth: 1,
    borderColor: '#BBDEFB',
  },
  noteText: {
    fontSize: 12,
    color: '#0D47A1',
    marginLeft: 8,
    flex: 1,
  },

  /* Legacy logoutRow/logoutText kept for any old reference but the new
     round button below replaces it. */
  logoutRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginLeft: 22,
    marginTop: 8,
  },
  logoutText: {
    color: '#F44336',
    fontSize: 14,
    fontWeight: '700',
  },

  /* Round, centered logout (Jun 2026) — Material-ish FAB shape. */
  logoutWrap: {
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 22,
    marginBottom: 28,
  },
  logoutCircle: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: '#F44336',
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#F44336',
    shadowOpacity: 0.35,
    shadowOffset: { width: 0, height: 6 },
    shadowRadius: 12,
    elevation: 6,
  },
  logoutCaption: {
    marginTop: 10,
    fontSize: 12,
    fontWeight: '700',
    color: '#F44336',
    letterSpacing: 0.4,
    textTransform: 'uppercase',
  },
});
