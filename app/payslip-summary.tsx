import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
  ActivityIndicator,
  Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons, Feather } from '@expo/vector-icons';
import { router, useLocalSearchParams } from 'expo-router';
import { payslipAPI } from '../services/api';

const GREEN = '#4CAF50';
const RED   = '#E53935';
const ORANGE = '#FB8C00';

const MONTHS = [
  '', 'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

interface PayslipDetail {
  _id: string;
  month: number;
  year: number;
  monthLabel?: string;
  earnings: {
    basicSalary: number;
    hraAllowance: number;
    performanceBonus: number;
    otherEarnings: number;
    [k: string]: any;
  };
  deductions: {
    incomeTax: number;
    providentFund: number;
    healthInsurance: number;
    lopDeduction: number;
    otherDeductions: number;
    [k: string]: any;
  };
  totalGross: number;
  totalDeductions: number;
  netPay: number;
}

const fmtRupees = (n: number) =>
  '₹' + (n ?? 0).toLocaleString('en-IN');

export default function PayslipSummaryScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const [data, setData]       = useState<PayslipDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState('');

  useEffect(() => {
    if (!id) {
      setError('Missing payslip id');
      setLoading(false);
      return;
    }
    payslipAPI.getById(String(id))
      .then((r) => setData(r.data))
      .catch((e) => setError(e?.response?.data?.message || 'Could not load payslip'))
      .finally(() => setLoading(false));
  }, [id]);

  if (loading) {
    return (
      <SafeAreaView style={styles.safe}>
        <View style={styles.centered}>
          <ActivityIndicator color={GREEN} size="large" />
          <Text style={styles.muted}>Loading payslip…</Text>
        </View>
      </SafeAreaView>
    );
  }

  if (error || !data) {
    return (
      <SafeAreaView style={styles.safe}>
        <View style={styles.centered}>
          <Ionicons name="cloud-offline-outline" size={48} color="#CCC" />
          <Text style={styles.muted}>{error || 'Payslip not found.'}</Text>
          <TouchableOpacity style={styles.retryBtn} onPress={() => router.back()}>
            <Text style={styles.retryBtnText}>Go back</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  const earningsTotal   = data.totalGross || 0;
  const deductionsTotal = data.totalDeductions || 0;

  return (
    <SafeAreaView edges={['top']} style={styles.safe}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity
          style={styles.backBtn}
          onPress={() => router.back()}
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
        >
          <Ionicons name="arrow-back" size={22} color="#1A1A1A" />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Payslip Summary</Text>
        <View style={{ width: 32 }} />
      </View>

      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ paddingBottom: 32 }}
      >
        {/* Donut chart */}
        <View style={styles.donutWrap}>
          <Donut
            earnings={earningsTotal}
            deductions={deductionsTotal}
            label="Gross Pay"
          />
        </View>

        {/* Earnings / Deductions row */}
        <View style={styles.totalsRow}>
          <View style={styles.totalItem}>
            <View style={[styles.totalDot, { backgroundColor: GREEN }]} />
            <View>
              <Text style={styles.totalAmount}>{fmtRupees(earningsTotal)}</Text>
              <Text style={styles.totalLabel}>Earnings</Text>
            </View>
          </View>
          <View style={styles.totalItem}>
            <View style={[styles.totalDot, { backgroundColor: RED }]} />
            <View>
              <Text style={styles.totalAmount}>{fmtRupees(deductionsTotal)}</Text>
              <Text style={styles.totalLabel}>Deductions</Text>
            </View>
          </View>
        </View>

        {/* Earning Details */}
        <Text style={styles.sectionHeading}>Earning Details</Text>
        <View style={styles.detailCard}>
          <DetailRow label="Basic"                 value={data.earnings.basicSalary} />
          <DetailRow label="House Rent Allowance"  value={data.earnings.hraAllowance} />
          <DetailRow label="Conveyance Allowance"  value={data.earnings.performanceBonus} />
          <DetailRow label="Earned Leave"          value={data.earnings.otherEarnings} last />
        </View>

        {/* Deductions */}
        <Text style={styles.sectionHeading}>Deductions</Text>
        <View style={styles.detailCard}>
          <DetailRow label="EPF"              value={data.deductions.providentFund} />
          <DetailRow label="Professional Tax" value={data.deductions.incomeTax} />
          <DetailRow label="PF"               value={data.deductions.healthInsurance} last />
        </View>

        {/* Action buttons */}
        <View style={styles.actionsRow}>
          <TouchableOpacity
            style={[styles.actionBtn, { backgroundColor: ORANGE }]}
            activeOpacity={0.85}
            onPress={() =>
              Alert.alert(
                'Request',
                'Your request to HR has been queued. (Workflow to be wired by your admin.)'
              )
            }
          >
            <Feather name="message-square" size={16} color="#FFFFFF" />
            <Text style={styles.actionText}>Request</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.actionBtn, { backgroundColor: GREEN }]}
            activeOpacity={0.85}
            onPress={() =>
              Alert.alert(
                'Download',
                'PDF download will be available once HR enables it.'
              )
            }
          >
            <Feather name="download" size={16} color="#FFFFFF" />
            <Text style={styles.actionText}>Download</Text>
          </TouchableOpacity>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

