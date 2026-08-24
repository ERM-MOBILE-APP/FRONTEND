import React, { useCallback, useRef, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  RefreshControl,
  Linking,
  Platform,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect } from 'expo-router';
import ScreenErrorBoundary from '../../components/ScreenErrorBoundary';
import { ManagerHeader, Card, Pill, Loading, EmptyState, MC } from '../../components/manager/ManagerUI';
import { managerAPI } from '../../services/api';

const empName = (r: any) => r?.name || 'Employee';

function statusTone(s?: string): 'green' | 'amber' | 'red' | 'blue' | 'gray' {
  const v = String(s || '').toLowerCase();
  if (v === 'active' || v === 'travelling') return 'green';
  if (v === 'idle') return 'amber';
  if (v === 'office') return 'blue';
  return 'gray'; // offline
}

function agoLabel(iso?: string) {
  if (!iso) return 'No signal';
  const ms = Date.now() - new Date(iso).getTime();
  if (!isFinite(ms) || ms < 0) return '—';
  const min = Math.floor(ms / 60000);
  if (min < 1) return 'Just now';
  if (min < 60) return `${min} min ago`;
  const h = Math.floor(min / 60);
  if (h < 24) return `${h} h ago`;
  return `${Math.floor(h / 24)} d ago`;
}

/**
 * Team live tracking. Lists each team member's latest position + derived
 * status from /api/manager/live-locations, refreshing every 30s while the
 * screen is focused. "Open in Maps" hands off to the device's map app (no
 * in-app map SDK / API key needed).
 */
function LiveTracking() {
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [rows, setRows] = useState<any[]>([]);
  const [err, setErr] = useState('');
  const [updatedAt, setUpdatedAt] = useState<string>('');
  const timerRef = useRef<any>(null);

  const load = useCallback(async (silent = false) => {
    if (!silent) setErr('');
    try {
      const res = await managerAPI.liveLocations();
      setRows(res?.data?.data || []);
      setUpdatedAt(res?.data?.generatedAt || new Date().toISOString());
    } catch (e: any) {
      if (!silent) setErr(e?.response?.data?.message || e?.message || 'Could not load locations.');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  // Load on focus + poll every 30s; stop when unfocused.
  useFocusEffect(
    useCallback(() => {
      load();
      timerRef.current = setInterval(() => load(true), 30000);
      return () => { if (timerRef.current) clearInterval(timerRef.current); };
    }, [load]),
  );

  const onRefresh = () => { setRefreshing(true); load(); };

  const openMaps = (row: any) => {
    if (row.lat == null || row.lng == null) return;
    const label = encodeURIComponent(empName(row));
    const latlng = `${row.lat},${row.lng}`;
    const url = Platform.select({
      ios: `https://maps.apple.com/?q=${label}&ll=${latlng}`,
      android: `geo:${latlng}?q=${latlng}(${label})`,
      default: `https://www.google.com/maps/search/?api=1&query=${latlng}`,
    })!;
    Linking.openURL(url).catch(() =>
      Linking.openURL(`https://www.google.com/maps/search/?api=1&query=${latlng}`).catch(() => {}),
    );
  };

  const activeCount = rows.filter((r) => statusTone(r.status) === 'green').length;

  return (
    <View style={styles.screen}>
      <ManagerHeader
        title="Live Tracking"
        subtitle={updatedAt ? `${activeCount} active · updated ${agoLabel(updatedAt)}` : 'Team locations'}
      />
      {loading ? (
        <Loading label="Locating your team…" />
      ) : (
        <ScrollView
          contentContainerStyle={{ paddingBottom: 32 }}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} colors={[MC.green]} />}
        >
          {!!err && (
            <Card style={{ backgroundColor: MC.redBg }}>
              <Text style={{ color: MC.red, fontSize: 13 }}>{err}</Text>
            </Card>
          )}

          {rows.length === 0 && !err ? (
            <EmptyState icon="location-outline" title="No team members" hint="Assigned team members will appear here once they check in." />
          ) : (
            rows.map((r) => {
              const hasFix = r.lat != null && r.lng != null;
              return (
                <Card key={r._id}>
                  <View style={styles.rowTop}>
                    <View style={[styles.dot, { backgroundColor: dotColor(r.status) }]} />
                    <View style={{ flex: 1 }}>
                      <Text style={styles.name}>{empName(r)}</Text>
                      <Text style={styles.sub}>
                        {r.employeeId || ''}{r.designation ? `  ·  ${r.designation}` : ''}
                      </Text>
                    </View>
                    <Pill label={(r.status || 'offline').toUpperCase()} tone={statusTone(r.status)} />
                  </View>

                  <View style={styles.metaRow}>
                    <View style={styles.metaItem}>
                      <Ionicons name="time-outline" size={14} color={MC.sub} />
                      <Text style={styles.metaText}>{agoLabel(r.lastSeen)}</Text>
                    </View>
                    {r.checkIn ? (
                      <View style={styles.metaItem}>
                        <Ionicons name="log-in-outline" size={14} color={MC.sub} />
                        <Text style={styles.metaText}>In {fmtTime(r.checkIn)}</Text>
                      </View>
                    ) : null}
                    {r.checkOut ? (
                      <View style={styles.metaItem}>
                        <Ionicons name="log-out-outline" size={14} color={MC.sub} />
                        <Text style={styles.metaText}>Out {fmtTime(r.checkOut)}</Text>
                      </View>
                    ) : null}
                  </View>

                  <TouchableOpacity
                    style={[styles.mapBtn, !hasFix && styles.mapBtnDisabled]}
                    onPress={() => openMaps(r)}
                    disabled={!hasFix}
                    activeOpacity={0.85}
                  >
                    <Ionicons name="map-outline" size={16} color={hasFix ? MC.green : '#B7B7B7'} />
                    <Text style={[styles.mapBtnText, !hasFix && { color: '#B7B7B7' }]}>
                      {hasFix ? 'Open in Maps' : 'No location yet'}
                    </Text>
                  </TouchableOpacity>
                </Card>
              );
            })
          )}
        </ScrollView>
      )}
    </View>
  );
}

function dotColor(s?: string) {
  const t = statusTone(s);
  return t === 'green' ? MC.green : t === 'amber' ? MC.amber : t === 'blue' ? MC.blue : '#B7B7B7';
}

function fmtTime(v: any) {
  try {
    const d = new Date(v);
    if (isNaN(d.getTime())) return String(v);
    return d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
  } catch { return String(v); }
}

export default function LiveTrackingScreen() {
  return (
    <ScreenErrorBoundary name="ManagerTracking">
      <LiveTracking />
    </ScreenErrorBoundary>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: MC.bg },
  rowTop: { flexDirection: 'row', alignItems: 'center' },
  dot: { width: 10, height: 10, borderRadius: 5, marginRight: 10 },
  name: { fontSize: 14.5, fontWeight: '800', color: MC.text },
  sub: { fontSize: 11.5, color: MC.sub, marginTop: 1 },
  metaRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 14, marginTop: 10 },
  metaItem: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  metaText: { fontSize: 12, color: MC.sub },
  mapBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
    marginTop: 12, paddingVertical: 10, borderRadius: 10,
    borderWidth: 1.4, borderColor: MC.green, backgroundColor: '#fff',
  },
  mapBtnDisabled: { borderColor: '#E0E0E0' },
  mapBtnText: { fontSize: 13, fontWeight: '800', color: MC.green },
});
