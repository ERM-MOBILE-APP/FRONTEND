import React, { useState, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
  ActivityIndicator,
  RefreshControl,
  Modal,
  Alert,
  Pressable,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons, Feather } from '@expo/vector-icons';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { router, useFocusEffect } from 'expo-router';
import { payslipAPI } from '../../services/api';

const GREEN      = '#4CAF50';
const GREEN_DARK = '#2E7D32';

const MONTHS = [
  '', 'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
];

// Rotating pastel palette for the colored card icons, matching the Figma
// (yellow, orange, purple, blue, green, red, etc).
const ICON_PALETTE = [
  { bg: '#FFF6CC', fg: '#E0A800' }, // yellow
  { bg: '#FFE0CC', fg: '#E76A1F' }, // orange
  { bg: '#E5D8FF', fg: '#7C3AED' }, // purple
  { bg: '#CFE6FF', fg: '#1A6FD8' }, // blue
  { bg: '#CFF2D7', fg: '#1B8A3E' }, // green
  { bg: '#FFD1D1', fg: '#D43030' }, // red
];

const fmtRupees = (n: number) =>
  '₹' + (n ?? 0).toLocaleString('en-IN');

const fmtDateRange = (year: number, month: number) => {
  const last = new Date(year, month, 0).getDate();
  const mm = String(month).padStart(2, '0');
  return `${('01/' + mm + '/' + year)} - ${(String(last).padStart(2, '0') + '/' + mm + '/' + year)}`;
};

interface Payslip {
  _id: string;
  month: number;
  year: number;
  monthLabel?: string;
  netPay: number;
  totalGross?: number;
  totalDeductions?: number;
  status?: 'requested' | 'processed' | 'pending' | 'rejected';
}

