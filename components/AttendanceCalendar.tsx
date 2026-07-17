import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { attendanceAPI } from '../services/api';

type Status = 'present' | 'leave' | 'permission' | 'absent' | '';

const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

// Status colours (light fills, with the day number tinted)
const STATUS_FILL: Record<string, string> = {
  present: '#C8F3C5',
  leave: '#FBC9C5',
  permission: '#FFE69A',
};

const STATUS_DOT: Record<string, string> = {
  present: '#4CAF50',
  leave: '#E96A66',
  permission: '#F4C242',
};

type Props = { refreshKey?: number };

export default function AttendanceCalendar({ refreshKey = 0 }: Props) {
  const [cursor, setCursor] = useState(new Date());
  const [data, setData] = useState<Record<string, Status>>({});
  // #440 — mounted guard: swiping away / unmounting during the cold-start
  // getMonthly() fetch must not setState on a torn-down component.
  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  const load = useCallback(async () => {
    try {
      const res = await attendanceAPI.getMonthly(
        cursor.getMonth() + 1,
        cursor.getFullYear()
      );
      const map: Record<string, Status> = {};
      (res.data || []).forEach((r: any) => {
        map[r.date] = r.status;
      });
      if (mountedRef.current) setData(map);
    } catch {
      if (mountedRef.current) setData({});
    }
  }, [cursor]);

  useEffect(() => {
    load();
  }, [load, refreshKey]);

  const year = cursor.getFullYear();
  const month = cursor.getMonth(); // 0-indexed
  const today = new Date();
  const isCurrentMonth =
    today.getFullYear() === year && today.getMonth() === month;
  const todayDay = today.getDate();

  // 1st day weekday (Mon = 0 ... Sun = 6)
  const firstDow = new Date(year, month, 1).getDay();
  const startOffset = firstDow === 0 ? 6 : firstDow - 1;
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const daysInPrevMonth = new Date(year, month, 0).getDate();

  // Build 6-row x 7-col grid
  const cells: { day: number; current: boolean; key: string }[] = [];
  // Trailing days of prev month
  for (let i = startOffset - 1; i >= 0; i--) {
    cells.push({
      day: daysInPrevMonth - i,
      current: false,
      key: `prev-${daysInPrevMonth - i}`,
    });
  }
  // Current month
  for (let d = 1; d <= daysInMonth; d++) {
    cells.push({ day: d, current: true, key: `cur-${d}` });
  }
  // Trailing days of next month to fill 42 cells
  let nextDay = 1;
  while (cells.length < 42) {
    cells.push({ day: nextDay, current: false, key: `next-${nextDay}` });
    nextDay++;
  }

  const pad = (n: number) => String(n).padStart(2, '0');
  const monthName = cursor.toLocaleString('default', { month: 'long' });

  // Block navigation to any month after the current one. The user can
  // freely walk backward through history but the forward chevron is
  // disabled once they reach the present month — there is no attendance
  // data to show for the future, and the calendar would otherwise let
  // them tap "September 2027" by accident.
  const canGoForward = !(
    cursor.getFullYear() > today.getFullYear() ||
    (cursor.getFullYear() === today.getFullYear() && cursor.getMonth() >= today.getMonth())
  );

  const changeMonth = (dir: number) => {
    if (dir > 0 && !canGoForward) return;
    const d = new Date(cursor);
    d.setMonth(d.getMonth() + dir);
    setCursor(d);
  };

  return (
    <View style={styles.card}>
      <View style={styles.header}>
        <Text style={styles.title}>
          {monthName} {year}
        </Text>
        <View style={styles.navRow}>
          <TouchableOpacity onPress={() => changeMonth(-1)} style={styles.navBtn}>
            <Ionicons name="chevron-back" size={18} color="#333" />
          </TouchableOpacity>
          <TouchableOpacity
            onPress={() => changeMonth(1)}
            style={styles.navBtn}
            disabled={!canGoForward}
          >
            <Ionicons
              name="chevron-forward"
              size={18}
              color={canGoForward ? '#333' : '#C9C9C9'}
            />
          </TouchableOpacity>
        </View>
      </View>

      <View style={styles.daysRow}>
        {DAYS.map(d => (
          <Text key={d} style={styles.dayLabel}>
            {d}
          </Text>
        ))}
      </View>

      <View style={styles.grid}>
        {cells.map(({ day, current, key }) => {
          const dateStr = current
            ? `${year}-${pad(month + 1)}-${pad(day)}`
            : '';
          const status = current ? data[dateStr] : '';
          const fill = status ? STATUS_FILL[status as Status] : '';
          const isToday = current && isCurrentMonth && day === todayDay;
          // A "future" day is any in-month day that hasn't happened yet.
          // We strip the status colour and dim the number so HR's "what
          // did I do on the 25th?" eye never lands on a tile that looks
          // like real data when it's actually empty.
          const isFuture =
            current &&
            (year > today.getFullYear() ||
              (year === today.getFullYear() && month > today.getMonth()) ||
              (isCurrentMonth && day > todayDay));

          return (
            <View key={key} style={styles.cell}>
              <View
                style={[
                  styles.dayCircle,
                  fill && !isFuture ? { backgroundColor: fill } : null,
                  isToday ? styles.todayCircle : null,
                ]}
              >
                <Text
                  style={[
                    styles.dayNum,
                    (!current || isFuture) && styles.dayNumDim,
                    isToday && styles.dayNumToday,
                  ]}
                >
                  {day}
                </Text>
              </View>
            </View>
          );
        })}
      </View>

      <View style={styles.legend}>
        <LegendItem color={STATUS_DOT.present} label="Present" />
        <LegendItem color={STATUS_DOT.leave} label="Leave" />
        <LegendItem color={STATUS_DOT.permission} label="Permission" />
      </View>
    </View>
  );
}

