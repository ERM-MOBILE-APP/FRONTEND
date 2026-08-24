import React, { useCallback, useMemo, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  RefreshControl,
  Modal,
  TextInput,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useLocalSearchParams } from 'expo-router';
import ScreenErrorBoundary from '../../components/ScreenErrorBoundary';
import {
  ManagerHeader, Card, Pill, Segmented, Loading, EmptyState, MC, toneForStatus,
} from '../../components/manager/ManagerUI';
import { managerAPI } from '../../services/api';

type TabKey = 'leave' | 'allowance' | 'attnreq';

const rupee = (n: any) => '₹' + Number(n || 0).toLocaleString('en-IN');
const empName = (u: any) =>
  u?.name || [u?.firstName, u?.lastName].filter(Boolean).join(' ').trim() || 'Employee';

function Approvals() {
  const params = useLocalSearchParams<{ tab?: string }>();
  const initialTab: TabKey =
    params?.tab === 'attnreq' ? 'attnreq' : params?.tab === 'allowance' ? 'allowance' : 'leave';

  const insets = useSafeAreaInsets();
  const [tab, setTab] = useState<TabKey>(initialTab);
  const [allowanceType, setAllowanceType] = useState<'petrol' | 'travel'>('petrol');
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [items, setItems] = useState<any[]>([]);
  const [err, setErr] = useState('');
  // Pending counts per tab (requests the manager hasn't acted on yet).
  const [counts, setCounts] = useState({ leave: 0, allowance: 0, attnreq: 0 });

  // Action modal state.
  const [action, setAction] = useState<{
    kind: TabKey;
    mode: 'Approved' | 'Rejected';
    row: any;
  } | null>(null);
  const [comment, setComment] = useState('');
  const [amount, setAmount] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const load = useCallback(async () => {
    setErr('');
    setLoading(true);
    try {
      let res;
      if (tab === 'leave') res = await managerAPI.leaves();
      else if (tab === 'allowance') res = await managerAPI.allowances({ type: allowanceType });
      else res = await managerAPI.attendanceRequests();
      setItems(res?.data?.items || []);
    } catch (e: any) {
      setErr(e?.response?.data?.message || e?.message || 'Could not load requests.');
      setItems([]);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [tab, allowanceType]);

  // Pending counts across ALL tabs (so each tab shows its own badge even
  // when it's not the active tab). "Pending" = not yet acted on by the
  // manager (managerStatus empty).
  const loadCounts = useCallback(async () => {
    try {
      const [lv, tv, pt, ar] = await Promise.all([
        managerAPI.leaves(),
        managerAPI.allowances({ type: 'travel' }),
        managerAPI.allowances({ type: 'petrol' }),
        managerAPI.attendanceRequests(),
      ]);
      const pend = (arr: any[]) => (arr || []).filter((x) => !x.managerStatus).length;
      setCounts({
        leave: pend(lv?.data?.items),
        allowance: pend(tv?.data?.items) + pend(pt?.data?.items),
        attnreq: pend(ar?.data?.items),
      });
    } catch { /* counts are best-effort */ }
  }, []);

  React.useEffect(() => { load(); }, [load]);
  React.useEffect(() => { loadCounts(); }, [loadCounts]);

  const onRefresh = () => { setRefreshing(true); load(); loadCounts(); };

  const openAction = (row: any, mode: 'Approved' | 'Rejected') => {
    setComment('');
    setAmount(mode === 'Approved' && tab === 'allowance' ? String(row.amount ?? '') : '');
    setAction({ kind: tab, mode, row });
  };

  const closeAction = () => { if (!submitting) { setAction(null); setComment(''); setAmount(''); } };

  const submitAction = async () => {
    if (!action) return;
    setSubmitting(true);
    try {
      const { kind, mode, row } = action;
      if (kind === 'leave') {
        await managerAPI.actLeave(row._id, mode);
      } else if (kind === 'allowance') {
        const payload: any = { amountComment: comment.trim() || undefined };
        if (mode === 'Approved') {
          const n = Number(amount);
          if (isFinite(n)) payload.approvedAmount = n;
        }
        await managerAPI.actAllowance(row._id, mode, payload);
      } else {
        await managerAPI.actAttendanceRequest(
          row._id,
          mode === 'Approved' ? 'approved' : 'rejected',
          comment.trim() || undefined,
        );
      }
      // Optimistically update the row's managerStatus in place.
      setItems((cur) =>
        cur.map((r) => (r._id === row._id ? { ...r, managerStatus: mode, status: mode === 'Rejected' ? 'rejected' : r.status } : r)),
      );
      setAction(null);
      setComment('');
      setAmount('');
      loadCounts(); // refresh the tab badges after acting
    } catch (e: any) {
      setErr(e?.response?.data?.message || e?.message || 'Action failed. Please try again.');
    } finally {
      setSubmitting(false);
    }
  };

  const tabs = useMemo(
    () => [
      { key: 'leave', label: 'Leave' },
      { key: 'allowance', label: 'Allowance' },
      { key: 'attnreq', label: 'Attn. Req' },
    ],
    [],
  );

  return (
    <View style={styles.screen}>
      <ManagerHeader title="Approvals" subtitle="Review your team's requests" />

      <Segmented options={tabs} value={tab} onChange={(k) => setTab(k as TabKey)} counts={counts} />

      {tab === 'allowance' && (
        <View style={styles.subToggleRow}>
          {(['petrol', 'travel'] as const).map((t) => (
            <TouchableOpacity
              key={t}
              style={[styles.subToggle, allowanceType === t && styles.subToggleActive]}
              onPress={() => setAllowanceType(t)}
              activeOpacity={0.8}
            >
              <MaterialCommunityIcons
                name={t === 'petrol' ? 'gas-station' : 'car'}
                size={15}
                color={allowanceType === t ? MC.green : MC.sub}
              />
              <Text style={[styles.subToggleText, allowanceType === t && styles.subToggleTextActive]}>
                {t === 'petrol' ? 'Petrol' : 'Travel'}
              </Text>
            </TouchableOpacity>
          ))}
        </View>
      )}

      {loading ? (
        <Loading label="Loading requests…" />
      ) : (
        <ScrollView
          contentContainerStyle={{ paddingBottom: insets.bottom + 32 }}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} colors={[MC.green]} />}
        >
          {!!err && (
            <Card style={{ backgroundColor: MC.redBg }}>
              <Text style={{ color: MC.red, fontSize: 13 }}>{err}</Text>
            </Card>
          )}

          {items.length === 0 && !err ? (
            <EmptyState
              icon="checkmark-done-outline"
              title="Nothing to review"
              hint="Requests from your team will appear here."
            />
          ) : (
            items.map((row) => (
              <RequestCard
                key={row._id}
                tab={tab}
                row={row}
                onApprove={() => openAction(row, 'Approved')}
                onReject={() => openAction(row, 'Rejected')}
              />
            ))
          )}
        </ScrollView>
      )}

      {/* Approve / Reject action sheet */}
      <Modal visible={!!action} transparent animationType="slide" onRequestClose={closeAction}>
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          style={styles.modalWrap}
        >
          <TouchableOpacity style={styles.modalBackdrop} activeOpacity={1} onPress={closeAction} />
          <View style={styles.sheet}>
            <View style={styles.sheetHandle} />
            <Text style={styles.sheetTitle}>
              {action?.mode === 'Approved' ? 'Approve' : 'Reject'}{' '}
              {action?.kind === 'leave' ? 'request' : action?.kind === 'allowance' ? 'claim' : 'request'}
            </Text>
            {!!action?.row && (
              <Text style={styles.sheetSub}>{empName(action.row.user)}</Text>
            )}

            {action?.kind === 'allowance' && action?.mode === 'Approved' && (
              <View style={{ marginTop: 12 }}>
                <Text style={styles.fieldLabel}>Approved amount (₹)</Text>
                <TextInput
                  style={styles.input}
                  value={amount}
                  onChangeText={setAmount}
                  keyboardType="numeric"
                  placeholder={String(action?.row?.amount ?? '')}
                  placeholderTextColor="#B7B7B7"
                />
                <Text style={styles.hint}>
                  Claimed {rupee(action?.row?.amount)}. Approve less to partially approve; the rest is
                  marked not approved.
                </Text>
              </View>
            )}

            <Text style={[styles.fieldLabel, { marginTop: 12 }]}>
              {action?.mode === 'Rejected' ? 'Reason (recommended)' : 'Remark (optional)'}
            </Text>
            <TextInput
              style={[styles.input, styles.inputMultiline]}
              value={comment}
              onChangeText={setComment}
              placeholder="Add a note for the employee…"
              placeholderTextColor="#B7B7B7"
              multiline
            />

            <View style={styles.sheetBtns}>
              <TouchableOpacity style={styles.cancelBtn} onPress={closeAction} disabled={submitting}>
                <Text style={styles.cancelText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[
                  styles.confirmBtn,
                  { backgroundColor: action?.mode === 'Approved' ? MC.green : MC.red },
                ]}
                onPress={submitAction}
                disabled={submitting}
              >
                {submitting ? (
                  <ActivityIndicator color="#fff" />
                ) : (
                  <Text style={styles.confirmText}>
                    {action?.mode === 'Approved' ? 'Approve' : 'Reject'}
                  </Text>
                )}
              </TouchableOpacity>
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </View>
  );
}

