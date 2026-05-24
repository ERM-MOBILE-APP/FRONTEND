import React, { useEffect, useRef, useState, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Image,
  Modal,
  Pressable,
  Animated,
  Dimensions,
} from 'react-native';
import { Ionicons, Feather, MaterialCommunityIcons } from '@expo/vector-icons';
import { router } from 'expo-router';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { profileAPI } from '../services/api';

type Props = {
  visible: boolean;
  onClose: () => void;
  user?: {
    name?: string;
    designation?: string;
    photoUrl?: string;
  };
};

type MenuItem = {
  label: string;
  icon: React.ReactNode;
  route: string;
};

const { width: SCREEN_W } = Dimensions.get('window');
const DRAWER_W = Math.min(310, SCREEN_W * 0.82);

/**
 * Render any designation/name field safely. The cached `user` blob in
 * AsyncStorage was written by login/auth flows that sometimes stored
 * `designation` as an ObjectId (24-char hex). The Profile screen's
 * `/api/profile` response now resolves that to a real string, but until
 * the drawer refreshes from the network we may still be looking at a
 * stale ObjectId. Reject anything that looks like raw hex so the drawer
 * never shows `6a14...2de` under the name.
 */
const isHexId = (s: any) => typeof s === 'string' && /^[a-f0-9]{24}$/i.test(s.trim());
const safe = (v?: any): string => {
  if (v == null) return '';
  if (typeof v === 'string') return isHexId(v) ? '' : v.trim();
  if (typeof v === 'object') {
    // populated designation doc → use its title; populated department → name
    if (typeof v.title === 'string') return v.title;
    if (typeof v.name  === 'string') return v.name;
  }
  return '';
};