function LegendItem({ color, label }: { color: string; label: string }) {
  return (
    <View style={styles.legendItem}>
      <View style={[styles.legendDot, { backgroundColor: color }]} />
      <Text style={styles.legendText}>{label}</Text>
    </View>
  );
}

const CREAM = '#FFFBEE';

const styles = StyleSheet.create({
  card: {
    backgroundColor: CREAM,
    marginHorizontal: 16,
    marginTop: 14,
    borderRadius: 16,
    paddingHorizontal: 14,
    paddingVertical: 16,
    shadowColor: '#000',
    shadowOpacity: 0.05,
    shadowOffset: { width: 0, height: 2 },
    shadowRadius: 6,
    elevation: 2,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
  },
  title: { fontSize: 16, fontWeight: '700', color: '#111' },
  navRow: { flexDirection: 'row' },
  navBtn: {
    width: 28,
    height: 28,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    marginLeft: 4,
  },
  daysRow: {
    flexDirection: 'row',
    paddingHorizontal: 2,
    marginBottom: 6,
  },
  dayLabel: {
    flex: 1,
    textAlign: 'center',
    fontSize: 11,
    color: '#7A7A7A',
    fontWeight: '600',
  },
  grid: { flexDirection: 'row', flexWrap: 'wrap' },
  cell: {
    width: `${100 / 7}%`,
    alignItems: 'center',
    paddingVertical: 4,
  },
  dayCircle: {
    width: 34,
    height: 34,
    borderRadius: 17,
    justifyContent: 'center',
    alignItems: 'center',
  },
  todayCircle: {
    borderWidth: 2,
    borderColor: '#1B5E20',
    backgroundColor: '#C8F3C5',
  },
  dayNum: { fontSize: 13, color: '#1A1A1A', fontWeight: '500' },
  dayNumDim: { color: '#BFBFBF' },
  dayNumToday: { color: '#1B5E20', fontWeight: '700' },
  legend: {
    flexDirection: 'row',
    justifyContent: 'center',
    marginTop: 14,
  },
  legendItem: {
    flexDirection: 'row',
    alignItems: 'center',
    marginHorizontal: 12,
  },
  legendDot: {
    width: 9,
    height: 9,
    borderRadius: 5,
    marginRight: 6,
  },
  legendText: { fontSize: 12, color: '#5A5A5A' },
});
