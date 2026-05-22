import React, { useState, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
  Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Ionicons, Feather } from '@expo/vector-icons';
import { router } from 'expo-router';
import { attendanceAPI, announcementAPI } from '../../services/api';
import SideDrawer from '../../components/SideDrawer';

type WorkLocation = 'remote' | 'office';

type TodayData = {
  shiftName?: string;
  checkIn?: string | null;
  checkOut?: string | null;
  workedHours?: number;
  location?: WorkLocation;
};

type Announcement = {
  _id: string;
  title: string;
  body: string;
  postedBy: string;
  createdAt: string;
};

export default function HomeScreen() {
  const [user, setUser] = useState<any>(null);
  const [now, setNow] = useState(new Date());
  const [today, setToday] = useState<TodayData>({});
  // Start empty — only show real announcements from the API. If the API
  // returns nothing we render an empty-state below instead of fake data.
  const [announcements, setAnnouncements] = useState<Announcement[]>([]);
  const [drawerOpen, setDrawerOpen] = useState(false);

  const checkedIn = !!today.checkIn;
  const checkedOut = !!today.checkOut;

  const refreshToday = useCallback(async () => {
    try {
      const res = await attendanceAPI.today();
      const data = res?.data || {};
      setToday({
        shiftName: data.shiftName || 'General Shift',
        checkIn: data.checkIn || null,
        checkOut: data.checkOut || null,
        workedHours: data.workedHours || 0,
        location: data.location || 'office',
      });
    } catch {
      setToday({ shiftName: 'General Shift' });
    }
  }, []);

  const refreshAnnouncements = useCallback(async () => {
    try {
      const res = await announcementAPI.list();
      // Always trust the server — set whatever it returned (even if empty)
      // so deleted announcements actually disappear.
      setAnnouncements(Array.isArray(res?.data) ? res.data : []);
    } catch {
      // network/server error → leave the current list alone
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
    refreshAnnouncements();
    return () => clearInterval(t);
  }, [refreshToday, refreshAnnouncements]);

  const formatLiveTime = (d: Date) => {
    const hours = d.getHours();
    const minutes = d.getMinutes();
    const seconds = d.getSeconds();
    const ampm = hours >= 12 ? 'PM' : 'AM';
    const h = hours % 12 === 0 ? 12 : hours % 12;
    return (
      String(h).padStart(2, '0') + ':' +
      String(minutes).padStart(2, '0') + ':' +
      String(seconds).padStart(2, '0') + ' ' + ampm
    );
  };

  const formatHourMin = (iso?: string | null) => {
    if (!iso) return '--:--';
    try {
      const d = new Date(iso);
      const hours = d.getHours();
      const minutes = d.getMinutes();
      const ampm = hours >= 12 ? 'Pm' : 'Am';
      const h = hours % 12 === 0 ? 12 : hours % 12;
      return String(h).padStart(2, '0') + ':' + String(minutes).padStart(2, '0') + ' ' + ampm;
    } catch {
      return '--:--';
    }
  };

  const computeWorkedHours = (): string => {
    if (!today.checkIn) return '00:00';
    const start = new Date(today.checkIn).getTime();
    const end = today.checkOut ? new Date(today.checkOut).getTime() : now.getTime();
    if (end <= start) return '00:00';
    const totalMin = Math.floor((end - start) / 60000);
    const hh = Math.floor(totalMin / 60);
    const mm = totalMin % 60;
    return String(hh).padStart(2, '0') + ':' + String(mm).padStart(2, '0');
  };

  const formatRelative = (iso: string) => {
    try {
      const diff = Date.now() - new Date(iso).getTime();
      const mins = Math.floor(diff / 60000);
      if (mins < 1) return 'just now';
      if (mins < 60) return mins + 'm ago';
      const hrs = Math.floor(mins / 60);
      if (hrs < 24) return hrs + 'h ago';
      const days = Math.floor(hrs / 24);
      return days + 'd ago';
    } catch {
      return '';
    }
  };

  const handleCheckPress = async () => {
    try {
      if (!checkedIn) {
        await attendanceAPI.checkIn(today.location || 'office');
        Alert.alert('Checked In', 'Have an awesome day!');
      } else if (!checkedOut) {
        await attendanceAPI.checkOut();
        Alert.alert('Checked Out', 'See you tomorrow!');
      } else {
        Alert.alert('Done for today', 'Both check-in and check-out are recorded.');
      }
      refreshToday();
    } catch (err: any) {
      Alert.alert('Error', err?.response?.data?.message || 'Could not record attendance');
    }
  };

  const buttonLabel = !checkedIn ? 'Check In' : !checkedOut ? 'Check Out' : 'Done';

  const greeting = (() => {
    const h = now.getHours();
    if (h < 12) return 'Good Morning';
    if (h < 17) return 'Good Afternoon';
    return 'Good Evening';
  })();

  const firstName =
    (user?.name && String(user.name).split(' ')[0]) || 'Vijay';

  return (
    <View style={styles.root}>
      <SafeAreaView edges={['top']} style={styles.safe}>
        <ScrollView
          contentContainerStyle={{ paddingBottom: 100 }}
          showsVerticalScrollIndicator={false}
        >
          {/* GREEN HEADER */}
          <View style={styles.greenHeader}>
            <View style={styles.topRow}>
              <TouchableOpacity
                style={styles.menuBtn}
                activeOpacity={0.7}
                onPress={() => setDrawerOpen(true)}
              >
                <Ionicons name="menu" size={22} color="#FFFFFF" />
              </TouchableOpacity>

              <View style={styles.greetingWrap}>
                <Text style={styles.greetingTitle}>
                  Hey {firstName} <Text style={styles.wave}>👋</Text>
                </Text>
                <Text style={styles.greetingSub}>
                  {greeting}! Mark Your Attendance{' '}
                  <Text style={styles.wave}>🎯</Text>
                </Text>
              </View>

              <TouchableOpacity
                style={styles.bellBtn}
                activeOpacity={0.7}
                onPress={() => router.push('/notifications' as any)}
              >
                <Ionicons name="notifications" size={20} color="#1A1A1A" />
                <View style={styles.bellDot} />
              </TouchableOpacity>
            </View>
          </View>

          {/* ATTENDANCE CARD */}
          <View style={styles.attCard}>
            <View style={styles.shiftPillWrap}>
              <View style={styles.shiftPill}>
                <Text style={styles.shiftPillText}>
                  {(today.shiftName || 'General Shift').toUpperCase()}
                </Text>
              </View>
            </View>

            <View style={styles.timeRow}>
              <Text style={styles.bigTime}>{formatLiveTime(now)}</Text>
              <TouchableOpacity
                onPress={handleCheckPress}
                activeOpacity={0.85}
                style={[
                  styles.checkBtn,
                  checkedOut && { backgroundColor: '#9E9E9E' },
                ]}
              >
                <Text style={styles.checkBtnText}>{buttonLabel}</Text>
              </TouchableOpacity>
            </View>

            <View style={styles.divider} />

            <View style={styles.statsRow}>
              <StatItem
                icon={<Feather name="log-in" size={20} color="#2E7D32" />}
                value={formatHourMin(today.checkIn)}
                label="Check In"
                color="#2E7D32"
              />
              <View style={styles.vDivider} />
              <StatItem
                icon={<Feather name="log-out" size={20} color="#1565C0" />}
                value={formatHourMin(today.checkOut)}
                label="Check Out"
                color="#1565C0"
              />
              <View style={styles.vDivider} />
              <StatItem
                icon={<Feather name="activity" size={20} color="#6A1B9A" />}
                value={computeWorkedHours()}
                label="Working HR's"
                color="#6A1B9A"
              />
            </View>
          </View>

          {/* ANNOUNCEMENT */}
          <View style={styles.annSection}>
            <View style={styles.annHeaderRow}>
              <View style={styles.annTitleRow}>
                <Text style={styles.annTitle}>Announcement</Text>
                <Ionicons
                  name="megaphone-outline"
                  size={16}
                  color="#1B5E20"
                  style={{ marginLeft: 6 }}
                />
              </View>
              <TouchableOpacity onPress={() => router.push('/announcement' as any)}>
                <Text style={styles.viewAll}>View All</Text>
              </TouchableOpacity>
            </View>
            <Text style={styles.annSub}>
              Latest company updates and important notices
            </Text>

            {announcements.length === 0 ? (
              <View style={[styles.annCard, { alignItems: 'center' }]}>
                <Text style={[styles.annCardBody, { textAlign: 'center' }]}>
                  No announcements yet.
                </Text>
              </View>
            ) : (
              announcements.slice(0, 4).map((a) => (
                <TouchableOpacity
                  key={a._id}
                  style={styles.annCard}
                  activeOpacity={0.85}
                  onPress={() => router.push('/announcement' as any)}
                >
                  <Text style={styles.annCardTitle}>{a.title}</Text>
                  <Text style={styles.annCardBody} numberOfLines={2}>
                    {a.body}
                  </Text>
                  <Text style={styles.annCardMeta}>
                    Posted by {a.postedBy}  •  {formatRelative(a.createdAt)}
                  </Text>
                </TouchableOpacity>
              ))
            )}
          </View>
        </ScrollView>
      </SafeAreaView>

      {/* SIDE DRAWER */}
      <SideDrawer
        visible={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        user={user || undefined}
      />
    </View>
  );
}

function StatItem({
  icon,
  value,
  label,
  color,
}: {
  icon: React.ReactNode;
  value: string;
  label: string;
  color: string;
}) {
  return (
    <View style={styles.statItem}>
      <View style={styles.statIcon}>{icon}</View>
      <Text style={styles.statValue}>{value}</Text>
      <Text style={[styles.statLabel, { color }]}>{label}</Text>
    </View>
  );
}

const GREEN = '#4CAF50';
const PAGE_BG = '#F5F7F6';

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: PAGE_BG },
  safe: { flex: 1 },

  greenHeader: {
    backgroundColor: GREEN,
    paddingHorizontal: 16,
    paddingTop: 8,
    paddingBottom: 90,
    borderBottomLeftRadius: 24,
    borderBottomRightRadius: 24,
  },
  topRow: { flexDirection: 'row', alignItems: 'center', marginTop: 8 },
  menuBtn: {
    width: 38,
    height: 38,
    borderRadius: 19,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.18)',
  },
  greetingWrap: { flex: 1, marginLeft: 10 },
  greetingTitle: { color: '#FFFFFF', fontSize: 16, fontWeight: '700' },
  greetingSub: { color: 'rgba(255,255,255,0.95)', fontSize: 12, marginTop: 2 },
  wave: { fontSize: 14 },

  bellBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: '#FFFFFF',
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOpacity: 0.12,
    shadowOffset: { width: 0, height: 2 },
    shadowRadius: 4,
    elevation: 3,
  },
  bellDot: {
    position: 'absolute',
    top: 9,
    right: 10,
    width: 9,
    height: 9,
    borderRadius: 5,
    backgroundColor: '#F44336',
    borderWidth: 1.5,
    borderColor: '#FFFFFF',
  },

  attCard: {
    backgroundColor: '#FFFFFF',
    marginHorizontal: 16,
    marginTop: -65,
    borderRadius: 18,
    paddingTop: 22,
    paddingBottom: 16,
    paddingHorizontal: 18,
    shadowColor: '#000',
    shadowOpacity: 0.08,
    shadowOffset: { width: 0, height: 4 },
    shadowRadius: 12,
    elevation: 5,
  },
  shiftPillWrap: { alignItems: 'center', marginBottom: 14 },
  shiftPill: {
    backgroundColor: '#E8F5E9',
    paddingHorizontal: 18,
    paddingVertical: 6,
    borderRadius: 14,
  },
  shiftPillText: {
    color: '#2E7D32',
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 0.6,
  },
  timeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  bigTime: { fontSize: 22, fontWeight: '800', color: '#111', letterSpacing: 0.5 },
  checkBtn: {
    backgroundColor: GREEN,
    paddingHorizontal: 18,
    paddingVertical: 9,
    borderRadius: 22,
    shadowColor: GREEN,
    shadowOpacity: 0.3,
    shadowOffset: { width: 0, height: 4 },
    shadowRadius: 8,
    elevation: 4,
  },
  checkBtnText: { color: '#FFFFFF', fontSize: 13, fontWeight: '700' },
  divider: { height: 1, backgroundColor: '#EEEEEE', marginTop: 18, marginBottom: 14 },
  statsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  statItem: { flex: 1, alignItems: 'center' },
  statIcon: { marginBottom: 4 },
  statValue: { fontSize: 13, fontWeight: '700', color: '#1A1A1A', marginTop: 2 },
  statLabel: { fontSize: 11, fontWeight: '600', marginTop: 2 },
  vDivider: { width: 1, height: 36, backgroundColor: '#EEEEEE' },

  annSection: { marginTop: 22, marginHorizontal: 16 },
  annHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  annTitleRow: { flexDirection: 'row', alignItems: 'center' },
  annTitle: { fontSize: 16, fontWeight: '800', color: '#111' },
  viewAll: { color: '#2E7D32', fontSize: 12, fontWeight: '700' },
  annSub: { color: '#7A7A7A', fontSize: 12, marginTop: 4, marginBottom: 14 },

  annCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 12,
    paddingVertical: 14,
    paddingHorizontal: 14,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: '#E6EDE7',
    shadowColor: '#000',
    shadowOpacity: 0.03,
    shadowOffset: { width: 0, height: 2 },
    shadowRadius: 6,
    elevation: 1,
  },
  annCardTitle: { fontSize: 14, fontWeight: '700', color: '#1A1A1A' },
  annCardBody: { fontSize: 12, color: '#666', marginTop: 4, lineHeight: 17 },
  annCardMeta: { fontSize: 10.5, color: '#9A9A9A', marginTop: 8 },
});
