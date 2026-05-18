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
  FlatList,
  Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { payslipAPI } from '../../services/api';

const GREEN      = '#4CAF50';
const DARK_GREEN = '#1B5E20';
const MID_GREEN  = '#2E7D32';
const CREAM      = '#FFFBEE';
const RED        = '#E53935';
const AMBER      = '#F9A825';

// ─── helpers ────────────────────────────────────────────────────────────────
const fmt = (n: number) =>
  '₹' + (n ?? 0).toLocaleString('en-IN', { minimumFractionDigits: 2 });

const MONTHS = [
  '', 'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
];

function initials(name: string) {
  return (name || 'U')
    .split(' ')
    .slice(0, 2)
    .map((w: string) => w[0]?.toUpperCase() ?? '')
    .join('');
}

// ─── types ───────────────────────────────────────────────────────────────────
interface Payslip {
  _id: string;
  month: number;
  year: number;
  monthLabel: string;
  earnings: {
    basicSalary: number;
    hraAllowance: number;
    performanceBonus: number;
    otherEarnings: number;
  };
  deductions: {
    incomeTax: number;
    providentFund: number;
    healthInsurance: number;
    lopDeduction: number;
    otherDeductions: number;
  };
  totalGross: number;
  totalDeductions: number;
  netPay: number;
  status: string;
  paidVia: string;
}

// ─── row components ──────────────────────────────────────────────────────────
function EarnRow({ label, amount, highlight }: { label: string; amount: number; highlight?: boolean }) {
  return (
    <View style={styles.row}>
      <Text style={styles.rowLabel}>{label}</Text>
      <Text style={[styles.rowValue, highlight && { color: GREEN, fontWeight: '700' }]}>
        {fmt(amount)}
      </Text>
    </View>
  );
}

function DeductRow({ label, amount }: { label: string; amount: number }) {
  return (
    <View style={styles.row}>
      <Text style={styles.rowLabel}>{label}</Text>
      <Text style={[styles.rowValue, { color: RED }]}>{fmt(amount)}</Text>
    </View>
  );
}