/* ─── DonutChart (no SVG dependency) ─────────────────────────────────────────
   Built from layered Views. The base ring is drawn in the EARNINGS colour
   (green), then a "wedge" of the DEDUCTIONS colour (red) is overlaid on top
   using rotation + overflow:hidden. The proportions follow the actual
   earnings/deductions split so the chart is visually accurate.
   ─────────────────────────────────────────────────────────────────────────── */
function Donut({
  earnings, deductions, label,
}: {
  earnings: number;
  deductions: number;
  label: string;
}) {
  const SIZE = 200;
  const STROKE = 16;

  const total       = earnings + deductions;
  const deductionPct = total > 0 ? deductions / total : 0;
  const deductionDeg = deductionPct * 360;

  // The deductions wedge is rendered as two half-circles (each half covers
  // up to 180°). We rotate them around the centre to draw any arc 0..360°.
  // First half covers 0..180°, second covers 180..360°.
  const firstHalf  = Math.min(deductionDeg, 180);
  const secondHalf = Math.max(0, deductionDeg - 180);

  return (
    <View style={{ width: SIZE, height: SIZE, alignItems: 'center', justifyContent: 'center' }}>
      {/* Base ring — earnings colour */}
      <View
        style={{
          position: 'absolute',
          width: SIZE, height: SIZE,
          borderRadius: SIZE / 2,
          borderWidth: STROKE,
          borderColor: GREEN,
        }}
      />

      {/* Deductions wedge — drawn on top of the green ring */}
      {deductionDeg > 0 && (
        <View
          style={{
            position: 'absolute',
            width: SIZE, height: SIZE,
            // The wedge "starts" at the top (12 o'clock) and spans
            // clockwise for `deductionDeg` degrees.
            transform: [{ rotate: '-90deg' }],
          }}
        >
          <HalfCircle size={SIZE} stroke={STROKE} color={RED} angle={firstHalf}  startAt={0}   />
          <HalfCircle size={SIZE} stroke={STROKE} color={RED} angle={secondHalf} startAt={180} />
        </View>
      )}

      {/* Centre label */}
      <View style={{ alignItems: 'center' }}>
        <Text style={styles.donutAmount}>{fmtRupees(earnings)}</Text>
        <Text style={styles.donutLabel}>{label}</Text>
      </View>
    </View>
  );
}

/**
 * Half-ring of `color` spanning `angle` degrees (0..180), starting from
 * `startAt` degrees (0 = top-right semicircle, 180 = bottom-left semicircle).
 * Implemented by clipping a full circular ring to one half using
 * overflow:hidden, then rotating it.
 */
