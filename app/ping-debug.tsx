import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
  RefreshControl,
  ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { getPingDebugSnapshot, PingDebugSnapshot, PingRow } from '../services/pingStore';
import { syncMissingPingsFromLocal } from '../services/pingSync';

// #430 — READ-ONLY on-device viewer for the local SQLite ping store.
//
// The app's SQLite DB (erm_pings.db) lives in the app sandbox and cannot
// be read by adb on a release build. This screen surfaces the same data
// on the phone: pending vs synced counts, current check-in state, and the
// latest pings. It never writes or deletes anything.
//
// How to open it (no visible menu entry, so it stays out of the way):
//   adb shell am start -a android.intent.action.VIEW -d "tescoerm://ping-debug"
// (am start works on release builds — it does NOT need a debuggable app.)

const GREEN = '#2E8C2C';

/** Format an epoch-ms timestamp to a readable IST wall-clock string. */
function fmtIst(ms: number): string {
  try {
    return new Date(ms).toLocaleString('en-GB', {
      timeZone: 'Asia/Kolkata',
      day: '2-digit', month: '2-digit', year: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit',
      hour12: false,
    });
  } catch {
    return new Date(ms).toISOString();
  }
}

export default function PingDebugScreen() {
  const [snap, setSnap] = useState<PingDebugSnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [verifying, setVerifying] = useState(false);
  const [verifyMsg, setVerifyMsg] = useState<string | null>(null);
  const mountedRef = useRef(true);

  const load = useCallback(async () => {
    try {
      const s = await getPingDebugSnapshot(100);
      if (mountedRef.current) { setSnap(s); setError(null); }
    } catch (e: any) {
      if (mountedRef.current) setError(e?.message || String(e || 'unknown error'));
    } finally {
      if (mountedRef.current) { setLoading(false); setRefreshing(false); }
    }
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    load();
    return () => { mountedRef.current = false; };
  }, [load]);

  const onRefresh = useCallback(() => { setRefreshing(true); load(); }, [load]);

  // #433 — Re-ship EVERY local row (pending + synced) to MongoDB via the
  // batch endpoint. The server INSERTS any it's missing (healing rows a live
  // POST falsely marked 'synced' but never actually stored) and reports the
  // rest as already-existing. After this runs, the MongoDB count matches the
  // local synced count. Does not delete anything.
  const doVerify = useCallback(async () => {
    setVerifying(true);
    setVerifyMsg(null);
    try {
      const r = await syncMissingPingsFromLocal('manual-verify');
      if (mountedRef.current) {
        setVerifyMsg(
          r.status === 'Success'
            ? `Done. Newly inserted into MongoDB: ${r.inserted}. Already there: ${r.alreadyExisted}. Confirmed: ${r.markedSynced}.`
            : `Sync ${r.status}. Uploaded ${r.inserted}, existing ${r.alreadyExisted}. Check connection and retry.`
        );
      }
      await load();
    } catch (e: any) {
      if (mountedRef.current) setVerifyMsg('Verify failed: ' + (e?.message || String(e)));
    } finally {
      if (mountedRef.current) setVerifying(false);
    }
  }, [load]);

  return (
    <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => { try { router.back(); } catch {} }} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
          <Ionicons name="chevron-back" size={26} color="#fff" />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Ping Store (local SQLite)</Text>
        <TouchableOpacity onPress={onRefresh} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
          <Ionicons name="refresh" size={22} color="#fff" />
        </TouchableOpacity>
      </View>

      {loading ? (
        <View style={styles.center}><ActivityIndicator size="large" color={GREEN} /></View>
      ) : (
        <ScrollView
          contentContainerStyle={styles.body}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} colors={[GREEN]} />}
        >
          {error && (
            <View style={[styles.card, { borderColor: '#C62828' }]}>
              <Text style={{ color: '#C62828', fontWeight: '600' }}>Error reading store</Text>
              <Text style={{ color: '#C62828' }}>{error}</Text>
            </View>
          )}

          {/* #433 — Re-ship all local rows to MongoDB (heals false-synced). */}
          <TouchableOpacity
            style={[styles.verifyBtn, verifying && { opacity: 0.6 }]}
            onPress={doVerify}
            disabled={verifying}
            activeOpacity={0.8}
          >
            {verifying
              ? <ActivityIndicator color="#fff" />
              : <Text style={styles.verifyBtnText}>Verify &amp; upload to MongoDB now</Text>}
          </TouchableOpacity>
          {verifyMsg && <Text style={styles.verifyMsg}>{verifyMsg}</Text>}

          {snap && (
            <>
              {/* Overview */}
              <View style={styles.card}>
                <Row k="Database" v={snap.dbName} />
                <Row k="Storage engine" v={snap.backend === 'sqlite' ? 'SQLite (device)' : 'AsyncStorage (fallback)'} />
                <Row k="Total rows" v={String(snap.total) + (snap.capped ? ' (capped at 5000)' : '')} />
                <Row k="Pending (not uploaded)" v={String(snap.pending)} highlight={snap.pending > 0} />
                <Row k="Synced (on server)" v={String(snap.synced)} />
              </View>

              {/* Tracking state */}
              <Text style={styles.section}>tracking_state</Text>
              <View style={styles.card}>
                <Row k="Checked in" v={snap.tracking.checkedIn ? 'YES (working)' : 'no'} highlight={snap.tracking.checkedIn} />
                <Row k="Employee" v={snap.tracking.employeeId || '—'} />
                <Row k="Check-in at" v={snap.tracking.checkInAt ? fmtIst(snap.tracking.checkInAt) : '—'} />
                <Row k="Check-out at" v={snap.tracking.checkOutAt ? fmtIst(snap.tracking.checkOutAt) : '—'} />
                <Row k="Last ping at" v={snap.tracking.lastPingAt ? fmtIst(snap.tracking.lastPingAt) : '—'} />
              </View>

              {/* Latest pings */}
              <Text style={styles.section}>
                Latest pings ({snap.latest.length}) — newest first
              </Text>
              {snap.latest.length === 0 ? (
                <View style={styles.card}><Text style={{ color: '#666' }}>No pings stored yet.</Text></View>
              ) : (
                snap.latest.map((p: PingRow, i: number) => (
                  <View key={p.localId ?? i} style={styles.pingRow}>
                    <View style={styles.pingTop}>
                      <Text style={styles.pingTime}>{fmtIst(p.recordedAt)}</Text>
                      <Text style={[styles.badge, p.status === 'synced' ? styles.badgeSynced : styles.badgePending]}>
                        {p.status === 'synced' ? 'synced' : 'pending'}
                      </Text>
                    </View>
                    <Text style={styles.pingMeta}>
                      {p.lat.toFixed(5)}, {p.lng.toFixed(5)}
                      {p.isStationary ? '  · anchor' : ''}
                      {typeof p.accuracy === 'number' ? `  · ±${Math.round(p.accuracy)}m` : ''}
                    </Text>
                    <Text style={styles.pingSub}>
                      id {p.localId} · bucket {p.bucket} · {p.employeeId || 'no-emp'}
                      {p.retryCount ? ` · retries ${p.retryCount}` : ''}
                    </Text>
                  </View>
                ))
              )}

              <Text style={styles.footnote}>
                Read-only view. Pings stay “pending” until Check Out, then upload to
                MongoDB and (once verified) are deleted from here.
              </Text>
            </>
          )}
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

function Row({ k, v, highlight }: { k: string; v: string; highlight?: boolean }) {
  return (
    <View style={styles.kv}>
      <Text style={styles.kvKey}>{k}</Text>
      <Text style={[styles.kvVal, highlight && { color: GREEN, fontWeight: '700' }]}>{v}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#F4F6F4' },
  header: {
    height: 52, backgroundColor: GREEN, flexDirection: 'row', alignItems: 'center',
    justifyContent: 'space-between', paddingHorizontal: 14,
  },
  headerTitle: { color: '#fff', fontSize: 16, fontWeight: '700' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  body: { padding: 14, paddingBottom: 40 },
  card: {
    backgroundColor: '#fff', borderRadius: 10, padding: 14, marginBottom: 14,
    borderWidth: 1, borderColor: '#E3E7E3',
  },
  section: { fontSize: 13, fontWeight: '700', color: '#555', marginBottom: 8, marginLeft: 2 },
  kv: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 4 },
  kvKey: { color: '#555', fontSize: 14 },
  kvVal: { color: '#111', fontSize: 14, fontWeight: '600', maxWidth: '60%', textAlign: 'right' },
  pingRow: {
    backgroundColor: '#fff', borderRadius: 8, padding: 12, marginBottom: 8,
    borderWidth: 1, borderColor: '#E3E7E3',
  },
  pingTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 },
  pingTime: { fontSize: 13, fontWeight: '700', color: '#111' },
  pingMeta: { fontSize: 13, color: '#333' },
  pingSub: { fontSize: 11, color: '#888', marginTop: 2 },
  badge: { fontSize: 11, fontWeight: '700', paddingHorizontal: 8, paddingVertical: 2, borderRadius: 10, overflow: 'hidden' },
  badgePending: { backgroundColor: '#FFF3E0', color: '#E65100' },
  badgeSynced: { backgroundColor: '#E8F5E9', color: GREEN },
  footnote: { fontSize: 12, color: '#888', marginTop: 8, lineHeight: 17 },
  verifyBtn: {
    backgroundColor: GREEN, borderRadius: 10, paddingVertical: 13,
    alignItems: 'center', justifyContent: 'center', marginBottom: 8, minHeight: 46,
  },
  verifyBtnText: { color: '#fff', fontSize: 15, fontWeight: '700' },
  verifyMsg: { fontSize: 12, color: '#333', marginBottom: 14, lineHeight: 17 },
});
