import React, { useCallback, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  RefreshControl,
} from 'react-native';
import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { router, useFocusEffect } from 'expo-router';
import ScreenErrorBoundary from '../../components/ScreenErrorBoundary';
import { ManagerHeader, Card, MC, Loading } from '../../components/manager/ManagerUI';
import { managerAPI } from '../../services/api';

/**
 * Manager hub — the landing screen for the Manager section. Shows the
 * manager's team size + live pending counts (leave/permission, allowance,
 * attendance requests) and cards that drill into each feature. All data is
 * fetched live from /api/manager/* — nothing hardcoded.
 */
function ManagerHome() {
  const insets = useSafeAreaInsets();
  const [loading, setLoading]   = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [managerName, setManagerName] = useState('');
  const [teamSize, setTeamSize] = useState(0);
  const [counts, setCounts] = useState({ leaves: 0, allowances: 0, attnReqs: 0 });
  const [err, setErr] = useState('');

  const load = useCallback(async () => {
    setErr('');
    try {
      // Fetch team + pending queues in parallel. Pending = status 'pending'
      // for leaves/attendance-requests; allowances pending = managerStatus
      // not yet set (we approximate with status 'pending').
      const [teamRes, leaveRes, travelRes, petrolRes, attnRes] = await Promise.all([
        managerAPI.team(),
        managerAPI.leaves({ status: 'pending' }),
        managerAPI.allowances({ type: 'travel', status: 'pending' }),
        managerAPI.allowances({ type: 'petrol', status: 'pending' }),
        managerAPI.attendanceRequests({ status: 'pending' }),
      ]);
      const team = teamRes?.data?.team || [];
      setTeamSize(teamRes?.data?.count ?? team.length);
      setManagerName(teamRes?.data?.manager?.name || '');
      const leaves = (leaveRes?.data?.items || []).filter((l: any) => !l.managerStatus).length
        || (leaveRes?.data?.items || []).length;
      const allowances =
        (travelRes?.data?.items || []).filter((a: any) => !a.managerStatus).length +
        (petrolRes?.data?.items || []).filter((a: any) => !a.managerStatus).length;
      const attnReqs = (attnRes?.data?.items || []).filter((r: any) => !r.managerStatus).length
        || (attnRes?.data?.items || []).length;
      setCounts({ leaves, allowances, attnReqs });
    } catch (e: any) {
      setErr(e?.response?.data?.message || e?.message || 'Could not load manager data.');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  const onRefresh = () => { setRefreshing(true); load(); };

  const sections = [
    {
      key: 'team',
      title: 'Team Members',
      desc: teamSize ? `${teamSize} people report to you` : 'Your assigned team',
      icon: <Ionicons name="people-outline" size={24} color="#fff" />,
      color: '#0EA5E9',
      badge: 0,
      route: '/manager/team',
    },
    {
      key: 'approvals',
      title: 'Approvals',
      desc: 'Leave, permission, allowance & attendance requests',
      icon: <MaterialCommunityIcons name="clipboard-check-outline" size={24} color="#fff" />,
      color: MC.green,
      badge: counts.leaves + counts.allowances + counts.attnReqs,
      route: '/manager/approvals',
    },
    {
      key: 'attendance',
      title: 'Team Attendance',
      desc: 'Monthly report — present, late, absent',
      icon: <MaterialCommunityIcons name="calendar-account-outline" size={24} color="#fff" />,
      color: '#2563EB',
      badge: 0,
      route: '/manager/attendance',
    },
    {
      key: 'tracking',
      title: 'Live Tracking',
      desc: 'Where your team is right now',
      icon: <Ionicons name="location-outline" size={24} color="#fff" />,
      color: '#7C3AED',
      badge: 0,
      route: '/manager/tracking',
    },
    {
      key: 'announcements',
      title: 'Announcements',
      desc: 'Post to your team',
      icon: <Ionicons name="megaphone-outline" size={24} color="#fff" />,
      color: '#0D9488',
      badge: 0,
      route: '/manager/announcements',
    },
  ];

  return (
    <View style={[styles.screen, { paddingBottom: insets.bottom }]}>
      <ManagerHeader
        title="Manager"
        subtitle={managerName ? `Signed in as ${managerName}` : 'Team management'}
        onBack={() => router.replace('/(tabs)/')}
      />
      {loading ? (
        <Loading label="Loading your team…" />
      ) : (
        <ScrollView
          contentContainerStyle={{ paddingBottom: 24 }}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} colors={[MC.green]} />}
        >
          {/* Team summary strip — both halves are tappable. */}
          <Card style={styles.summaryCard}>
            <TouchableOpacity
              style={styles.summaryItem}
              activeOpacity={0.7}
              onPress={() => router.push('/manager/team')}
            >
              <Text style={styles.summaryNum}>{teamSize}</Text>
              <Text style={styles.summaryLabel}>Team members</Text>
              <View style={styles.summaryHintRow}>
                <Text style={styles.summaryHint}>View list</Text>
                <Ionicons name="chevron-forward" size={12} color={MC.sub} />
              </View>
            </TouchableOpacity>
            <View style={styles.summaryDivider} />
            <TouchableOpacity
              style={styles.summaryItem}
              activeOpacity={0.7}
              onPress={() => router.push('/manager/approvals')}
            >
              <Text style={[styles.summaryNum, { color: MC.amber }]}>{counts.leaves + counts.allowances + counts.attnReqs}</Text>
              <Text style={styles.summaryLabel}>Pending actions</Text>
              <View style={styles.summaryHintRow}>
                <Text style={styles.summaryHint}>Review now</Text>
                <Ionicons name="chevron-forward" size={12} color={MC.sub} />
              </View>
            </TouchableOpacity>
          </Card>

          {!!err && (
            <Card style={{ backgroundColor: MC.redBg }}>
              <Text style={{ color: MC.red, fontSize: 13 }}>{err}</Text>
              <Text style={{ color: MC.sub, fontSize: 12, marginTop: 6 }}>
                If you were just made a manager, pull to refresh. If this persists, the
                server may still be starting up.
              </Text>
            </Card>
          )}

          {sections.map((s) => (
            <TouchableOpacity
              key={s.key}
              activeOpacity={0.85}
              onPress={() => router.push(s.route as any)}
            >
              <Card style={styles.navCard}>
                <View style={[styles.navIcon, { backgroundColor: s.color }]}>{s.icon}</View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.navTitle}>{s.title}</Text>
                  <Text style={styles.navDesc}>{s.desc}</Text>
                </View>
                {s.badge > 0 && (
                  <View style={styles.badge}>
                    <Text style={styles.badgeText}>{s.badge > 99 ? '99+' : s.badge}</Text>
                  </View>
                )}
                <Ionicons name="chevron-forward" size={20} color="#C4C9CF" />
              </Card>
            </TouchableOpacity>
          ))}
        </ScrollView>
      )}
    </View>
  );
}