// ─── main screen ─────────────────────────────────────────────────────────────
export default function PayslipScreen() {
  const [user, setUser]           = useState<any>(null);
  const [latest, setLatest]       = useState<Payslip | null>(null);
  const [history, setHistory]     = useState<Payslip[]>([]);
  const [loading, setLoading]     = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError]         = useState('');
  const [selectedYear, setSelectedYear] = useState(new Date().getFullYear());
  const [yearPickerVisible, setYearPickerVisible] = useState(false);

  // Years available (current year - 2 to current year)
  const availableYears = [
    new Date().getFullYear(),
    new Date().getFullYear() - 1,
    new Date().getFullYear() - 2,
  ];

  // ── fetch ──────────────────────────────────────────────────────────────────
  const fetchData = useCallback(async (year = selectedYear) => {
    try {
      setError('');
      const [latestRes, histRes] = await Promise.all([
        payslipAPI.getLatest(),
        payslipAPI.getHistory(year),
      ]);
      setLatest(latestRes.data);
      setHistory(histRes.data);
    } catch (e: any) {
      const msg = e?.response?.data?.message || e.message || 'Could not load payslip';
      setError(msg);
    }
  }, [selectedYear]);

  useEffect(() => {
    AsyncStorage.getItem('user').then(u => {
      if (u) { try { setUser(JSON.parse(u)); } catch { } }
    });
  }, []);

  useEffect(() => {
    setLoading(true);
    fetchData(selectedYear).finally(() => setLoading(false));
  }, [selectedYear]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await fetchData(selectedYear);
    setRefreshing(false);
  }, [selectedYear, fetchData]);

  const handleYearSelect = (y: number) => {
    setSelectedYear(y);
    setYearPickerVisible(false);
  };

  // ── render ─────────────────────────────────────────────────────────────────
  if (loading) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator size="large" color={GREEN} />
        <Text style={styles.loadingText}>Loading payslip…</Text>
      </View>
    );
  }

  if (error && !latest) {
    return (
      <View style={styles.centered}>
        <Ionicons name="cloud-offline-outline" size={48} color="#CCC" />
        <Text style={styles.errorText}>{error}</Text>
        <TouchableOpacity style={styles.retryBtn} onPress={() => { setLoading(true); fetchData().finally(() => setLoading(false)); }}>
          <Text style={styles.retryBtnText}>Retry</Text>
        </TouchableOpacity>
      </View>
    );
  }

  // Percentage of gross received as net
  const receivedPct = latest
    ? Math.round((latest.netPay / (latest.totalGross || 1)) * 100)
    : 0;

  // History cards (exclude the latest month shown in header to avoid duplication)
  const historyCards = history;

  return (
    <View style={styles.root}>
      <SafeAreaView edges={['top']} style={{ flex: 1 }}>
        <ScrollView
          showsVerticalScrollIndicator={false}
          contentContainerStyle={{ paddingBottom: 40 }}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={GREEN} />
          }
        >
          {/* ── HERO CARD ─────────────────────────────────────────────── */}
          <View style={styles.hero}>
            {/* Top row: avatar + info + month badge */}
            <View style={styles.heroTop}>
              <View style={styles.avatar}>
                <Text style={styles.avatarText}>{initials(user?.name ?? 'U')}</Text>
              </View>
              <View style={{ flex: 1, marginLeft: 12 }}>
                <Text style={styles.heroName}>{user?.name ?? 'Employee'}</Text>
                <Text style={styles.heroMeta}>
                  {user?.userId ?? '—'}  •  {user?.workType ?? 'Office'}
                </Text>
              </View>
              {latest && (
                <View style={styles.monthBadge}>
                  <Text style={styles.monthBadgeText}>
                    {MONTHS[latest.month]} {latest.year}
                  </Text>
                </View>
              )}
            </View>

            {/* Received pill */}
            <View style={styles.receivedPill}>
              <Ionicons name="checkmark-circle" size={14} color="#A5D6A7" />
              <Text style={styles.receivedText}>Overall Received {receivedPct}%</Text>
            </View>

            {/* Net pay */}
            <View style={styles.netPayRow}>
              <Text style={styles.netPayAmount}>{latest ? fmt(latest.netPay) : '—'}</Text>
              <Ionicons name="checkmark-circle" size={20} color="#69F0AE" style={{ marginLeft: 6, marginTop: 2 }} />
            </View>
            <Text style={styles.heroSub}>
              {latest
                ? `Payment made • 100% processed via ${latest.paidVia}`
                : 'No payslip data available'}
            </Text>
          </View>

          {/* ── EARNINGS BREAKDOWN ────────────────────────────────────── */}
          {latest && (
            <View style={styles.card}>
              <View style={styles.cardHeader}>
                <Text style={styles.cardTitle}>Earnings Breakdown</Text>
                <View style={styles.plusCircle}>
                  <Ionicons name="add" size={18} color={GREEN} />
                </View>
              </View>
              <View style={styles.divider} />
              <EarnRow label="Basic Salary"       amount={latest.earnings.basicSalary} />
              <EarnRow label="HRA Allowance"      amount={latest.earnings.hraAllowance} />
              {latest.earnings.performanceBonus > 0 && (
                <EarnRow label="Performance Bonus" amount={latest.earnings.performanceBonus} highlight />
              )}
              {latest.earnings.otherEarnings > 0 && (
                <EarnRow label="Other Earnings" amount={latest.earnings.otherEarnings} />
              )}
              <View style={styles.totalDivider} />
              <View style={styles.row}>
                <Text style={styles.totalLabel}>Total Gross</Text>
                <Text style={styles.totalValue}>{fmt(latest.totalGross)}</Text>
              </View>
            </View>
          )}

          {/* ── DEDUCTIONS ───────────────────────────────────────────── */}
          {latest && (
            <View style={styles.card}>
              <View style={styles.cardHeader}>
                <Text style={styles.cardTitle}>Deductions</Text>
                <View style={[styles.plusCircle, { borderColor: '#FFCDD2', backgroundColor: '#FFF5F5' }]}>
                  <Ionicons name="remove" size={18} color={RED} />
                </View>
              </View>
              <View style={styles.divider} />
              <DeductRow label="Income Tax (TDS)" amount={latest.deductions.incomeTax} />
              <DeductRow label="Provident Fund"   amount={latest.deductions.providentFund} />
              {latest.deductions.healthInsurance > 0 && (
                <DeductRow label="Health Insurance" amount={latest.deductions.healthInsurance} />
              )}
              {latest.deductions.lopDeduction > 0 && (
                <DeductRow label="Loss of Pay (LOP)" amount={latest.deductions.lopDeduction} />
              )}
              {latest.deductions.otherDeductions > 0 && (
                <DeductRow label="Other Deductions" amount={latest.deductions.otherDeductions} />
              )}
              <View style={styles.totalDivider} />
              <View style={styles.row}>
                <Text style={styles.totalLabel}>Total Deductions</Text>
                <Text style={[styles.totalValue, { color: RED }]}>{fmt(latest.totalDeductions)}</Text>
              </View>
            </View>
          )}

          {/* ── NET PAY SUMMARY ──────────────────────────────────────── */}
          {latest && (
            <View style={styles.netCard}>
              <View style={{ flex: 1 }}>
                <Text style={styles.netCardLabel}>Net Pay</Text>
                <Text style={styles.netCardSub}>{latest.monthLabel}</Text>
              </View>
              <Text style={styles.netCardAmount}>{fmt(latest.netPay)}</Text>
            </View>
          )}

          {/* ── PAYSLIP HISTORY ──────────────────────────────────────── */}
          <View style={styles.card}>
            <View style={styles.cardHeader}>
              <Text style={styles.cardTitle}>Payslip History</Text>
              {/* Year picker */}
              <TouchableOpacity
                style={styles.yearPicker}
                onPress={() => setYearPickerVisible(true)}
                activeOpacity={0.8}
              >
                <Text style={styles.yearPickerText}>{selectedYear}</Text>
                <Ionicons name="chevron-down" size={14} color="#555" style={{ marginLeft: 4 }} />
              </TouchableOpacity>
            </View>

            {historyCards.length === 0 ? (
              <Text style={styles.emptyText}>No payslips found for {selectedYear}</Text>
            ) : (
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                style={{ marginTop: 14 }}
                contentContainerStyle={{ paddingRight: 8 }}
              >
                {historyCards.map((p) => (
                  <TouchableOpacity
                    key={p._id}
                    style={styles.histCard}
                    activeOpacity={0.85}
                    onPress={() => Alert.alert(p.monthLabel, `Net Pay: ${fmt(p.netPay)}\nGross: ${fmt(p.totalGross)}\nDeductions: ${fmt(p.totalDeductions)}`)}
                  >
                    {/* top: doc icon + download */}
                    <View style={styles.histCardTop}>
                      <View style={styles.docIcon}>
                        <Ionicons name="document-text-outline" size={20} color={GREEN} />
                      </View>
                      <TouchableOpacity style={styles.downloadBtn} activeOpacity={0.8}>
                        <Ionicons name="download-outline" size={16} color={GREEN} />
                      </TouchableOpacity>
                    </View>
                    <Text style={styles.histMonth}>
                      {MONTHS[p.month].toUpperCase()} {p.year}
                    </Text>
                    <Text style={styles.histAmount}>{fmt(p.netPay)}</Text>
                    <View style={[styles.histStatus,
                      p.status === 'processed'
                        ? { backgroundColor: '#E8F5E9' }
                        : { backgroundColor: '#FFF9C4' }
                    ]}>
                      <Text style={[styles.histStatusText,
                        { color: p.status === 'processed' ? GREEN : AMBER }
                      ]}>
                        {p.status === 'processed' ? 'Paid' : 'Pending'}
                      </Text>
                    </View>
                  </TouchableOpacity>
                ))}
              </ScrollView>
            )}
          </View>
        </ScrollView>
      </SafeAreaView>

      {/* ── YEAR PICKER MODAL ────────────────────────────────────────── */}
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
                onPress={() => handleYearSelect(y)}
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