function HalfCircle({
  size, stroke, color, angle, startAt,
}: { size: number; stroke: number; color: string; angle: number; startAt: number }) {
  if (angle <= 0) return null;
  const HALF = size / 2;

  return (
    <View
      style={{
        position: 'absolute',
        width: HALF, height: size,
        left: startAt === 0 ? HALF : 0,
        top: 0,
        overflow: 'hidden',
        transform: [{ rotate: `${startAt}deg` }],
        transformOrigin: startAt === 0 ? 'left center' : 'right center',
      }}
    >
      <View
        style={{
          position: 'absolute',
          width: size,
          height: size,
          left: startAt === 0 ? -HALF : 0,
          top: 0,
          borderRadius: HALF,
          borderWidth: stroke,
          borderColor: color,
          // Rotate so that the visible arc covers `angle` degrees of the
          // half-circle, starting from the inside edge.
          transform: [{ rotate: `${angle - 180}deg` }],
          transformOrigin: startAt === 0 ? 'left center' : 'right center',
        }}
      />
    </View>
  );
}

function DetailRow({
  label, value, last,
}: { label: string; value: number; last?: boolean }) {
  return (
    <View style={[styles.detailRow, last && { borderBottomWidth: 0 }]}>
      <Text style={styles.detailLabel}>{label}</Text>
      <Text style={styles.detailValue}>{fmtRupees(value || 0)}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#FFFFFF' },

  centered: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 32 },
  muted:    { color: '#777', fontSize: 13, marginTop: 12, textAlign: 'center' },
  retryBtn: {
    marginTop: 20, backgroundColor: GREEN,
    paddingHorizontal: 28, paddingVertical: 10, borderRadius: 24,
  },
  retryBtnText: { color: '#FFF', fontWeight: '700', fontSize: 14 },

  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 14,
    paddingTop: 4,
    paddingBottom: 10,
  },
  backBtn: { width: 32, height: 32, alignItems: 'center', justifyContent: 'center' },
  headerTitle: { flex: 1, textAlign: 'center', fontSize: 15, fontWeight: '700', color: '#1A1A1A' },

  donutWrap: { alignItems: 'center', justifyContent: 'center', marginTop: 24, marginBottom: 14 },
  donutAmount: { fontSize: 22, fontWeight: '800', color: '#1A1A1A' },
  donutLabel:  { fontSize: 12.5, color: '#7A7A7A', marginTop: 4 },

  totalsRow: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    paddingHorizontal: 18,
    marginTop: 8,
    marginBottom: 18,
  },
  totalItem: { flexDirection: 'row', alignItems: 'center' },
  totalDot:  { width: 10, height: 10, borderRadius: 5, marginRight: 8 },
  totalAmount: { fontSize: 15, fontWeight: '800', color: '#1A1A1A' },
  totalLabel:  { fontSize: 11.5, color: '#7A7A7A', marginTop: 2 },

  sectionHeading: {
    fontSize: 14,
    fontWeight: '700',
    color: '#1A1A1A',
    marginHorizontal: 18,
    marginTop: 18,
    marginBottom: 10,
  },
  detailCard: {
    backgroundColor: '#FFFFFF',
    marginHorizontal: 18,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#EEEEEE',
    paddingHorizontal: 14,
    paddingVertical: 4,
  },
  detailRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#F2F2F2',
  },
  detailLabel: { fontSize: 13, color: '#5A5A5A' },
  detailValue: { fontSize: 13, color: '#1A1A1A', fontWeight: '600' },

  actionsRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingHorizontal: 18,
    marginTop: 24,
  },
  actionBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 13,
    borderRadius: 26,
    marginHorizontal: 6,
    shadowColor: '#000',
    shadowOpacity: 0.15,
    shadowOffset: { width: 0, height: 4 },
    shadowRadius: 8,
    elevation: 4,
  },
  actionText: { color: '#FFFFFF', fontWeight: '700', fontSize: 14, marginLeft: 8 },
});
