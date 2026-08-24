/**
 * Shared UI kit for the Manager section. Keeps every manager screen
 * visually consistent with the rest of the ERM mobile app (green header,
 * white rounded cards, pill badges) without each screen re-declaring the
 * same style constants.
 */
import React from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ActivityIndicator,
  StatusBar,
  Platform,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';

export const MC = {
  green:      '#2E7D32',
  greenDark:  '#1F6A1E',
  primary:    '#4CAF50',
  bg:         '#F4F6F8',
  card:       '#FFFFFF',
  text:       '#1A1A1A',
  sub:        '#6B7280',
  border:     '#ECECEC',
  amber:      '#B7791F',
  amberBg:    '#FEF3C7',
  red:        '#DC2626',
  redBg:      '#FEE2E2',
  greenBg:    '#DCFCE7',
  blue:       '#2563EB',
  blueBg:     '#DBEAFE',
};

/** Green app-bar with a back chevron. */
export function ManagerHeader({
  title,
  subtitle,
  onBack,
  right,
}: {
  title: string;
  subtitle?: string;
  onBack?: () => void;
  right?: React.ReactNode;
}) {
  return (
    <View style={styles.header}>
      <StatusBar barStyle="light-content" backgroundColor={MC.green} />
      <TouchableOpacity
        onPress={() => (onBack ? onBack() : router.back())}
        hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
        style={styles.backBtn}
      >
        <Ionicons name="chevron-back" size={24} color="#fff" />
      </TouchableOpacity>
      <View style={{ flex: 1 }}>
        <Text style={styles.headerTitle} numberOfLines={1}>{title}</Text>
        {!!subtitle && <Text style={styles.headerSub} numberOfLines={1}>{subtitle}</Text>}
      </View>
      {right ? <View style={styles.headerRight}>{right}</View> : null}
    </View>
  );
}

/** White rounded card. */
export function Card({ children, style }: { children: React.ReactNode; style?: any }) {
  return <View style={[styles.card, style]}>{children}</View>;
}

/** Small coloured status pill. */
export function Pill({ label, tone = 'gray' }: { label: string; tone?: 'green' | 'amber' | 'red' | 'blue' | 'gray' }) {
  const map: any = {
    green: { bg: MC.greenBg, fg: MC.green },
    amber: { bg: MC.amberBg, fg: MC.amber },
    red:   { bg: MC.redBg,   fg: MC.red },
    blue:  { bg: MC.blueBg,  fg: MC.blue },
    gray:  { bg: '#F1F1F1',  fg: '#6B7280' },
  };
  const c = map[tone] || map.gray;
  return (
    <View style={[styles.pill, { backgroundColor: c.bg }]}>
      <Text style={[styles.pillText, { color: c.fg }]}>{label}</Text>
    </View>
  );
}

/** Map a status string to a pill tone. */
export function toneForStatus(s?: string): 'green' | 'amber' | 'red' | 'blue' | 'gray' {
  const v = String(s || '').toLowerCase();
  if (v.includes('approv')) return 'green';
  if (v.includes('reject')) return 'red';
  if (v.includes('pending') || v === '') return 'amber';
  return 'gray';
}

export function Loading({ label }: { label?: string }) {
  return (
    <View style={styles.center}>
      <ActivityIndicator color={MC.green} size="large" />
      {!!label && <Text style={styles.centerText}>{label}</Text>}
    </View>
  );
}

export function EmptyState({ icon = 'file-tray-outline', title, hint }: { icon?: any; title: string; hint?: string }) {
  return (
    <View style={styles.center}>
      <Ionicons name={icon} size={44} color="#C4C9CF" />
      <Text style={styles.emptyTitle}>{title}</Text>
      {!!hint && <Text style={styles.centerText}>{hint}</Text>}
    </View>
  );
}

/** Simple two/three-way segmented control. */
export function Segmented({
  options,
  value,
  onChange,
}: {
  options: { key: string; label: string }[];
  value: string;
  onChange: (k: string) => void;
}) {
  return (
    <View style={styles.segment}>
      {options.map((o) => {
        const active = o.key === value;
        return (
          <TouchableOpacity
            key={o.key}
            style={[styles.segItem, active && styles.segItemActive]}
            onPress={() => onChange(o.key)}
            activeOpacity={0.8}
          >
            <Text style={[styles.segText, active && styles.segTextActive]} numberOfLines={1}>{o.label}</Text>
          </TouchableOpacity>
        );
      })}
    </View>
  );
}

export const managerStyles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: MC.bg },
});

const styles = StyleSheet.create({
  header: {
    backgroundColor: MC.green,
    paddingTop: Platform.OS === 'android' ? (StatusBar.currentHeight || 24) + 8 : 52,
    paddingBottom: 16,
    paddingHorizontal: 12,
    flexDirection: 'row',
    alignItems: 'center',
  },
  backBtn: { padding: 4, marginRight: 4 },
  headerTitle: { color: '#fff', fontSize: 18, fontWeight: '800' },
  headerSub: { color: 'rgba(255,255,255,0.85)', fontSize: 12, marginTop: 2 },
  headerRight: { marginLeft: 8 },

  card: {
    backgroundColor: MC.card,
    borderRadius: 14,
    padding: 14,
    marginHorizontal: 14,
    marginTop: 12,
    shadowColor: '#000',
    shadowOpacity: 0.06,
    shadowOffset: { width: 0, height: 2 },
    shadowRadius: 8,
    elevation: 2,
  },

  pill: { paddingHorizontal: 10, paddingVertical: 3, borderRadius: 999, alignSelf: 'flex-start' },
  pillText: { fontSize: 11, fontWeight: '700' },

  center: { alignItems: 'center', justifyContent: 'center', paddingVertical: 48, paddingHorizontal: 24 },
  centerText: { color: MC.sub, fontSize: 13, marginTop: 8, textAlign: 'center' },
  emptyTitle: { color: MC.text, fontSize: 15, fontWeight: '700', marginTop: 12, textAlign: 'center' },

  segment: {
    flexDirection: 'row',
    backgroundColor: '#EAEDF0',
    borderRadius: 10,
    padding: 4,
    marginHorizontal: 14,
    marginTop: 12,
  },
  segItem: { flex: 1, paddingVertical: 8, borderRadius: 8, alignItems: 'center' },
  segItemActive: { backgroundColor: '#fff', shadowColor: '#000', shadowOpacity: 0.08, shadowRadius: 4, elevation: 1 },
  segText: { fontSize: 12.5, fontWeight: '600', color: MC.sub },
  segTextActive: { color: MC.green, fontWeight: '800' },
});