export default function PayslipScreen() {
  const [user, setUser]                   = useState<any>(null);
  const [history, setHistory]             = useState<Payslip[]>([]);
  const [loading, setLoading]             = useState(true);
  const [refreshing, setRefreshing]       = useState(false);
  const [error, setError]                 = useState('');
  const [selectedYear, setSelectedYear]   = useState(new Date().getFullYear());
  const [yearPickerVisible, setYearPickerVisible] = useState(false);
  const [requestVisible, setRequestVisible] = useState(false);
  const [reqMonth, setReqMonth] = useState(new Date().getMonth() + 1);
  const [reqYear,  setReqYear]  = useState(new Date().getFullYear());
  const [requesting, setRequesting] = useState(false);

  // Today's month/year — used to disable "upcoming" (future) month chips
  // in the request modal. You can only request a payslip for a month that
  // has already started (current month or earlier).
  const now             = new Date();
  const currentMonth    = now.getMonth() + 1;
  const currentYear     = now.getFullYear();

  const availableYears = [
    new Date().getFullYear(),
    new Date().getFullYear() - 1,
    new Date().getFullYear() - 2,
  ];

  // A month is "future" (and therefore not requestable) if its year is
  // later than the current year, OR same year but later month.
  const isFutureMonth = (m: number, y: number) =>
    y > currentYear || (y === currentYear && m > currentMonth);

  const submitDisabled = requesting || isFutureMonth(reqMonth, reqYear);

  useEffect(() => {
    AsyncStorage.getItem('user').then((u) => {
      if (u) { try { setUser(JSON.parse(u)); } catch {} }
    });
  }, []);

  const fetchHistory = useCallback(async (year = selectedYear) => {
    try {
      setError('');
      const res = await payslipAPI.getHistory(year);
      setHistory(Array.isArray(res.data) ? res.data : []);
    } catch (e: any) {
      setError(e?.response?.data?.message || 'Could not load payslip history.');
      setHistory([]);
    }
  }, [selectedYear]);

  useEffect(() => {
    setLoading(true);
    fetchHistory(selectedYear).finally(() => setLoading(false));
  }, [selectedYear, fetchHistory]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await fetchHistory(selectedYear);
    setRefreshing(false);
  }, [selectedYear, fetchHistory]);

  // Refresh on tab focus so an HR upload (status → processed) shows up
  // without needing to pull-to-refresh.
  useFocusEffect(
    useCallback(() => {
      fetchHistory(selectedYear);
    }, [selectedYear, fetchHistory])
  );

  const submitRequest = async () => {
    if (requesting) return;
    setRequesting(true);
    try {
      await payslipAPI.request(reqMonth, reqYear);
      Alert.alert(
        'Request submitted',
        `HR has been notified to upload your ${MONTHS[reqMonth]} ${reqYear} payslip. ` +
        `You'll get a notification once it's ready to download.`
      );
      setRequestVisible(false);
      fetchHistory(selectedYear);
    } catch (err: any) {
      // Surface the SPECIFIC reason from the server (e.g. "Already requested")
      // instead of a bland "Please try again later." A 409 'ALREADY_EXISTS'
      // is informational, not a real failure, so we treat it as a success-ish
      // alert with the existing-record context.
      const data    = err?.response?.data || {};
      const status  = err?.response?.status;
      const message = data.message
        || (status === 401 ? 'Please sign in again.' : null)
        || err?.message
        || 'Please try again later.';
      const title = status === 409 ? 'Already requested' : 'Could not request';
      Alert.alert(title, message);
      if (status === 409) {
        // Refresh the list so the user sees the existing record.
        setRequestVisible(false);
        fetchHistory(selectedYear);
      }
    } finally {
      setRequesting(false);
    }
  };

  return (
    <View style={styles.root}>
      <SafeAreaView edges={['top']} style={{ flex: 1 }}>

        {/* ───── HEADER ─────────────────────────────────────────────────── */}
        <View style={styles.header}>
          <TouchableOpacity
            style={styles.backBtn}
            onPress={() => router.back()}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          >
            <Ionicons name="arrow-back" size={22} color="#FFFFFF" />
          </TouchableOpacity>
          <View style={{ marginLeft: 6 }}>
            <Text style={styles.headerTitle}>
              Hey {(user?.name && String(user.name).split(' ')[0]) || 'Vijay'} 👋
            </Text>
            <Text style={styles.headerSub}>Welcome To My Pay Summary Details</Text>
          </View>
        </View>

        {/* ───── HISTORY CARD ───────────────────────────────────────────── */}
        <View style={styles.body}>
          <View style={styles.historyHeader}>
            <Text style={styles.sectionTitle}>Payslip History</Text>
            <TouchableOpacity
              style={styles.yearPicker}
              onPress={() => setYearPickerVisible(true)}
              activeOpacity={0.8}
            >
              <Text style={styles.yearPickerText}>Year</Text>
              <Ionicons name="chevron-down" size={14} color="#555" style={{ marginLeft: 4 }} />
            </TouchableOpacity>
          </View>

          {/* Request-a-payslip button — opens month/year picker modal */}
          <TouchableOpacity
            style={styles.requestPayslipBtn}
            onPress={() => setRequestVisible(true)}
            activeOpacity={0.85}
          >
            <Feather name="plus-circle" size={16} color="#FFFFFF" />
            <Text style={styles.requestPayslipBtnText}>Request a payslip from HR</Text>
          </TouchableOpacity>

          {loading ? (
            <View style={styles.centered}>
              <ActivityIndicator color={GREEN} />
              <Text style={styles.loadingText}>Loading payslips…</Text>
            </View>
          ) : error ? (
            <View style={styles.centered}>
              <Ionicons name="cloud-offline-outline" size={36} color="#CCC" />
              <Text style={styles.emptyText}>{error}</Text>
            </View>
          ) : history.length === 0 ? (
            <View style={styles.centered}>
              <Ionicons name="document-text-outline" size={36} color="#CCC" />
              <Text style={styles.emptyText}>No payslips found for {selectedYear}.</Text>
            </View>
          ) : (
            <ScrollView
              showsVerticalScrollIndicator={false}
              contentContainerStyle={{ paddingBottom: 110 }}
              refreshControl={
                <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={GREEN} />
              }
            >
              {history.map((p, idx) => {
                const palette     = ICON_PALETTE[idx % ICON_PALETTE.length];
                const isProcessed = p.status === 'processed';
                const isRequested = p.status === 'requested' || p.status === 'pending';
                const isRejected  = p.status === 'rejected';
                return (
                  <TouchableOpacity
                    key={p._id}
                    style={[styles.payCard, { borderColor: palette.fg }]}
                    activeOpacity={0.85}
                    onPress={() =>
                      router.push({
                        pathname: '/payslip-summary',
                        params: { id: p._id },
                      } as any)
                    }
                  >
                    <View style={[styles.payIcon, { backgroundColor: palette.bg }]}>
                      <Feather name="credit-card" size={20} color={palette.fg} />
                    </View>

                    <View style={{ flex: 1, marginLeft: 12 }}>
                      <View style={styles.payRow}>
                        <Text style={styles.payMonth}>{MONTHS[p.month] || '—'}</Text>
                        <Text style={styles.payAmount}>
                          {isProcessed ? fmtRupees(p.netPay) : '—'}
                        </Text>
                      </View>
                      <View style={[styles.payRow, { marginTop: 4 }]}>
                        <Text style={styles.payDates}>
                          {fmtDateRange(p.year, p.month)}
                        </Text>

                        {/* Status pill + download. Download icon is disabled
                            (grey, no-op alert) until HR uploads → status='processed'. */}
                        <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                          {isRequested && (
                            <View style={[styles.statusPill, { backgroundColor: '#FFF3CD' }]}>
                              <Text style={[styles.statusPillText, { color: '#8A6300' }]}>Awaiting HR</Text>
                            </View>
                          )}
                          {isRejected && (
                            <View style={[styles.statusPill, { backgroundColor: '#FFE3E3' }]}>
                              <Text style={[styles.statusPillText, { color: '#C62828' }]}>Declined</Text>
                            </View>
                          )}
                          <TouchableOpacity
                            onPress={(e) => {
                              e.stopPropagation?.();
                              Alert.alert(
                                'Download',
                                isProcessed
                                  ? 'PDF download will be available once HR enables it.'
                                  : 'Wait for HR to upload this payslip before downloading.'
                              );
                            }}
                            hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
                            style={{ marginLeft: 10 }}
                            disabled={!isProcessed}
                          >
                            <Feather
                              name="download"
                              size={16}
                              color={isProcessed ? '#2E7D32' : '#CCC'}
                            />
                          </TouchableOpacity>
                        </View>
                      </View>
                    </View>
                  </TouchableOpacity>
                );
              })}
            </ScrollView>
          )}
        </View>

      </SafeAreaView>

      {/* ───── REQUEST PAYSLIP MODAL ──────────────────────────────────── */}
      <Modal
        visible={requestVisible}
        transparent
        animationType="slide"
        onRequestClose={() => setRequestVisible(false)}
      >
        <Pressable
          style={styles.modalOverlay}
          onPress={() => setRequestVisible(false)}
        >
          <Pressable style={styles.requestSheet} onPress={() => {}}>
            <Text style={styles.yearModalTitle}>Request a payslip</Text>
            <Text style={styles.requestSub}>
              Pick the month and year. HR will be notified and upload your
              payslip — you'll get a notification once it's ready to download.
            </Text>

            <Text style={styles.fieldLabel}>Month</Text>
            <View style={styles.monthGrid}>
              {MONTHS.slice(1).map((m, i) => {
                const v        = i + 1;
                const active   = v === reqMonth;
                const isFuture = isFutureMonth(v, reqYear);
                return (
                  <TouchableOpacity
                    key={m}
                    style={[
                      styles.monthChip,
                      active && !isFuture && styles.monthChipActive,
                      isFuture && styles.monthChipDisabled,
                    ]}
                    onPress={() => { if (!isFuture) setReqMonth(v); }}
                    disabled={isFuture}
                  >
                    <Text
                      style={[
                        styles.monthChipText,
                        active && !isFuture && { color: '#FFFFFF' },
                        isFuture && { color: '#BBBBBB' },
                      ]}
                    >
                      {m}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </View>

            <Text style={[styles.fieldLabel, { marginTop: 14 }]}>Year</Text>
            <View style={{ flexDirection: 'row' }}>
              {availableYears.map((y) => (
                <TouchableOpacity
                  key={y}
                  style={[
                    styles.yearChip,
                    y === reqYear && styles.yearChipActive,
                  ]}
                  onPress={() => setReqYear(y)}
                >
                  <Text style={[styles.yearChipText, y === reqYear && { color: '#FFFFFF' }]}>
                    {y}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>

            {isFutureMonth(reqMonth, reqYear) && (
              <Text style={styles.futureWarn}>
                {MONTHS[reqMonth]} {reqYear} hasn't happened yet — pick a past or current month.
              </Text>
            )}

            <TouchableOpacity
              style={[styles.submitReqBtn, submitDisabled && { opacity: 0.45 }]}
              onPress={submitRequest}
              disabled={submitDisabled}
            >
              <Text style={styles.submitReqBtnText}>
                {requesting
                  ? 'Submitting…'
                  : isFutureMonth(reqMonth, reqYear)
                  ? 'Pick a past month'
                  : `Request ${MONTHS[reqMonth]} ${reqYear}`}
              </Text>
            </TouchableOpacity>
          </Pressable>
        </Pressable>
      </Modal>

      {/* ───── YEAR PICKER MODAL ──────────────────────────────────────── */}
      <Modal
        visible={yearPickerVisible}
        transparent
        animationType="fade"
        onRequestClose={() => setYearPickerVisible(false)}
      >
        <TouchableOpacity
          style={styles.modalOverlay}
          activeOpacity={1}
          onPress={() => setYearPickerVisible(false)}
        >
          <View style={styles.yearModal}>
            <Text style={styles.yearModalTitle}>Select Year</Text>
            {availableYears.map((y) => (
              <TouchableOpacity
                key={y}
                style={[styles.yearOption, y === selectedYear && styles.yearOptionActive]}
                onPress={() => { setSelectedYear(y); setYearPickerVisible(false); }}
              >
                <Text style={[styles.yearOptionText, y === selectedYear && { color: GREEN, fontWeight: '700' }]}>
                  {y}
                </Text>
                {y === selectedYear && <Ionicons name="checkmark" size={16} color={GREEN} />}
              </TouchableOpacity>
            ))}
          </View>
        </TouchableOpacity>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: GREEN },

  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 18,
    paddingBottom: 22,
    paddingTop: 8,
  },
  backBtn: {
    width: 32, height: 32,
    alignItems: 'center', justifyContent: 'center',
  },
  headerTitle: { color: '#FFFFFF', fontSize: 20, fontWeight: '800' },
  headerSub:   { color: 'rgba(255,255,255,0.92)', fontSize: 12.5, marginTop: 3 },

  body: {
    flex: 1,
    backgroundColor: '#FFFFFF',
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    paddingTop: 22,
    paddingHorizontal: 18,
  },
  historyHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 16,
  },
  sectionTitle: { fontSize: 16, fontWeight: '800', color: '#111' },
  yearPicker: {
    flexDirection: 'row', alignItems: 'center',
    borderWidth: 1, borderColor: '#E0E0E0',
    borderRadius: 20, paddingHorizontal: 14, paddingVertical: 6,
    backgroundColor: '#FAFAFA',
  },
  yearPickerText: { fontSize: 13, fontWeight: '600', color: '#333' },

  payCard: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1.5,
    borderRadius: 14,
    paddingVertical: 12,
    paddingHorizontal: 14,
    marginBottom: 12,
    backgroundColor: '#FFFFFF',
  },
  payIcon: {
    width: 42, height: 42, borderRadius: 21,
    alignItems: 'center', justifyContent: 'center',
  },
  payRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  payMonth:  { fontSize: 14, fontWeight: '700', color: '#1A1A1A' },
  payAmount: { fontSize: 14, fontWeight: '700', color: '#1A1A1A' },
  payDates:  { fontSize: 11.5, color: '#8A8A8A' },

  centered: {
    alignItems: 'center', justifyContent: 'center',
    paddingVertical: 50,
  },
  loadingText: { marginTop: 10, color: '#777', fontSize: 13 },
  emptyText:   { marginTop: 10, color: '#888', fontSize: 13, textAlign: 'center' },

  modalOverlay: {
    flex: 1, backgroundColor: 'rgba(0,0,0,0.4)',
    alignItems: 'center', justifyContent: 'center',
  },
  yearModal: {
    backgroundColor: '#FFF', borderRadius: 20,
    width: 260, paddingVertical: 20, paddingHorizontal: 24,
    shadowColor: '#000', shadowOpacity: 0.2,
    shadowOffset: { width: 0, height: 8 }, shadowRadius: 20, elevation: 12,
  },
  yearModalTitle: {
    fontSize: 16, fontWeight: '700', color: '#111',
    marginBottom: 16, textAlign: 'center',
  },
  yearOption: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: '#F0F0F0',
  },
  yearOptionActive: { backgroundColor: '#F1F8F1', borderRadius: 10, paddingHorizontal: 8 },
  yearOptionText: { fontSize: 15, color: '#333' },

  /* Request a payslip — list-level button */
  requestPayslipBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#1565C0',
    borderRadius: 24,
    paddingVertical: 12,
    marginBottom: 14,
  },
  requestPayslipBtnText: {
    color: '#FFFFFF',
    fontSize: 13.5,
    fontWeight: '700',
    marginLeft: 8,
  },

  /* Status pill on each payslip card */
  statusPill: {
    paddingHorizontal: 8, paddingVertical: 3, borderRadius: 10,
  },
  statusPillText: { fontSize: 10.5, fontWeight: '700' },

  /* Request modal — month/year chips */
  requestSheet: {
    backgroundColor: '#FFFFFF',
    borderTopLeftRadius: 22, borderTopRightRadius: 22,
    paddingTop: 20, paddingHorizontal: 22, paddingBottom: 28,
    width: '100%',
    position: 'absolute', bottom: 0,
  },
  requestSub: { fontSize: 12, color: '#7A7A7A', marginTop: 4, marginBottom: 14, lineHeight: 17 },
  fieldLabel: { fontSize: 13, fontWeight: '700', color: '#1A1A1A', marginBottom: 8 },
  monthGrid: { flexDirection: 'row', flexWrap: 'wrap' },
  monthChip: {
    paddingHorizontal: 12, paddingVertical: 7, borderRadius: 16,
    borderWidth: 1, borderColor: '#E0E0E0',
    marginRight: 7, marginBottom: 7,
    backgroundColor: '#FAFAFA',
  },
  monthChipActive:   { backgroundColor: GREEN, borderColor: GREEN },
  monthChipDisabled: { backgroundColor: '#F2F2F2', borderColor: '#EAEAEA', opacity: 0.7 },
  monthChipText:     { fontSize: 12, fontWeight: '600', color: '#444' },
  futureWarn: {
    marginTop: 12,
    fontSize: 12,
    color: '#C62828',
    fontWeight: '600',
  },
  yearChip: {
    paddingHorizontal: 14, paddingVertical: 8, borderRadius: 16,
    borderWidth: 1, borderColor: '#E0E0E0',
    marginRight: 8, backgroundColor: '#FAFAFA',
  },
  yearChipActive: { backgroundColor: GREEN, borderColor: GREEN },
  yearChipText:   { fontSize: 13, fontWeight: '600', color: '#444' },
  submitReqBtn: {
    backgroundColor: GREEN, borderRadius: 26, paddingVertical: 14,
    alignItems: 'center', marginTop: 22,
    shadowColor: GREEN, shadowOpacity: 0.3, shadowOffset: { width: 0, height: 6 }, shadowRadius: 10, elevation: 5,
  },
  submitReqBtnText: { color: '#FFFFFF', fontSize: 14, fontWeight: '700' },
});
