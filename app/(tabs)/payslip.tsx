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
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons, Feather } from '@expo/vector-icons';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { router } from 'expo-router';
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
  status?: string;
}

export default function PayslipScreen() {
  const [user, setUser]                   = useState<any>(null);
  const [history, setHistory]             = useState<Payslip[]>([]);
  const [loading, setLoading]             = useState(true);
  const [refreshing, setRefreshing]       = useState(false);
  const [error, setError]                 = useState('');
  const [selectedYear, setSelectedYear]   = useState(new Date().getFullYear());
  const [yearPickerVisible, setYearPickerVisible] = useState(false);

  const availableYears = [
    new Date().getFullYear(),
    new Date().getFullYear() - 1,
    new Date().getFullYear() - 2,
  ];

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
                const palette = ICON_PALETTE[idx % ICON_PALETTE.length];
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
                        <Text style={styles.payAmount}>{fmtRupees(p.netPay)}</Text>
                      </View>
                      <View style={[styles.payRow, { marginTop: 4 }]}>
                        <Text style={styles.payDates}>{fmtDateRange(p.year, p.month)}</Text>
                        <TouchableOpacity
                          onPress={(e) => {
                            e.stopPropagation?.();
                            Alert.alert(
                              'Download',
                              'PDF download will be available once HR enables it.'
                            );
                          }}
                          hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
                        >
                          <Feather name="download" size={16} color="#777" />
                        </TouchableOpacity>
                      </View>
                    </View>
                  </TouchableOpacity>
                );
              })}
            </ScrollView>
          )}
        </View>

      </SafeAreaView>

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
});