export default function SideDrawer({ visible, onClose, user }: Props) {
  const slide = useRef(new Animated.Value(-DRAWER_W)).current;

  // The drawer keeps its OWN copy of profile data, fetched from the same
  // /api/profile endpoint the Profile tab uses. This guarantees the name
  // and designation shown here are identical to what the Profile screen
  // shows — no chance of the two drifting apart because of stale cache.
  const [profile, setProfile] = useState<{ name?: string; designation?: string; photoUrl?: string }>({});

  const loadProfile = useCallback(async () => {
    // 1. Paint immediately from AsyncStorage so the drawer never flashes
    //    blank when it first opens.
    try {
      const cached = await AsyncStorage.getItem('user');
      if (cached) {
        const p = JSON.parse(cached);
        setProfile((cur) => ({ ...cur, ...p }));
      }
    } catch {/* ignore */}

    // 2. Then refresh from /api/profile — same source the Profile tab
    //    uses, with ObjectId references already resolved server-side.
    try {
      const res  = await profileAPI.getProfile();
      const data = res?.data || {};
      setProfile({
        name:        data.name,
        designation: data.designation,
        photoUrl:    data.photoUrl,
      });
      // Also update the AsyncStorage copy so the next render of any screen
      // that reads from cache sees the resolved values.
      try {
        const merged = { ...JSON.parse((await AsyncStorage.getItem('user')) || '{}'), ...data };
        await AsyncStorage.setItem('user', JSON.stringify(merged));
      } catch {/* ignore */}
    } catch {/* offline / cold start — keep cached values */}
  }, []);

  // Slide animation + fetch when the drawer opens.
  useEffect(() => {
    Animated.timing(slide, {
      toValue: visible ? 0 : -DRAWER_W,
      duration: 250,
      useNativeDriver: true,
    }).start();
    if (visible) loadProfile();
  }, [visible, slide, loadProfile]);

  const go = (route: string) => {
    onClose();
    setTimeout(() => router.push(route as any), 60);
  };

  const menu: MenuItem[] = [
    {
      label: 'Profile',
      icon: <Ionicons name="person-outline" size={20} color="#1A1A1A" />,
      route: '/(tabs)/profile',
    },
    {
      label: 'Leave',
      icon: <Ionicons name="add-circle-outline" size={20} color="#1A1A1A" />,
      route: '/(tabs)/leave',
    },
    {
      label: 'Attendance',
      icon: (
        <MaterialCommunityIcons name="account-check-outline" size={20} color="#1A1A1A" />
      ),
      route: '/(tabs)/attendance',
    },
    {
      label: 'Allowance',
      icon: <Feather name="credit-card" size={18} color="#1A1A1A" />,
      route: '/(tabs)/allowance',
    },
    {
      label: 'Pay Slip',
      icon: <Ionicons name="receipt-outline" size={20} color="#1A1A1A" />,
      route: '/(tabs)/payslip',
    },
    {
      label: 'Complaint',
      icon: (
        <MaterialCommunityIcons name="account-question-outline" size={20} color="#1A1A1A" />
      ),
      route: '/complaint',
    },
    {
      label: 'Announcement',
      icon: <Ionicons name="megaphone-outline" size={20} color="#1A1A1A" />,
      route: '/announcement',
    },
  ];

  // Pick the best available value for each field, preferring the freshly
  // fetched profile over the prop blob the parent passed in. `safe()`
  // strips ObjectId-shaped strings (cached from older auth payloads).
  const displayName        = safe(profile.name)        || safe(user?.name);
  const displayDesignation = safe(profile.designation) || safe(user?.designation);
  const displayPhoto       = profile.photoUrl || user?.photoUrl;

  const initial = (displayName && displayName.trim()[0]?.toUpperCase()) || '?';

  return (
    <Modal visible={visible} transparent animationType="none" onRequestClose={onClose}>
      <View style={styles.overlay}>
        <Pressable style={styles.backdrop} onPress={onClose} />

        <Animated.View
          style={[
            styles.drawer,
            { width: DRAWER_W, transform: [{ translateX: slide }] },
          ]}
        >
          {/* Header */}
          <View style={styles.header}>
            <View style={styles.avatar}>
              {displayPhoto ? (
                <Image source={{ uri: displayPhoto }} style={styles.avatarImg} />
              ) : (
                <Text style={styles.avatarInitial}>{initial}</Text>
              )}
            </View>
            {/* Name and designation match the Profile screen exactly —
                both read from /api/profile via profileAPI.getProfile(). */}
            <Text style={styles.name}>{displayName || '—'}</Text>
            <Text style={styles.role}>{displayDesignation || '—'}</Text>
          </View>

          <View style={styles.divider} />

          {/* Menu */}
          <View style={styles.menu}>
            {menu.map((m) => (
              <TouchableOpacity
                key={m.label}
                style={styles.menuItem}
                onPress={() => go(m.route)}
                activeOpacity={0.7}
              >
                <View style={styles.menuIcon}>{m.icon}</View>
                <Text style={styles.menuLabel}>{m.label}</Text>
              </TouchableOpacity>
            ))}
          </View>
        </Animated.View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    flexDirection: 'row',
  },
  backdrop: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    left: 0,
    right: 0,
    backgroundColor: 'rgba(0,0,0,0.4)',
  },
  drawer: {
    backgroundColor: '#FFFFFF',
    height: '100%',
    paddingTop: 60,
    shadowColor: '#000',
    shadowOpacity: 0.18,
    shadowOffset: { width: 2, height: 0 },
    shadowRadius: 12,
    elevation: 12,
  },

  header: {
    paddingHorizontal: 22,
    paddingBottom: 18,
  },
  avatar: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: '#E8F5E9',
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
    marginBottom: 14,
  },
  avatarImg: { width: '100%', height: '100%' },
  avatarInitial: {
    fontSize: 26,
    color: '#2E7D32',
    fontWeight: '800',
  },
  name: { fontSize: 17, fontWeight: '800', color: '#1A1A1A' },
  role: { fontSize: 12, color: '#8A8A8A', marginTop: 2 },

  divider: {
    height: 1,
    backgroundColor: '#EFEFEF',
    marginHorizontal: 22,
  },

  menu: {
    paddingHorizontal: 16,
    paddingTop: 12,
  },
  menuItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 14,
    paddingHorizontal: 6,
  },
  menuIcon: {
    width: 30,
    alignItems: 'center',
    marginRight: 8,
  },
  menuLabel: {
    fontSize: 15,
    color: '#1A1A1A',
    fontWeight: '600',
  },
});