export default function ManagerHomeScreen() {
  return (
    <ScreenErrorBoundary name="Manager">
      <ManagerHome />
    </ScreenErrorBoundary>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: MC.bg },
  summaryCard: { flexDirection: 'row', alignItems: 'center', paddingVertical: 18 },
  summaryItem: { flex: 1, alignItems: 'center' },
  summaryDivider: { width: 1, height: 36, backgroundColor: MC.border },
  summaryNum: { fontSize: 26, fontWeight: '800', color: MC.green },
  summaryLabel: { fontSize: 12, color: MC.sub, marginTop: 2 },
  summaryHintRow: { flexDirection: 'row', alignItems: 'center', gap: 2, marginTop: 4 },
  summaryHint: { fontSize: 11, color: MC.sub, fontWeight: '600' },

  navCard: { flexDirection: 'row', alignItems: 'center' },
  navIcon: {
    width: 46, height: 46, borderRadius: 12,
    alignItems: 'center', justifyContent: 'center', marginRight: 12,
  },
  navTitle: { fontSize: 15.5, fontWeight: '800', color: MC.text },
  navDesc: { fontSize: 12.5, color: MC.sub, marginTop: 2 },
  badge: {
    minWidth: 22, height: 22, borderRadius: 11, backgroundColor: MC.red,
    alignItems: 'center', justifyContent: 'center', paddingHorizontal: 6, marginRight: 6,
  },
  badgeText: { color: '#fff', fontSize: 11, fontWeight: '800' },
});