/** One request card, rendered per tab. */
function RequestCard({
  tab, row, onApprove, onReject,
}: { tab: TabKey; row: any; onApprove: () => void; onReject: () => void }) {
  const acted = !!row.managerStatus; // '' means not yet acted
  const mStatus = row.managerStatus || 'Pending';

  let headline = '';
  let lines: { label: string; value: string }[] = [];

  if (tab === 'leave') {
    const isPerm = row.requestType === 'permission';
    headline = isPerm ? (row.permissionType ? `Permission — ${row.permissionType}` : 'Permission') : `Leave — ${row.leaveType || ''}`;
    if (isPerm) {
      lines.push({ label: 'Date', value: `${row.date || '—'}${row.startTime && row.endTime ? `  ${row.startTime}–${row.endTime}` : ''}` });
    } else {
      lines.push({ label: 'Dates', value: `${row.startDate || '—'}${row.endDate && row.endDate !== row.startDate ? ` → ${row.endDate}` : ''}` });
    }
    if (row.reason) lines.push({ label: 'Reason', value: row.reason });
  } else if (tab === 'allowance') {
    headline = row.type === 'travel' ? 'Travel claim' : 'Petrol claim';
    lines.push({ label: 'Route', value: `${row.fromLocation || '—'} → ${row.toLocation || '—'}` });
    if (row.type === 'petrol' && row.distance) lines.push({ label: 'Distance', value: `${row.distance} km` });
    lines.push({ label: 'Amount', value: rupee(row.amount) });
    lines.push({ label: 'Date', value: row.date || '—' });
    if (row.notes) lines.push({ label: 'Notes', value: row.notes });
    if (acted && (row.approvedAmount || row.rejectedAmount)) {
      lines.push({ label: 'Approved', value: `${rupee(row.approvedAmount)}${row.rejectedAmount ? `  ·  Not approved ${rupee(row.rejectedAmount)}` : ''}` });
    }
  } else {
    headline = `Attendance — ${row.requestType || 'regularize'}`;
    lines.push({ label: 'Date', value: row.date || '—' });
    if (row.reason) lines.push({ label: 'Reason', value: row.reason });
  }

  return (
    <Card>
      <View style={styles.cardTop}>
        <View style={styles.avatar}>
          <Text style={styles.avatarText}>{empName(row.user).trim()[0]?.toUpperCase() || '?'}</Text>
        </View>
        <View style={{ flex: 1 }}>
          <Text style={styles.cardName}>{empName(row.user)}</Text>
          <Text style={styles.cardEmp}>{row.user?.employeeId || ''}</Text>
        </View>
        <Pill label={mStatus} tone={toneForStatus(row.managerStatus)} />
      </View>

      <Text style={styles.cardHeadline}>{headline}</Text>
      {lines.map((l, i) => (
        <View key={i} style={styles.lineRow}>
          <Text style={styles.lineLabel}>{l.label}</Text>
          <Text style={styles.lineValue}>{l.value}</Text>
        </View>
      ))}

      {row.status ? (
        <View style={[styles.lineRow, { marginTop: 4 }]}>
          <Text style={styles.lineLabel}>HR status</Text>
          <Pill label={row.status} tone={toneForStatus(row.status)} />
        </View>
      ) : null}

      {!acted ? (
        <View style={styles.actionRow}>
          <TouchableOpacity style={[styles.actBtn, styles.rejectBtn]} onPress={onReject} activeOpacity={0.85}>
            <Ionicons name="close" size={16} color={MC.red} />
            <Text style={[styles.actText, { color: MC.red }]}>Reject</Text>
          </TouchableOpacity>
          <TouchableOpacity style={[styles.actBtn, styles.approveBtn]} onPress={onApprove} activeOpacity={0.85}>
            <Ionicons name="checkmark" size={16} color="#fff" />
            <Text style={[styles.actText, { color: '#fff' }]}>Approve</Text>
          </TouchableOpacity>
        </View>
      ) : (
        (() => {
          const approved = String(row.managerStatus || '').toLowerCase().includes('approv');
          return (
            <View style={styles.actedRow}>
              <Ionicons
                name={approved ? 'checkmark-circle' : 'close-circle'}
                size={18}
                color={approved ? MC.green : MC.red}
              />
              <Text style={[styles.actedText, { color: approved ? MC.green : MC.red }]}>
                {approved ? 'Approved' : 'Rejected'} by you
              </Text>
            </View>
          );
        })()
      )}
    </Card>
  );
}

