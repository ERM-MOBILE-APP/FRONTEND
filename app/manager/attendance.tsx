import React, { useCallback, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  RefreshControl,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useLocalSearchParams } from 'expo-router';
import ScreenErrorBoundary from '../../components/ScreenErrorBoundary';
import { ManagerHeader, Card, Loading, EmptyState, MC } from '../../components/manager/ManagerUI';
import { managerAPI } from '../../services/api';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const empName = (r: any) => r?.name || 'Employee';

/**
 * Team monthly attendance report. Per-employee present / late / absent /
 * permission / half-day counts + total worked hours, from
 * /api/manager/attendance-summary (same numbers HRMS shows).
 */
// #474 — ERM went live 2026-07-01. Reports can't go earlier than this.
const ERM_START = { year: 2026, month: 7 }; // ERM_START_DATE = 2026-07-01
const beforeErmStart = (m: number, y: number) =>
  (y < ERM_START.year) || (y === ERM_START.year && m < ERM_START.month);

function TeamAttendance() {
  const insets = useSafeAreaInsets();
  const params = useLocalSearchParams<{ managerId?: string; managerName?: string; scope?: string }>();
  const managerId   = typeof params?.managerId   === 'string' ? params.managerId   : undefined;
  const managerName = typeof params?.managerName === 'string' ? params.managerName : '';
  const scope: 'direct' | undefined = params?.scope === 'direct' ? 'direct' : undefined;
  const now = new Date();
  // Default to the current month, but never earlier than the ERM start.
  const startMonth = beforeErmStart(now.getMonth() + 1, now.getFullYear())
    ? ERM_START.month : now.getMonth() + 1;
  const startYear = beforeErmStart(now.getMonth() + 1, now.getFullYear())
    ? ERM_START.year : now.getFullYear();
  const [month, setMonth] = useState(startMonth); // 1-12
  const [year, setYear] = useState(startYear);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [items, setItems] = useState<any[]>([]);
  const [err, setErr] = useState('');

  const load = useCallback(async () => {
    setErr('');
    setLoading(true);
    try {
      const res = await managerAPI.attendanceSummary({ month, year, managerId, scope });
      setItems(res?.data?.items || []);
    } catch (e: any) {
      setErr(e?.response?.data?.message || e?.message || 'Could not load attendance.');
      setItems([]);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [month, year, managerId, scope]);

  React.useEffect(() => { load(); }, [load]);
  const onRefresh = () => { setRefreshing(true); load(); };

  const stepMonth = (dir: -1 | 1) => {
    let m = month + dir;
    let y = year;
    if (m < 1) { m = 12; y -= 1; }
    if (m > 12) { m = 1; y += 1; }
    // #471 — never navigate into a future month (it hasn't happened yet).
    const n = new Date();
    const isFuture = (y > n.getFullYear()) || (y === n.getFullYear() && m > n.getMonth() + 1);
    if (isFuture) return;
    // #474 — never navigate before the ERM start month (July 2026).
    if (beforeErmStart(m, y)) return;
    setMonth(m); setYear(y);
  };

  // Whether the currently-viewed month is the present month (→ disable "next").
  const atCurrentMonth =
    year === new Date().getFullYear() && month === new Date().getMonth() + 1;
  // Whether we're at the ERM start month (→ disable "prev").
  const atStartMonth = year === ERM_START.year && month === ERM_START.month;

  // Team totals. #521 — Present INCLUDES Late (a late arrival is still a present
  // day), matching the ERM app card + HRMS report. Late stays its own total.
  const totals = items.reduce(
    (acc, r) => {
      acc.present += (r.present || 0) + (r.late || 0);
      acc.late += r.late || 0;
      acc.absent += r.absent || 0;
      acc.permission += r.permission || 0;
      return acc;
    },
    { present: 0, late: 0, absent: 0, permission: 0 },
  );

  return (
    <View style={[styles.screen, { paddingBottom: insets.bottom }]}>
      <ManagerHeader
        title="Team Attendance"
        subtitle={managerName ? `${managerName}'s team — monthly` : 'Monthly summary'}
      />

      {/* Month stepper */}
      <View style={styles.monthBar}>
        <TouchableOpacity
          onPress={() => stepMonth(-1)}
          disabled={atStartMonth}
          hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
        >
          <Ionicons name="chevron-back" size={22} color={atStartMonth ? '#CBD5E1' : MC.green} />
        </TouchableOpacity>
        <Text style={styles.monthText}>{MONTHS[month - 1]} {year}</Text>
        <TouchableOpacity
          onPress={() => stepMonth(1)}
          disabled={atCurrentMonth}
          hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
        >
          <Ionicons name="chevron-forward" size={22} color={atCurrentMonth ? '#CBD5E1' : MC.green} />
        </TouchableOpacity>
      </View>

      {loading ? (
        <Loading label="Loading attendance…" />
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

          {/* Team totals strip */}
          {items.length > 0 && (
            <Card style={styles.totalsCard}>
              <Total label="Present" value={totals.present} color={MC.green} />
              <Total label="Late" value={totals.late} color={MC.amber} />
              <Total label="Absent" value={totals.absent} color={MC.red} />
              <Total label="Perm" value={totals.permission} color="#7C3AED" />
            </Card>
          )}

          {items.length === 0 && !err ? (
            <EmptyState icon="people-outline" title="No team data" hint="No attendance records for this month." />
          ) : (
            items.map((r) => (
              <Card key={r.userId}>
                <View style={styles.rowTop}>
                  <View style={styles.avatar}>
                    <Text style={styles.avatarText}>{empName(r).trim()[0]?.toUpperCase() || '?'}</Text>
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.name}>{empName(r)}</Text>
                    <Text style={styles.sub}>
                      {r.employeeId || ''}{r.designation ? `  ·  ${r.designation}` : ''}
                    </Text>
                  </View>
                  <View style={styles.hoursPill}>
                    <Text style={styles.hoursText}>{Number(r.totalWorkedHours || 0).toFixed(1)}h</Text>
                  </View>
                </View>

                <View style={styles.statGrid}>
                  {/* #521 — Present = on-time + late (late is still a present day). */}
                  <Stat label="Present" value={(r.present || 0) + (r.late || 0)} color={MC.green} />
                  <Stat label="Late" value={r.late} color={MC.amber} />
                  <Stat label="Absent" value={r.absent} color={MC.red} />
                  <Stat label="Perm" value={r.permission} color="#7C3AED" />
                  <Stat label="Half" value={r.halfday} color="#0D9488" />
                </View>
              </Card>
            ))
          )}
        </ScrollView>
      )}
    </View>
  );
}

function Total({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <View style={styles.totalItem}>
      <Text style={[styles.totalNum, { color }]}>{value}</Text>
      <Text style={styles.totalLabel}>{label}</Text>
    </View>
  );
}

function Stat({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <View style={styles.statItem}>
      <Text style={[styles.statNum, { color }]}>{value || 0}</Text>
      <Text style={styles.statLabel}>{label}</Text>
    </View>
  );
}

export default function TeamAttendanceScreen() {
  return (
    <ScreenErrorBoundary name="ManagerAttendance">
      <TeamAttendance />
    </ScreenErrorBoundary>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: MC.bg },
  monthBar: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    backgroundColor: '#fff', marginHorizontal: 14, marginTop: 12, borderRadius: 12,
    paddingHorizontal: 18, paddingVertical: 12,
    shadowColor: '#000', shadowOpacity: 0.05, shadowRadius: 6, elevation: 1,
  },
  monthText: { fontSize: 15, fontWeight: '800', color: MC.text },

  totalsCard: { flexDirection: 'row', justifyContent: 'space-around', paddingVertical: 16 },
  totalItem: { alignItems: 'center' },
  totalNum: { fontSize: 22, fontWeight: '800' },
  totalLabel: { fontSize: 11.5, color: MC.sub, marginTop: 2 },

  rowTop: { flexDirection: 'row', alignItems: 'center', marginBottom: 12 },
  avatar: {
    width: 38, height: 38, borderRadius: 19, backgroundColor: '#E8F5E9',
    alignItems: 'center', justifyContent: 'center', marginRight: 10,
  },
  avatarText: { color: MC.green, fontWeight: '800', fontSize: 16 },
  name: { fontSize: 14.5, fontWeight: '800', color: MC.text },
  sub: { fontSize: 11.5, color: MC.sub, marginTop: 1 },
  hoursPill: { backgroundColor: '#EEF6EE', paddingHorizontal: 10, paddingVertical: 5, borderRadius: 999 },
  hoursText: { color: MC.green, fontWeight: '800', fontSize: 12 },

  statGrid: {
    flexDirection: 'row', justifyContent: 'space-between',
    borderTopWidth: 1, borderTopColor: '#F1F1F1', paddingTop: 12,
  },
  statItem: { alignItems: 'center', flex: 1 },
  statNum: { fontSize: 18, fontWeight: '800' },
  statLabel: { fontSize: 11, color: MC.sub, marginTop: 2 },
});