// ─── styles ──────────────────────────────────────────────────────────────────
const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: CREAM },

  centered: {
    flex: 1, alignItems: 'center', justifyContent: 'center',
    backgroundColor: CREAM, paddingHorizontal: 32,
  },
  loadingText: { marginTop: 12, color: '#777', fontSize: 14 },
  errorText:   { marginTop: 12, color: '#777', fontSize: 13, textAlign: 'center', lineHeight: 20 },
  retryBtn: {
    marginTop: 20, backgroundColor: GREEN,
    paddingHorizontal: 28, paddingVertical: 10, borderRadius: 24,
  },
  retryBtnText: { color: '#FFF', fontWeight: '700', fontSize: 14 },

  // ── Hero ──
  hero: {
    backgroundColor: GREEN,
    paddingHorizontal: 20,
    paddingTop: 20,
    paddingBottom: 28,
  },
  heroTop: { flexDirection: 'row', alignItems: 'center' },
  avatar: {
    width: 46, height: 46, borderRadius: 23,
    backgroundColor: 'rgba(255,255,255,0.25)',
    alignItems: 'center', justifyContent: 'center',
    borderWidth: 2, borderColor: 'rgba(255,255,255,0.6)',
  },
  avatarText: { color: '#FFF', fontWeight: '800', fontSize: 16 },
  heroName:   { color: '#FFF', fontWeight: '700', fontSize: 15 },
  heroMeta:   { color: 'rgba(255,255,255,0.75)', fontSize: 11, marginTop: 2 },
  monthBadge: {
    backgroundColor: 'rgba(255,255,255,0.2)',
    paddingHorizontal: 10, paddingVertical: 4,
    borderRadius: 20, borderWidth: 1, borderColor: 'rgba(255,255,255,0.35)',
  },
  monthBadgeText: { color: '#FFF', fontSize: 11, fontWeight: '600' },

  receivedPill: {
    flexDirection: 'row', alignItems: 'center',
    marginTop: 14, backgroundColor: 'rgba(0,0,0,0.15)',
    alignSelf: 'flex-start',
    paddingHorizontal: 10, paddingVertical: 4, borderRadius: 20,
  },
  receivedText: { color: '#A5D6A7', fontSize: 11, fontWeight: '600', marginLeft: 5 },

  netPayRow:    { flexDirection: 'row', alignItems: 'center', marginTop: 10 },
  netPayAmount: { color: '#FFF', fontSize: 34, fontWeight: '800', letterSpacing: -0.5 },
  heroSub:      { color: 'rgba(255,255,255,0.65)', fontSize: 11, marginTop: 6 },

  // ── Cards ──
  card: {
    backgroundColor: '#FFF',
    marginHorizontal: 16, marginTop: 14,
    borderRadius: 18,
    paddingHorizontal: 18, paddingVertical: 18,
    shadowColor: '#000', shadowOpacity: 0.06,
    shadowOffset: { width: 0, height: 3 }, shadowRadius: 10, elevation: 3,
  },
  cardHeader: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
  },
  cardTitle: { fontSize: 15, fontWeight: '700', color: '#111' },
  plusCircle: {
    width: 30, height: 30, borderRadius: 15,
    borderWidth: 1.5, borderColor: '#C8E6C9', backgroundColor: '#F1F8F1',
    alignItems: 'center', justifyContent: 'center',
  },
  divider:      { height: 1, backgroundColor: '#F0F0F0', marginVertical: 14 },
  totalDivider: { height: 1, backgroundColor: '#F0F0F0', marginVertical: 10 },

  row:        { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 10 },
  rowLabel:   { fontSize: 13, color: '#555' },
  rowValue:   { fontSize: 13, color: '#222', fontWeight: '500' },
  totalLabel: { fontSize: 14, fontWeight: '700', color: '#111' },
  totalValue: { fontSize: 14, fontWeight: '800', color: '#111' },

  // ── Net Pay summary card ──
  netCard: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: DARK_GREEN,
    marginHorizontal: 16, marginTop: 14,
    borderRadius: 18, paddingHorizontal: 20, paddingVertical: 18,
    shadowColor: DARK_GREEN, shadowOpacity: 0.3,
    shadowOffset: { width: 0, height: 4 }, shadowRadius: 10, elevation: 4,
  },
  netCardLabel:  { color: 'rgba(255,255,255,0.75)', fontSize: 12 },
  netCardSub:    { color: '#FFF', fontSize: 13, fontWeight: '600', marginTop: 2 },
  netCardAmount: { color: '#69F0AE', fontSize: 22, fontWeight: '800' },

  // ── History ──
  yearPicker: {
    flexDirection: 'row', alignItems: 'center',
    borderWidth: 1, borderColor: '#E0E0E0',
    borderRadius: 20, paddingHorizontal: 12, paddingVertical: 5,
    backgroundColor: '#FAFAFA',
  },
  yearPickerText: { fontSize: 13, fontWeight: '600', color: '#333' },
  emptyText: { textAlign: 'center', color: '#AAA', fontSize: 13, marginTop: 16, marginBottom: 6 },

  histCard: {
    backgroundColor: CREAM,
    borderRadius: 16, padding: 14,
    width: 140, marginRight: 12,
    borderWidth: 1, borderColor: '#EDE7D0',
  },
  histCardTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  docIcon: {
    width: 36, height: 36, borderRadius: 10,
    backgroundColor: '#E8F5E9', alignItems: 'center', justifyContent: 'center',
  },
  downloadBtn: {
    width: 30, height: 30, borderRadius: 8,
    backgroundColor: '#E8F5E9', alignItems: 'center', justifyContent: 'center',
  },
  histMonth:  { fontSize: 10, fontWeight: '700', color: '#888', marginTop: 12, letterSpacing: 0.5 },
  histAmount: { fontSize: 15, fontWeight: '800', color: '#111', marginTop: 4 },
  histStatus: {
    marginTop: 8, alignSelf: 'flex-start',
    paddingHorizontal: 8, paddingVertical: 3, borderRadius: 10,
  },
  histStatusText: { fontSize: 10, fontWeight: '700' },

  // ── Year modal ──
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
});