export default function ApprovalsScreen() {
  return (
    <ScreenErrorBoundary name="ManagerApprovals">
      <Approvals />
    </ScreenErrorBoundary>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: MC.bg },

  subToggleRow: { flexDirection: 'row', gap: 10, paddingHorizontal: 14, marginTop: 10 },
  subToggle: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    paddingHorizontal: 14, paddingVertical: 7, borderRadius: 999,
    borderWidth: 1, borderColor: MC.border, backgroundColor: '#fff',
  },
  subToggleActive: { borderColor: MC.green, backgroundColor: MC.greenBg },
  subToggleText: { fontSize: 12.5, color: MC.sub, fontWeight: '600' },
  subToggleTextActive: { color: MC.green, fontWeight: '800' },

  cardTop: { flexDirection: 'row', alignItems: 'center', marginBottom: 10 },
  avatar: {
    width: 38, height: 38, borderRadius: 19, backgroundColor: '#E8F5E9',
    alignItems: 'center', justifyContent: 'center', marginRight: 10,
  },
  avatarText: { color: MC.green, fontWeight: '800', fontSize: 16 },
  cardName: { fontSize: 14.5, fontWeight: '800', color: MC.text },
  cardEmp: { fontSize: 11.5, color: MC.sub, marginTop: 1 },
  cardHeadline: { fontSize: 13.5, fontWeight: '700', color: MC.green, marginBottom: 8 },

  lineRow: { flexDirection: 'row', alignItems: 'flex-start', marginBottom: 5 },
  lineLabel: { width: 78, fontSize: 12, color: MC.sub, fontWeight: '600' },
  lineValue: { flex: 1, fontSize: 12.5, color: MC.text },

  actionRow: { flexDirection: 'row', gap: 10, marginTop: 12 },
  actBtn: {
    flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    gap: 6, paddingVertical: 10, borderRadius: 10,
  },
  approveBtn: { backgroundColor: MC.green },
  rejectBtn: { backgroundColor: '#fff', borderWidth: 1.4, borderColor: MC.red },
  actText: { fontSize: 13.5, fontWeight: '800' },

  actedRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 12 },
  actedText: { fontSize: 12.5, color: MC.sub, fontWeight: '600' },

  // Modal
  modalWrap: { flex: 1, justifyContent: 'flex-end' },
  modalBackdrop: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0,0,0,0.4)' },
  sheet: {
    backgroundColor: '#fff', borderTopLeftRadius: 22, borderTopRightRadius: 22,
    paddingHorizontal: 20, paddingTop: 10, paddingBottom: 28,
  },
  sheetHandle: { alignSelf: 'center', width: 40, height: 4, borderRadius: 2, backgroundColor: '#DADCE0', marginBottom: 14 },
  sheetTitle: { fontSize: 17, fontWeight: '800', color: MC.text },
  sheetSub: { fontSize: 13, color: MC.sub, marginTop: 2 },
  fieldLabel: { fontSize: 12.5, fontWeight: '700', color: MC.text, marginBottom: 6 },
  hint: { fontSize: 11.5, color: MC.sub, marginTop: 6 },
  input: {
    borderWidth: 1, borderColor: MC.border, backgroundColor: '#FAFAFA',
    borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10, fontSize: 14, color: MC.text,
  },
  inputMultiline: { minHeight: 72, textAlignVertical: 'top' },
  sheetBtns: { flexDirection: 'row', gap: 12, marginTop: 18 },
  cancelBtn: { flex: 1, paddingVertical: 13, borderRadius: 10, alignItems: 'center', backgroundColor: '#F1F1F1' },
  cancelText: { fontSize: 14, fontWeight: '700', color: MC.sub },
  confirmBtn: { flex: 1.4, paddingVertical: 13, borderRadius: 10, alignItems: 'center' },
  confirmText: { fontSize: 14, fontWeight: '800', color: '#fff' },
});
