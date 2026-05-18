import React, { useState, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
  Alert,
  Image,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Ionicons } from '@expo/vector-icons';
import { attendanceAPI } from '../../services/api';
import AttendanceCalendar from '../../components/AttendanceCalendar';

type WorkLocation = 'remote' | 'office';

const ANNOUNCEMENTS = [
  {
    title: 'Office Holiday Notice',
    body: 'Office will remain closed for the upcoming public holiday...',
    meta: 'Posted by HR  •  2h ago',
  },
  {
    title: 'Office Holiday Notice',
    body: 'Office will remain closed for the upcoming public holiday...',
    meta: 'Posted by HR  •  1d ago',
  },
];

export default function HomeScreen() {
  const [user, setUser] = useState<any>(null);
  const [now, setNow] = useState(new Date());
  const [location, setLocation] = useState<WorkLocation>('office');
  const [checkedIn, setCheckedIn] = useState(false);
  const [checkedOut, setCheckedOut] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);

  const refreshToday = useCallback(async () => {
    try {
      const res = await attendanceAPI.today();
      const data = res?.data || {};
      setCheckedIn(!!data.checkIn);
      setCheckedOut(!!data.checkOut);
      if (data.location === 'remote' || data.location === 'office') {
        setLocation(data.location);
      }
    } catch {
      // ignore — backend may be offline
    }
  }, []);

  useEffect(() => {
    AsyncStorage.getItem('user')
      .then((u) => {
        if (u) {
          try {
            setUser(JSON.parse(u));
          } catch {
            setUser(null);
          }
        }
      })
      .catch(() => {});

    const t = setInterval(() => setNow(new Date()), 1000);
    refreshToday();
    return () => clearInterval(t);
  }, [refreshToday]);

  const formatTime = (d: Date) => {
    try {
      return d
        .toLocaleTimeString('en-US', {
          hour: '2-digit',
          minute: '2-digit',
          hour12: true,
        })
        .toUpperCase();
    } catch {
      return '';
    }
  };

  const formatDate = (d: Date) => {
    try {
      const day = d.getDate();
      const month = d.toLocaleString('default', { month: 'short' });
      const year = d.getFullYear();
      const weekday = d.toLocaleString('default', { weekday: 'long' });
      return `${month} ${day}, ${year} - ${weekday}`;
    } catch {
      return '';
    }
  };

  const handlePressFingerprint = async () => {
    try {
      if (!checkedIn) {
        await attendanceAPI.checkIn(location);
        setCheckedIn(true);
        Alert.alert('Checked In', 'Have an awesome day!');
      } else if (!checkedOut) {
        await attendanceAPI.checkOut();
        setCheckedOut(true);
        Alert.alert('Checked Out', 'See you tomorrow!');
      } else {
        Alert.alert(
          'Done for today',
          'Both check-in and check-out are recorded.'
        );
      }
      setRefreshKey((k) => k + 1);
    } catch (err: any) {
      Alert.alert(
        'Error',
        err?.response?.data?.message || 'Could not record attendance'
      );
    }
  };

  const buttonLabel = !checkedIn
    ? 'Check In'
    : !checkedOut
    ? 'Check Out'
    : 'Done';

  const greeting = (() => {
    const h = now.getHours();
    if (h < 12) return 'Morning';
    if (h < 17) return 'Afternoon';
    return 'Evening';
  })();

  const firstName =
    (user?.name && String(user.name).split(' ')[0]?.toLowerCase()) || 'hari';

  return (
    <View style={styles.root}>
      <SafeAreaView edges={['top']} style={styles.safe}>
        <ScrollView
          contentContainerStyle={{ paddingBottom: 32 }}
          showsVerticalScrollIndicator={false}
        >
          {/* Green header */}
          <View style={styles.greenHeader}>
            <View style={styles.topRow}>
              <View style={{ flex: 1 }}>
                <Image
                  source={require('../../assets/logo.png')}
                  style={styles.logoImage}
                  resizeMode="contain"
                />
                <Text style={styles.greeting}>
                  {greeting} {firstName}, remember to check in
                </Text>
              </View>
              <TouchableOpacity style={styles.bellBtn} activeOpacity={0.7}>
                <Ionicons name="notifications" size={20} color="#1B5E20" />
                <View style={styles.bellDot} />
              </TouchableOpacity>
            </View>
          </View>

          {/* White check-in card */}
          <View style={styles.checkCard}>
            <Text style={styles.timeText}>{formatTime(now)}</Text>
            <Text style={styles.dateText}>{formatDate(now)}</Text>

            <View style={styles.locationRow}>
              <LocationRadio
                label="Remote"
                selected={location === 'remote'}
                onPress={() => setLocation('remote')}
              />
              <View style={{ width: 30 }} />
              <LocationRadio
                label="Office"
                selected={location === 'office'}
                onPress={() => setLocation('office')}
              />
            </View>

            <TouchableOpacity
              onPress={handlePressFingerprint}
              activeOpacity={0.85}
              style={styles.fingerprintOuter}
            >
              <View style={styles.ring3}>
                <View style={styles.ring2}>
                  <View style={styles.ring1}>
                    <View style={styles.fpInner}>
                      <Ionicons
                        name="finger-print"
                        size={42}
                        color="#FFFFFF"
                      />
                      <Text style={styles.fpLabel}>{buttonLabel}</Text>
                    </View>
                  </View>
                </View>
              </View>
            </TouchableOpacity>

            <Text style={styles.cardHint}>
              {checkedOut
                ? "You're all set! Enjoy your evening."
                : checkedIn
                ? "You're checked in. Tap again when you leave."
                : 'Check in and kick off your awesome day!'}
            </Text>
          </View>

          {/* Calendar */}
          <AttendanceCalendar refreshKey={refreshKey} />

          {/* Announcements */}
          <View style={styles.annCard}>
            <View style={styles.annHeader}>
              <Text style={styles.annTitle}>Announcement</Text>
              <Ionicons name="megaphone-outline" size={16} color="#1B5E20" />
            </View>
            <Text style={styles.annSub}>
              Latest company updates and important notices
            </Text>

            {ANNOUNCEMENTS.map((a, idx) => (
              <View key={idx} style={styles.annItem}>
                <View style={styles.annIcon}>
                  <Ionicons name="calendar" size={18} color="#FFFFFF" />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.annItemTitle}>{a.title}</Text>
                  <Text style={styles.annItemBody}>{a.body}</Text>
                  <Text style={styles.annItemMeta}>{a.meta}</Text>
                </View>
              </View>
            ))}
          </View>
        </ScrollView>
      </SafeAreaView>
    </View>
  );
}

