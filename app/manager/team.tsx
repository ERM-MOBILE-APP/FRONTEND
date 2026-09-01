import React, { useCallback, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  RefreshControl,
  TouchableOpacity,
  Linking,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useFocusEffect, useLocalSearchParams } from 'expo-router';
import ScreenErrorBoundary from '../../components/ScreenErrorBoundary';
import { ManagerHeader, Card, Pill, Loading, EmptyState, MC } from '../../components/manager/ManagerUI';
import { managerAPI } from '../../services/api';

const empName = (u: any) => u?.name || [u?.firstName, u?.lastName].filter(Boolean).join(' ').trim() || 'Employee';

function presenceTone(p?: string): 'green' | 'amber' | 'gray' {
  const v = String(p || '').toLowerCase();
  if (v === 'active') return 'green';
  if (v === 'idle') return 'amber';
  return 'gray';
}

/** List of the manager's direct reports (assigned team). */
function TeamList() {
  const insets = useSafeAreaInsets();
  const params = useLocalSearchParams<{ managerId?: string; managerName?: string; scope?: string }>();
  const managerId   = typeof params?.managerId   === 'string' ? params.managerId   : undefined;
  const managerName = typeof params?.managerName === 'string' ? params.managerName : '';
  const scope: 'direct' | undefined = params?.scope === 'direct' ? 'direct' : undefined;
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [team, setTeam] = useState<any[]>([]);
  const [err, setErr] = useState('');

  const load = useCallback(async () => {
    setErr('');
    try {
      const res = await managerAPI.team(managerId, scope);
      setTeam(res?.data?.team || []);
    } catch (e: any) {
      setErr(e?.response?.data?.message || e?.message || 'Could not load your team.');
      setTeam([]);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [managerId, scope]);

  useFocusEffect(useCallback(() => { load(); }, [load]));
  const onRefresh = () => { setRefreshing(true); load(); };

  return (
    <View style={[styles.screen, { paddingBottom: insets.bottom }]}>
      <ManagerHeader
        title="Team Members"
        subtitle={
          managerName
            ? `${managerName}'s team${team.length ? ` · ${team.length}` : ''}`
            : team.length ? `${team.length} people report to you` : 'Your team'
        }
      />
      {loading ? (
        <Loading label="Loading your team…" />
      ) : (
        <ScrollView
          contentContainerStyle={{ paddingBottom: 24 }}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} colors={[MC.green]} />}
        >
          {!!err && (
            <Card style={{ backgroundColor: MC.redBg }}>
              <Text style={{ color: MC.red, fontSize: 13 }}>{err}</Text>
            </Card>
          )}
          {team.length === 0 && !err ? (
            <EmptyState icon="people-outline" title="No team members" hint="Employees assigned to you will appear here." />
          ) : (
            team.map((u) => (
              <Card key={String(u._id)}>
                <View style={styles.row}>
                  <View style={styles.avatar}>
                    <Text style={styles.avatarText}>{empName(u).trim()[0]?.toUpperCase() || '?'}</Text>
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.name}>{empName(u)}</Text>
                    <Text style={styles.sub}>
                      {u.employeeId || ''}{u.designation ? `  ·  ${u.designation}` : ''}
                    </Text>
                    {!!u.department && <Text style={styles.dept}>{u.department}</Text>}
                  </View>
                  {u.active === false
                    ? <Pill label="INACTIVE" tone="gray" />
                    : <Pill label={(u.presence || 'offline').toUpperCase()} tone={presenceTone(u.presence)} />}
                </View>
                {(!!u.phone || !!u.email) && (
                  <View style={styles.contactBlock}>
                    {!!u.phone && (
                      <TouchableOpacity
                        style={styles.contactRow}
                        onPress={() => Linking.openURL(`tel:${String(u.phone).replace(/\s+/g, '')}`).catch(() => {})}
                        activeOpacity={0.7}
                      >
                        <Ionicons name="call-outline" size={14} color={MC.green} />
                        <Text style={[styles.contactText, { color: MC.green, fontWeight: '700' }]}>{u.phone}</Text>
                      </TouchableOpacity>
                    )}
                    {!!u.email && (
                      <View style={styles.contactRow}>
                        <Ionicons name="mail-outline" size={14} color={MC.sub} />
                        <Text style={styles.contactText}>{u.email}</Text>
                      </View>
                    )}
                  </View>
                )}
              </Card>
            ))
          )}
        </ScrollView>
      )}
    </View>
  );
}

export default function TeamListScreen() {
  return (
    <ScreenErrorBoundary name="ManagerTeam">
      <TeamList />
    </ScreenErrorBoundary>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: MC.bg },
  row: { flexDirection: 'row', alignItems: 'center' },
  avatar: {
    width: 42, height: 42, borderRadius: 21, backgroundColor: '#E8F5E9',
    alignItems: 'center', justifyContent: 'center', marginRight: 12,
  },
  avatarText: { color: MC.green, fontWeight: '800', fontSize: 17 },
  name: { fontSize: 15, fontWeight: '800', color: MC.text },
  sub: { fontSize: 12, color: MC.sub, marginTop: 1 },
  dept: { fontSize: 11.5, color: '#9AA0A6', marginTop: 1 },
  contactBlock: { marginTop: 10, paddingTop: 10, borderTopWidth: 1, borderTopColor: '#F1F1F1', gap: 6 },
  contactRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  contactText: { fontSize: 12.5, color: MC.sub },
});