function LocationRadio({
  label,
  selected,
  onPress,
}: {
  label: string;
  selected: boolean;
  onPress: () => void;
}) {
  return (
    <TouchableOpacity
      onPress={onPress}
      style={styles.radioRow}
      activeOpacity={0.7}
    >
      <View style={[styles.radioOuter, selected && styles.radioOuterActive]}>
        {selected && <View style={styles.radioDot} />}
      </View>
      <Text style={styles.radioLabel}>{label}</Text>
    </TouchableOpacity>
  );
}

const GREEN = '#4CAF50';
const DARK_GREEN = '#1B5E20';
const CREAM = '#FFFBEE';

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: CREAM },
  safe: { flex: 1 },

  greenHeader: {
    backgroundColor: GREEN,
    paddingHorizontal: 18,
    paddingTop: 8,
    paddingBottom: 80,
  },
  topRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
  },

  logoImage: { width: 110, height: 32 },
  greeting: { color: '#FFFFFF', fontSize: 12, marginTop: 8, opacity: 0.95 },

  bellBtn: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: '#FFFFFF',
    alignItems: 'center',
    justifyContent: 'center',
  },
  bellDot: {
    position: 'absolute',
    top: 8,
    right: 9,
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: '#F44336',
    borderWidth: 1.5,
    borderColor: '#FFFFFF',
  },

  checkCard: {
    backgroundColor: '#FFFFFF',
    marginHorizontal: 16,
    marginTop: -60,
    borderRadius: 18,
    paddingVertical: 20,
    paddingHorizontal: 18,
    alignItems: 'center',
    shadowColor: '#000',
    shadowOpacity: 0.08,
    shadowOffset: { width: 0, height: 4 },
    shadowRadius: 12,
    elevation: 5,
  },
  timeText: { fontSize: 30, fontWeight: '800', color: '#111' },
  dateText: { fontSize: 12, color: '#555', marginTop: 4 },

  locationRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 14,
    marginBottom: 14,
  },
  radioRow: { flexDirection: 'row', alignItems: 'center' },
  radioOuter: {
    width: 16,
    height: 16,
    borderRadius: 8,
    borderWidth: 1.5,
    borderColor: '#9A9A9A',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 6,
  },
  radioOuterActive: { borderColor: DARK_GREEN },
  radioDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: DARK_GREEN },
  radioLabel: { fontSize: 13, color: '#1A1A1A', fontWeight: '500' },

  fingerprintOuter: {
    marginTop: 6,
    alignItems: 'center',
    justifyContent: 'center',
  },
  ring3: {
    width: 200,
    height: 200,
    borderRadius: 100,
    backgroundColor: 'rgba(76, 175, 80, 0.10)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  ring2: {
    width: 165,
    height: 165,
    borderRadius: 82.5,
    backgroundColor: 'rgba(76, 175, 80, 0.18)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  ring1: {
    width: 135,
    height: 135,
    borderRadius: 67.5,
    backgroundColor: 'rgba(76, 175, 80, 0.30)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  fpInner: {
    width: 108,
    height: 108,
    borderRadius: 54,
    backgroundColor: GREEN,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: GREEN,
    shadowOpacity: 0.4,
    shadowOffset: { width: 0, height: 6 },
    shadowRadius: 10,
    elevation: 6,
  },
  fpLabel: { color: '#FFFFFF', fontWeight: '700', fontSize: 12, marginTop: 2 },
  cardHint: {
    marginTop: 14,
    fontSize: 11,
    color: '#7A7A7A',
    textAlign: 'center',
  },

  annCard: {
    backgroundColor: CREAM,
    marginHorizontal: 16,
    marginTop: 14,
    borderRadius: 16,
    paddingHorizontal: 14,
    paddingVertical: 16,
  },
  annHeader: { flexDirection: 'row', alignItems: 'center' },
  annTitle: {
    fontSize: 15,
    fontWeight: '700',
    color: '#111',
    marginRight: 6,
  },
  annSub: { color: '#7A7A7A', fontSize: 12, marginTop: 2 },
  annItem: {
    flexDirection: 'row',
    marginTop: 14,
    paddingBottom: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#F0EAD2',
  },
  annIcon: {
    width: 38,
    height: 38,
    borderRadius: 10,
    backgroundColor: GREEN,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
  },
  annItemTitle: { fontSize: 13, fontWeight: '700', color: '#1A1A1A' },
  annItemBody: { fontSize: 12, color: '#555', marginTop: 2, lineHeight: 16 },
  annItemMeta: { fontSize: 10, color: '#9A9A9A', marginTop: 6 },
});
