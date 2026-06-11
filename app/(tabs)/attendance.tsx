import React, { useState, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
  Alert,
  Modal,
  TextInput,
  Pressable,
  ActivityIndicator,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { attendanceAPI } from '../../services/api';
import SuccessModal from '../../components/SuccessModal';

type Status = 'present' | 'absent' | 'permission' | 'late' | 'halfday' | 'leave' | '';

type CalendarItem = {
  date: string;
  status: Status;
  checkIn?: string | null;
  checkOut?: string | null;
  workedHours?: number;
};

type Summary = {
  present: number;
  absent: number;
  late: number;
  permission: number;
  halfday: number;
  leave: number;
  leavePolicy?: LeavePolicy;
};

type LeavePolicy = {
  month: number;
  year: number;
  policy: {
    monthlyLeaveAllowed: number;
    monthlyPermissionAllowed: number;
    maxPermissionHours: number;
    hoursPerLopDay: number;
  };
  usage: {
    leaveUsedDays: number;
    permissionsUsed: number;
    permissionHoursUsed: number;
    permissionExcessHours: number;
  };
  balance: {
    leaveRemainingDays: number;
    permissionsRemaining: number;
  };
  lop: {
    fromExtraLeaveDays: number;
    fromExtraPermissions: number;
    fromPermissionExcessHours: number;
    totalDays: number;
  };
};

type HistoryItem = {
  _id: string;
  date: string;
  status: Status;
  checkIn?: string | null;
  checkOut?: string | null;
  workedHours?: number;
  shift?: string;
};

const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

// One canonical colour per status — used by legend + as the base for
// multi-colour day dots below.
const STATUS_DOT: Record<string, string> = {
  present:    '#4CAF50', // green
  absent:     '#F44336', // red
  permission: '#F9C846', // yellow
  late:       '#FF9800', // orange
  halfday:    '#9C27B0', // purple
  leave:      '#E96A66', // coral
};

/**
 * Return the list of dots to render for a given day status. A "late" day
 * is both "late" AND "present" (the employee did show up), so it shows
 * BOTH the present (green) and late (orange) dots side by side. Same for
 * halfday: green + purple, because they did come in, just for half a day.
 */
function dotsForStatus(status: string | undefined): string[] {
  switch (status) {
    case 'present':    return [STATUS_DOT.present];
    case 'late':       return [STATUS_DOT.present, STATUS_DOT.late];
    case 'halfday':    return [STATUS_DOT.present, STATUS_DOT.halfday];
    case 'permission': return [STATUS_DOT.permission];
    case 'leave':      return [STATUS_DOT.leave];
    case 'absent':     return [STATUS_DOT.absent];
    default:           return [];
  }
}

const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

// Mirror of backend REQUEST_WINDOW_DAYS — employees can only file a
// regularisation request within this many days of the missed date.
const REQUEST_WINDOW_DAYS = 2;

function daysBetweenTodayAnd(dateStr: string): number {
  try {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const d = new Date(dateStr + 'T00:00:00');
    if (isNaN(d.getTime())) return Number.POSITIVE_INFINITY;
    return Math.floor((today.getTime() - d.getTime()) / 86400000);
  } catch {
    return Number.POSITIVE_INFINITY;
  }
}

export default function AttendanceScreen() {
  // Bottom inset = gesture/navigation-bar height. We push every modal
  // sheet up by this amount so the Submit button never sits under
  // the system pill on Android phones with gesture navigation.
  const insets = useSafeAreaInsets();
  const [cursor, setCursor] = useState(new Date());
  const [calendar, setCalendar] = useState<Record<string, CalendarItem>>({});
  const [summary, setSummary] = useState<Summary>({
    present: 0, absent: 0, late: 0, permission: 0, halfday: 0, leave: 0,
  });
  const [leavePolicy, setLeavePolicy] = useState<LeavePolicy | null>(null);
  const [history, setHistory] = useState<HistoryItem[]>([]);
  const [showMonthPicker, setShowMonthPicker] = useState(false);
  const [showYearPicker, setShowYearPicker] = useState(false);
  const [reqModalDate, setReqModalDate] = useState<string | null>(null);
  const [reqReason, setReqReason] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [success, setSuccess] = useState<{ title: string; body: string } | null>(null);
  // Dates the employee has already filed an attendance request for —
  // stored as a Map<YYYY-MM-DD, 'pending'|'approved'|'rejected'>. Drives
  // the per-row button label so it tracks the request lifecycle:
  //   pending  → "Requested"
  //   approved → "Approved"
  //   rejected → "Rejected"
  // Rejected/expired don't lock the button — the employee can file
  // again if HR rejected (something they typed wrong, say).
  // Refreshed on mount + every time a new request is saved.
  const [requestedDates, setRequestedDates] = useState<Map<string, string>>(new Map());
  const refreshRequestedDates = useCallback(async () => {
    try {
      const r = await attendanceAPI.listRequests();
      const items = Array.isArray(r.data) ? r.data : [];
      const next = new Map<string, string>();
      for (const x of items) {
        const date   = x?.date;
        const status = String(x?.status || '').toLowerCase();
        if (!date) continue;
        // For each date, keep the most recent NON-rejected status if one
        // exists (pending > approved). A rejected row alone we still
        // record so the button shows "Rejected" until they re-file.
        if (status === 'pending' || status === 'approved' || status === 'rejected') {
          const existing = next.get(date);
          if (!existing || existing === 'rejected') next.set(date, status);
        }
      }
      setRequestedDates(next);
    } catch { /* leave previous value */ }
  }, []);
  useEffect(() => { refreshRequestedDates(); }, [refreshRequestedDates]);

  const month = cursor.getMonth() + 1;
  const year = cursor.getFullYear();

  const loadAll = useCallback(async () => {
    try {
      const [calRes, sumRes, histRes] = await Promise.all([
        attendanceAPI.getCalendar(month, year),
        attendanceAPI.getSummary(month, year),
        attendanceAPI.getHistory(month, year),
      ]);
      const map: Record<string, CalendarItem> = {};
      (calRes.data || []).forEach((r: CalendarItem) => {
        map[r.date] = r;
      });
      setCalendar(map);
      setSummary({
        present: sumRes.data?.present || 0,
        absent: sumRes.data?.absent || 0,
        late: sumRes.data?.late || 0,
        permission: sumRes.data?.permission || 0,
        halfday: sumRes.data?.halfday || 0,
        leave: sumRes.data?.leave || 0,
      });
      setLeavePolicy(sumRes.data?.leavePolicy || null);
      setHistory(Array.isArray(histRes.data) ? histRes.data : []);
    } catch {
      setCalendar({});
      setHistory([]);
      setLeavePolicy(null);
    }
  }, [month, year]);

  useEffect(() => {
    loadAll();
  }, [loadAll]);

  const changeMonth = (dir: number) => {
    // Block forward navigation past the current calendar month AND
    // backward navigation below June 2026 (the app's go-live month).
    const d = new Date(cursor);
    d.setMonth(d.getMonth() + dir);
    const _today = new Date();
    // Future cap
    if (
      d.getFullYear() > _today.getFullYear() ||
      (d.getFullYear() === _today.getFullYear() && d.getMonth() > _today.getMonth())
    ) {
      return;
    }
    // Historical floor — app launched June 2026
    if (
      d.getFullYear() < 2026 ||
      (d.getFullYear() === 2026 && d.getMonth() < 5)
    ) {
      return;
    }
    setCursor(d);
  };

  // Build a Mon–Sun calendar grid that shows ONLY the selected month's
  // dates (Jun 2026 — HR request).
  //
  // What used to happen: the grid filled out to a fixed 42-cell box
  // with greyed-out trailing dates from the next month (e.g. July
  // 1–12 below June 30). HR found this confusing — employees would
  // tap on "Jul 3" while looking at June and wonder why nothing
  // happened. Now:
  //   • Leading offset cells (before day 1) are EMPTY placeholders
  //     so the first day still falls in the correct weekday column.
  //   • The grid STOPS at the last day of the current month — no
  //     trailing next-month dates at all.
  //   • Height varies between 4 and 6 rows depending on the month.
  const today = new Date();
  const isCurrentMonth =
    today.getFullYear() === year && today.getMonth() + 1 === month;
  const firstDow = new Date(year, month - 1, 1).getDay();
  const startOffset = firstDow === 0 ? 6 : firstDow - 1;
  const daysInMonth = new Date(year, month, 0).getDate();

  const cells: { day: number; current: boolean; key: string }[] = [];
  // Leading empty placeholders — rendered blank (day=0, current=false).
  // We give them unique keys so React can diff cleanly when month changes.
  for (let i = 0; i < startOffset; i++) {
    cells.push({ day: 0, current: false, key: `lead-${i}` });
  }
  // Current month days.
  for (let d = 1; d <= daysInMonth; d++) {
    cells.push({ day: d, current: true, key: `c-${d}` });
  }
  // Pad the final row with empty placeholders so the last row of cells
  // is still 7-wide (otherwise the trailing cells stretch when flex
  // distributes them). This is the ONLY trailing padding — it's empty
  // (day=0), not greyed-out next-month dates.
  while (cells.length % 7 !== 0) {
    cells.push({ day: 0, current: false, key: `trail-${cells.length}` });
  }

  const pad = (n: number) => String(n).padStart(2, '0');

  const formatTime = (iso?: string | null) => {
    if (!iso) return '--:--';
    try {
      const d = new Date(iso);
      const hrs = d.getHours();
      const min = d.getMinutes();
      const ampm = hrs >= 12 ? 'PM' : 'AM';
      const h = hrs % 12 === 0 ? 12 : hrs % 12;
      return `${pad(h)}:${pad(min)} ${ampm}`;
    } catch {
      return '--:--';
    }
  };

  const formatWorked = (hrs?: number) => {
    if (!hrs || hrs <= 0) return '00:00';
    const h = Math.floor(hrs);
    const m = Math.round((hrs - h) * 60);
    return `${pad(h)}:${pad(m)}`;
  };

  const formatHistoryDate = (s: string) => {
    try {
      const d = new Date(s + 'T00:00:00');
      const weekday = d.toLocaleString('default', { weekday: 'short' });
      const monthShort = d.toLocaleString('default', { month: 'short' });
      return `${weekday} ${monthShort} ${d.getDate()} ${d.getFullYear()}`;
    } catch {
      return s;
    }
  };

  // Request window closes 2 days after the attendance date — matches the
  // backend sweeper that auto-expires anything still pending after the
  // same window. Block the submit + show a clear closed-window alert.
  const REQUEST_WINDOW_DAYS = 2;
  const isRequestWindowClosed = (dateIso: string | null): boolean => {
    if (!dateIso) return false;
    const target = new Date(dateIso + 'T00:00:00');
    if (isNaN(target.getTime())) return false;
    const cutoff = Date.now() - REQUEST_WINDOW_DAYS * 24 * 60 * 60 * 1000;
    return target.getTime() < cutoff;
  };

  const submitRequest = async () => {
    if (!reqModalDate) return;
    if (isRequestWindowClosed(reqModalDate)) {
      const target = new Date(reqModalDate + 'T00:00:00');
      const daysAgo = Math.floor((Date.now() - target.getTime()) / 86400000);
      Alert.alert(
        'Request window closed',
        `Regularization requests can only be filed within 2 days of the attendance date. This date is ${daysAgo} days ago.`
      );
      return;
    }
    setSubmitting(true);
    try {
      await attendanceAPI.createRequest({
        date: reqModalDate,
        requestType: 'regularize',
        reason: reqReason || 'Attendance regularisation',
      });
      // Optimistic UI update so the button flips to "Requested" the
      // moment the API returns success. We also re-fetch in the
      // background so the canonical server state (including any later
      // approve/reject from manager or HR) catches up.
      setRequestedDates((prev) => {
        const next = new Map(prev);
        next.set(reqModalDate, 'pending');
        return next;
      });
      refreshRequestedDates();
      setSuccess({
        title: 'Request Submitted',
        body: 'Your attendance regularisation request was sent to HR and your manager. You\'ll be notified once it\'s reviewed.',
      });
      setReqModalDate(null);
      setReqReason('');
    } catch (err: any) {
      Alert.alert(
        'Error',
        err?.response?.data?.message || 'Could not submit request'
      );
    } finally {
      setSubmitting(false);
    }
  };

  // The app went live for employees in June 2026 — there is no
  // attendance history before that. Floor the year picker at 2026
  // and (further down) the month picker at June for the 2026 year.
  const YEAR_FLOOR  = 2026;
  const MONTH_FLOOR = 5; // June (0-indexed)
  const years = (() => {
    const top = today.getFullYear();
    const out: number[] = [];
    for (let y = YEAR_FLOOR; y <= top; y++) out.push(y);
    return out;
  })();

  // Whether the in-page Next / Previous chevrons should be tappable.
  // canGoForward becomes false once the cursor lands on (or after) the
  // current month so the user can't walk into "August 2026" when today
  // is June 2026.
  const canGoForward = !(
    year > today.getFullYear() ||
    (year === today.getFullYear() && month - 1 >= today.getMonth())
  );

  return (
    <SafeAreaView edges={['top']} style={styles.safe}>
      <ScrollView
        contentContainerStyle={{ paddingBottom: 100 }}
        showsVerticalScrollIndicator={false}
      >
        {/* ============ SECTION 1: CALENDAR ============ */}
        <Text style={styles.pageTitle}>Attendance</Text>

        <View style={styles.calendarCard}>
          <View style={styles.calHeader}>
            <Text style={styles.calMonth}>
              {MONTHS[month - 1]} {year}
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
            {DAYS.map((d) => (
              <Text key={d} style={styles.dayLabel}>{d}</Text>
            ))}
          </View>

          <View style={styles.grid}>
            {cells.map(({ day, current, key }) => {
              // Empty placeholder cell (leading offset or trailing
              // padding to complete the final row). Render an empty
              // <View> so the grid stays a perfect 7-column track.
              if (!current || day === 0) {
                return <View key={key} style={styles.cell} />;
              }
              const dateStr = `${year}-${pad(month)}-${pad(day)}`;
              const item = calendar[dateStr];
              let status = item?.status;
              const isToday =
                isCurrentMonth && day === today.getDate();
              // A future in-month day — dim it and suppress status dots
              // so the calendar reads as "this hasn't happened yet"
              // instead of "absent".
              const isFuture =
                year > today.getFullYear() ||
                (year === today.getFullYear() && month - 1 > today.getMonth()) ||
                (isCurrentMonth && day > today.getDate());

              // If a past weekday has no attendance record at all, the
              // backend's overnight cron hasn't run yet (or the record
              // was never created). Display it as absent so HR's "why
              // is the calendar empty?" question goes away. We skip
              // Sundays (weekly off) and don't override anything the
              // backend already said.
              const cellDate = new Date(year, month - 1, day);
              const isPastWeekday =
                !isFuture &&
                !isToday &&
                cellDate.getDay() !== 0; // 0 = Sunday
              if (isPastWeekday && (!status || status === '')) {
                status = 'absent';
              }

              return (
                <View key={key} style={styles.cell}>
                  <View
                    style={[
                      styles.dayCircle,
                      isToday && styles.todayCircle,
                    ]}
                  >
                    <Text
                      style={[
                        styles.dayNum,
                        isFuture && styles.dayNumDim,
                        isToday && styles.dayNumToday,
                      ]}
                    >
                      {day}
                    </Text>
                  </View>
                  <View style={styles.dotRow}>
                    {(() => {
                      if (isFuture) {
                        return <View style={styles.statusDotPlaceholder} />;
                      }
                      const dots = dotsForStatus(status);
                      if (dots.length === 0) {
                        return <View style={styles.statusDotPlaceholder} />;
                      }
                      return dots.map((c, i) => (
                        <View
                          key={i}
                          style={[
                            styles.statusDot,
                            { backgroundColor: c, marginHorizontal: 1 },
                          ]}
                        />
                      ));
                    })()}
                  </View>
                </View>
              );
            })}
          </View>

          <View style={styles.legendRow}>
            <LegendItem color={STATUS_DOT.present} label="Present" />
            <LegendItem color={STATUS_DOT.absent} label="Absent" />
            <LegendItem color={STATUS_DOT.permission} label="Permission" />
          </View>
          <View style={[styles.legendRow, { marginTop: 6 }]}>
            <LegendItem color={STATUS_DOT.late} label="Late" />
            <LegendItem color={STATUS_DOT.halfday} label="Half day" />
            <LegendItem color={STATUS_DOT.leave} label="Leave" />
          </View>
          <Text style={styles.legendHint}>
            Late & half-day show two dots — present + the second status.
          </Text>
        </View>

        {/* ============ SECTION 2: STAT CARDS ============ */}
        <View style={styles.summaryHeader}>
          <Text style={styles.summaryTitle}>Attendance</Text>
          <View style={styles.pickerRow}>
            <TouchableOpacity
              style={styles.picker}
              onPress={() => setShowMonthPicker(true)}
            >
              <Text style={styles.pickerText}>{MONTHS[month - 1].slice(0, 3)}</Text>
              <Ionicons name="chevron-down" size={14} color="#333" />
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.picker}
              onPress={() => setShowYearPicker(true)}
            >
              <Text style={styles.pickerText}>{year}</Text>
              <Ionicons name="chevron-down" size={14} color="#333" />
            </TouchableOpacity>
          </View>
        </View>

        {/* Box counts:
            PRESENT  = pure present + late + halfday   (anyone who showed up)
            ABSENTS  = backend's absent count (workdays − all others)
            LATE IN  = pure late count
            PERMISSIONS = permission count
            Late and halfday days are also counted in PRESENT because the
            employee did actually attend — they just came late or for half. */}
        <View style={styles.statsGrid}>
          {/* Row 1 — Present + Absents side by side */}
          <View style={styles.statsRow}>
            <StatCard
              color="#4CAF50"
              label="PRESENT"
              value={summary.present + summary.late + summary.halfday}
            />
            <StatCard color="#F44336" label="ABSENTS" value={summary.absent} />
          </View>
          {/* Row 2 — Late In + Permissions side by side */}
          <View style={styles.statsRow}>
            <StatCard color="#FFA726" label="LATE IN" value={summary.late} />
            <StatCard color="#2196F3" label="PERMISSIONS" value={summary.permission} />
          </View>
        </View>

        {/* ============ SECTION 2b: LEAVE POLICY / LOP CARD ============ */}
        {leavePolicy && (
          <View style={styles.policyCard}>
            <View style={styles.policyHeader}>
              <Text style={styles.policyTitle}>Leave Policy — This Month</Text>
              {leavePolicy.lop.totalDays > 0 ? (
                <View style={styles.lopBadge}>
                  <Text style={styles.lopBadgeText}>
                    {leavePolicy.lop.totalDays} day{leavePolicy.lop.totalDays === 1 ? '' : 's'} LOP
                  </Text>
                </View>
              ) : (
                <View style={[styles.lopBadge, { backgroundColor: '#E8F5E9' }]}>
                  <Text style={[styles.lopBadgeText, { color: '#1B5E20' }]}>No LOP ✓</Text>
                </View>
              )}
            </View>

            {/* Leave row */}
            <View style={styles.policyRow}>
              <View style={styles.policyCol}>
                <Text style={styles.policyLabel}>Leave used</Text>
                <Text style={styles.policyValue}>
                  {leavePolicy.usage.leaveUsedDays} / {leavePolicy.policy.monthlyLeaveAllowed} day
                </Text>
              </View>
              <View style={styles.policyCol}>
                <Text style={styles.policyLabel}>Leave LOP</Text>
                <Text style={[styles.policyValue, leavePolicy.lop.fromExtraLeaveDays > 0 && styles.lopValue]}>
                  {leavePolicy.lop.fromExtraLeaveDays} day{leavePolicy.lop.fromExtraLeaveDays === 1 ? '' : 's'}
                </Text>
              </View>
            </View>

            <View style={styles.policyDivider} />

            {/* Permission row */}
            <View style={styles.policyRow}>
              <View style={styles.policyCol}>
                <Text style={styles.policyLabel}>Permissions used</Text>
                <Text style={styles.policyValue}>
                  {leavePolicy.usage.permissionsUsed} / {leavePolicy.policy.monthlyPermissionAllowed}
                </Text>
              </View>
              <View style={styles.policyCol}>
                <Text style={styles.policyLabel}>Hours used</Text>
                <Text style={styles.policyValue}>
                  {leavePolicy.usage.permissionHoursUsed} hr
                  {leavePolicy.usage.permissionExcessHours > 0 && (
                    <Text style={styles.lopHint}>  (+{leavePolicy.usage.permissionExcessHours} extra)</Text>
                  )}
                </Text>
              </View>
            </View>

            <View style={styles.policyDivider} />

            {/* LOP breakdown */}
            <View style={styles.policyRow}>
              <View style={styles.policyCol}>
                <Text style={styles.policyLabel}>Permission LOP</Text>
                <Text style={[styles.policyValue,
                  (leavePolicy.lop.fromExtraPermissions + leavePolicy.lop.fromPermissionExcessHours) > 0
                    && styles.lopValue]}>
                  {Math.round((leavePolicy.lop.fromExtraPermissions + leavePolicy.lop.fromPermissionExcessHours) * 100) / 100} day
                </Text>
              </View>
              <View style={styles.policyCol}>
                <Text style={styles.policyLabel}>Total LOP</Text>
                <Text style={[styles.policyValue, leavePolicy.lop.totalDays > 0 && styles.lopValue]}>
                  {leavePolicy.lop.totalDays} day{leavePolicy.lop.totalDays === 1 ? '' : 's'}
                </Text>
              </View>
            </View>

            <Text style={styles.policyHint}>
              1 leave + 2 permissions (≤ 2 hr each) free per month.
              Anything beyond becomes Loss of Pay.
            </Text>
          </View>
        )}

        {/* ============ SECTION 3: HISTORY LIST ============ */}
        <View style={styles.summaryHeader}>
          <Text style={styles.summaryTitle}>Attendance</Text>
          <View style={styles.pickerRow}>
            <TouchableOpacity
              style={styles.picker}
              onPress={() => setShowMonthPicker(true)}
            >
              <Text style={styles.pickerText}>{MONTHS[month - 1].slice(0, 3)}</Text>
              <Ionicons name="chevron-down" size={14} color="#333" />
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.picker}
              onPress={() => setShowYearPicker(true)}
            >
              <Text style={styles.pickerText}>{year}</Text>
              <Ionicons name="chevron-down" size={14} color="#333" />
            </TouchableOpacity>
          </View>
        </View>

        {history.length === 0 ? (
          <View style={styles.emptyBox}>
            <Text style={styles.emptyText}>No attendance records for this month.</Text>
          </View>
        ) : (
          history.map((h) => {
            const daysOld = daysBetweenTodayAnd(h.date);
            // Disable Request after the 2-day window has passed, or if the
            // record is for a future date (shouldn't happen but guard anyway).
            const requestClosed = daysOld < 0 || daysOld > REQUEST_WINDOW_DAYS;
            return (
            <View key={h._id} style={styles.histCard}>
              <View style={styles.histTopRow}>
                <Text style={styles.histDate}>{formatHistoryDate(h.date)}</Text>
                <StatusBadge status={h.status} />
              </View>

              <View style={styles.histStatsRow}>
                <View style={styles.histStat}>
                  <Text style={styles.histStatValue}>{formatTime(h.checkIn)}</Text>
                  <Text style={styles.histStatLabel}>Check In</Text>
                </View>
                <View style={styles.histStat}>
                  <Text style={styles.histStatValue}>{formatTime(h.checkOut)}</Text>
                  <Text style={styles.histStatLabel}>Check Out</Text>
                </View>
                <View style={styles.histStat}>
                  <Text style={styles.histStatValue}>{formatWorked(h.workedHours)}</Text>
                  <Text style={styles.histStatLabel}>Working HR's</Text>
                </View>
              </View>

              {(() => {
                // Reflect the actual lifecycle: pending → "Requested",
                // approved → "Approved", rejected → "Rejected". A
                // rejected row should NOT lock the button (the employee
                // is allowed to re-file with the correct details).
                const status = requestedDates.get(h.date) || '';
                const isPending  = status === 'pending';
                const isApproved = status === 'approved';
                const isRejected = status === 'rejected';
                const btnDisabled = requestClosed || isPending || isApproved;
                let label: string;
                if (isApproved)        label = 'Approved';
                else if (isRejected)   label = 'Rejected — tap to re-file';
                else if (isPending)    label = 'Requested';
                else if (requestClosed) label = 'Request window closed';
                else                    label = 'Request';
                // Tint the button to match status. Approved = green
                // (same as primary), Rejected = red, Pending/disabled
                // = grey. The base requestBtn already uses GREEN so we
                // only override for the new states.
                const tintStyle =
                  isRejected ? { backgroundColor: '#FCE4E4' } :
                  isApproved ? { backgroundColor: '#DCFCE7' } :
                  null;
                const textTintStyle =
                  isRejected ? { color: '#B91C1C' } :
                  isApproved ? { color: '#15803D' } :
                  null;
                return (
                  <TouchableOpacity
                    style={[
                      styles.requestBtn,
                      btnDisabled && styles.requestBtnDisabled,
                      tintStyle,
                    ]}
                    onPress={() => {
                      if (isApproved) {
                        Alert.alert('Already approved', 'This request has already been approved.');
                        return;
                      }
                      if (isPending) {
                        Alert.alert(
                          'Already requested',
                          `You've already filed a regularisation request for this date. Wait for HR / your manager to act on it.`
                        );
                        return;
                      }
                      if (requestClosed) {
                        Alert.alert(
                          'Request window closed',
                          `You can only file a request within ${REQUEST_WINDOW_DAYS} days of the missed date. ` +
                          `This date is ${daysOld} days old — please contact HR directly.`
                        );
                        return;
                      }
                      setReqModalDate(h.date);
                    }}
                    activeOpacity={btnDisabled ? 1 : 0.85}
                    disabled={btnDisabled}
                  >
                    <Text
                      style={[
                        styles.requestBtnText,
                        btnDisabled && !isApproved && !isRejected && styles.requestBtnTextDisabled,
                        textTintStyle,
                      ]}
                    >
                      {label}
                    </Text>
                  </TouchableOpacity>
                );
              })()}
            </View>
            );
          })
        )}
      </ScrollView>

      {/* MONTH PICKER — disables months in the future for the currently
          selected year. Picking Aug 2026 when "today" is Jun 2026 would
          show an empty history with no explanation; instead we grey
          those rows out so the user understands why. */}
      <Modal visible={showMonthPicker} transparent animationType="fade">
        <Pressable style={styles.modalBackdrop} onPress={() => setShowMonthPicker(false)}>
          <View style={[styles.modalSheet, { paddingBottom: insets.bottom + 16 }]}>
            <Text style={styles.modalTitle}>Select Month</Text>
            <ScrollView>
              {MONTHS.map((m, i) => {
                const isFuture =
                  year > today.getFullYear() ||
                  (year === today.getFullYear() && i > today.getMonth());
                // Months before June 2026 are below the historical floor
                // — there are no attendance records to show, so they're
                // disabled the same way future months are.
                const isBelowFloor =
                  year === YEAR_FLOOR && i < MONTH_FLOOR;
                const disabled = isFuture || isBelowFloor;
                return (
                  <TouchableOpacity
                    key={m}
                    style={styles.modalRow}
                    disabled={disabled}
                    onPress={() => {
                      const d = new Date(cursor);
                      d.setMonth(i);
                      setCursor(d);
                      setShowMonthPicker(false);
                    }}
                  >
                    <Text
                      style={[
                        styles.modalRowText,
                        i === month - 1 && { color: '#2E7D32', fontWeight: '700' },
                        disabled && { color: '#C0C0C0' },
                      ]}
                    >
                      {m}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </ScrollView>
          </View>
        </Pressable>
      </Modal>

      {/* YEAR PICKER — disables any year after the current calendar year. */}
      <Modal visible={showYearPicker} transparent animationType="fade">
        <Pressable style={styles.modalBackdrop} onPress={() => setShowYearPicker(false)}>
          <View style={[styles.modalSheet, { paddingBottom: insets.bottom + 16 }]}>
            <Text style={styles.modalTitle}>Select Year</Text>
            {years.map((y) => {
              const isFuture = y > today.getFullYear();
              return (
                <TouchableOpacity
                  key={y}
                  style={styles.modalRow}
                  disabled={isFuture}
                  onPress={() => {
                    const d = new Date(cursor);
                    d.setFullYear(y);
                    // If switching to current year while a future month is
                    // selected, clamp the month back to today's month so
                    // the user doesn't land on an empty future view.
                    if (y === today.getFullYear() && d.getMonth() > today.getMonth()) {
                      d.setMonth(today.getMonth());
                    }
                    setCursor(d);
                    setShowYearPicker(false);
                  }}
                >
                  <Text
                    style={[
                      styles.modalRowText,
                      y === year && { color: '#2E7D32', fontWeight: '700' },
                      isFuture && { color: '#C0C0C0' },
                    ]}
                  >
                    {y}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </View>
        </Pressable>
      </Modal>

      {/* REQUEST MODAL */}
      <Modal visible={!!reqModalDate} transparent animationType="slide">
        <Pressable style={styles.modalBackdrop} onPress={() => setReqModalDate(null)}>
          <Pressable
            style={[
              styles.modalSheet,
              // Lift the sheet above the gesture/nav bar so the Submit
              // button is always tappable. The +16 baseline keeps a
              // comfortable air gap on phones with no nav bar (insets.bottom = 0).
              { paddingBottom: insets.bottom + 24 },
            ]}
            onPress={() => {}}
          >
            <Text style={styles.modalTitle}>Request Regularisation</Text>
            <Text style={styles.modalSub}>For {reqModalDate}</Text>
            <TextInput
              value={reqReason}
              onChangeText={setReqReason}
              placeholder="Reason for the request..."
              placeholderTextColor="#aaa"
              multiline
              style={styles.reasonInput}
            />
            <TouchableOpacity
              style={[styles.submitBtn, submitting && { opacity: 0.85 }]}
              onPress={submitRequest}
              disabled={submitting}
            >
              {submitting ? (
                <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center' }}>
                  <ActivityIndicator size="small" color="#fff" />
                  <Text style={[styles.submitBtnText, { marginLeft: 8 }]}>Submitting…</Text>
                </View>
              ) : (
                <Text style={styles.submitBtnText}>Submit Request</Text>
              )}
            </TouchableOpacity>
          </Pressable>
        </Pressable>
      </Modal>

      <SuccessModal
        visible={!!success}
        title={success?.title || ''}
        body={success?.body || ''}
        ctaLabel="Done"
        onClose={() => setSuccess(null)}
      />
    </SafeAreaView>
  );
}

/* ============ helpers ============ */
function LegendItem({ color, label }: { color: string; label: string }) {
  return (
    <View style={styles.legendItem}>
      <View style={[styles.legendDot, { backgroundColor: color }]} />
      <Text style={styles.legendText}>{label}</Text>
    </View>
  );
}

function StatCard({ color, label, value }: { color: string; label: string; value: number }) {
  return (
    <View style={[styles.statCard, { backgroundColor: color }]}>
      <Text style={styles.statCardLabel}>{label}</Text>
      <Text style={styles.statCardValue}>{String(value).padStart(2, '0')}</Text>
    </View>
  );
}

function StatusBadge({ status }: { status: Status }) {
  const map: Record<string, { bg: string; fg: string; text: string }> = {
    present:    { bg: '#4CAF50', fg: '#FFFFFF', text: 'Present' },
    absent:     { bg: '#F44336', fg: '#FFFFFF', text: 'Absent' },
    permission: { bg: '#FFD37A', fg: '#7A5300', text: 'Permission' },
    late:       { bg: '#FF9800', fg: '#FFFFFF', text: 'Late' },
    halfday:    { bg: '#9C27B0', fg: '#FFFFFF', text: 'Half day' },
    leave:      { bg: '#E96A66', fg: '#FFFFFF', text: 'Leave' },
  };
  const conf = (status && map[status]) || { bg: '#BDBDBD', fg: '#FFFFFF', text: '—' };
  return (
    <View style={[styles.badge, { backgroundColor: conf.bg }]}>
      <Text style={[styles.badgeText, { color: conf.fg }]}>{conf.text}</Text>
    </View>
  );
}

/* ============ styles ============ */
const GREEN = '#4CAF50';
const PAGE_BG = '#FFFFFF';

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: PAGE_BG },

  pageTitle: {
    fontSize: 18,
    fontWeight: '800',
    color: '#111',
    marginHorizontal: 16,
    marginTop: 10,
    marginBottom: 10,
  },

  /* CALENDAR */
  calendarCard: {
    marginHorizontal: 16,
    paddingHorizontal: 4,
    paddingVertical: 10,
  },
  calHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 8,
    marginBottom: 10,
  },
  calMonth: { fontSize: 16, fontWeight: '700', color: '#111' },
  navRow: { flexDirection: 'row' },
  navBtn: {
    width: 28,
    height: 28,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    marginLeft: 6,
  },
  daysRow: {
    flexDirection: 'row',
    paddingHorizontal: 4,
    marginBottom: 4,
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
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  todayCircle: {
    backgroundColor: '#E8F5E9',
    borderWidth: 1,
    borderColor: GREEN,
  },
  dayNum: { fontSize: 13, color: '#1A1A1A', fontWeight: '500' },
  dayNumDim: { color: '#CFCFCF' },
  dayNumToday: { color: '#1B5E20', fontWeight: '700' },
  dotRow: {
    // Horizontal so multi-status days (late = green + orange) lay out
    // side by side, not stacked.
    flexDirection: 'row',
    height: 8,
    marginTop: 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  statusDot: { width: 5, height: 5, borderRadius: 3 },
  statusDotPlaceholder: { width: 5, height: 5 },

  legendRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    marginTop: 12,
  },
  legendItem: {
    flexDirection: 'row',
    alignItems: 'center',
    marginHorizontal: 10,
  },
  legendDot: {
    width: 9,
    height: 9,
    borderRadius: 5,
    marginRight: 5,
  },
  legendText: { fontSize: 11, color: '#5A5A5A' },
  legendHint: {
    fontSize: 10,
    color: '#888',
    textAlign: 'center',
    marginTop: 8,
    fontStyle: 'italic',
  },

  /* SUMMARY HEADER */
  summary: {
    flexDirection: 'row',
    paddingHorizontal: 16,
    marginTop: 12,
    marginBottom: 8,
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  summaryHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    marginTop: 14,
    marginBottom: 10,
  },
  summaryTitle: { fontSize: 16, fontWeight: '800', color: '#111' },

  /* STATS GRID */
  // 2x2 grid of stats cards. The outer `statsGrid` stacks the two
  // `statsRow`s vertically (column); each row arranges its two cards
  // horizontally (row). Without `flexDirection: 'column'` on the
  // outer container, the two rows competed for horizontal space and
  // every card collapsed into a thin vertical bar — which is exactly
  // the "tall stripes" bug HR reported on 10-Jun-26.
  statsGrid: {
    flexDirection: 'column',
    paddingHorizontal: 12,
    marginTop: 6,
  },
  statsRow: {
    flexDirection: 'row',
  },
  statCard: {
    flex: 1,
    backgroundColor: '#FFFFFF', // overridden inline by the bucket colour
    margin: 6,
    paddingVertical: 26,
    paddingHorizontal: 12,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 140,
    shadowColor: '#000',
    shadowOpacity: 0.12,
    shadowOffset: { width: 0, height: 4 },
    shadowRadius: 10,
    elevation: 4,
  },
  statCardLabel: {
    fontSize: 13,
    color: '#FFFFFF',
    fontWeight: '800',
    letterSpacing: 1.2,
    textTransform: 'uppercase',
  },
  statCardValue: {
    fontSize: 44,
    fontWeight: '900',
    color: '#FFFFFF',
    marginTop: 10,
    letterSpacing: 1,
  },

  /* LOP / POLICY */
  policyCard: {
    backgroundColor: '#FFFFFF',
    marginHorizontal: 16,
    marginTop: 14,
    paddingHorizontal: 14,
    paddingVertical: 14,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#E6EDE7',
  },
  policyHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 10,
  },
  policyTitle: { fontSize: 14, fontWeight: '700', color: '#111' },
  policyRow: { flexDirection: 'row', alignItems: 'center', marginTop: 6 },
  policyCol: { flex: 1, alignItems: 'center' },
  policyDivider: { width: 1, height: 28, backgroundColor: '#E6EDE7', marginHorizontal: 8 },
  policyLabel: { fontSize: 11, color: '#666', marginTop: 2 },
  policyValue: { fontSize: 15, fontWeight: '800', color: '#111' },
  policyHint: { fontSize: 11, color: '#777', marginTop: 8, fontStyle: 'italic', textAlign: 'center' },
  lopBadge: {
    backgroundColor: '#FEF3C7',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 10,
  },
  lopBadgeText: { color: '#B45309', fontSize: 11, fontWeight: '700' },
  lopValue: { color: '#B45309' },
  lopHint: { fontSize: 11, color: '#999', marginTop: 4 },

  /* PICKER ROW */
  pickerRow: { flexDirection: 'row', alignItems: 'center' },
  picker: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#D6E4D9',
    marginLeft: 8,
    backgroundColor: '#FFFFFF',
  },
  pickerText: { fontSize: 12, fontWeight: '700', color: '#1B5E20', marginRight: 4 },

  /* HISTORY CARDS */
  histCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    marginHorizontal: 16,
    marginTop: 10,
    borderWidth: 1,
    borderColor: '#E6EDE7',
  },
  histTopRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  histDate: { fontSize: 14, fontWeight: '700', color: '#111' },
  badge: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 10,
  },
  badgeText: { fontSize: 11, fontWeight: '700' },
  histStatsRow: {
    flexDirection: 'row',
    marginTop: 10,
    justifyContent: 'space-between',
  },
  histStat: { alignItems: 'center', flex: 1 },
  histStatValue: { fontSize: 13, fontWeight: '700', color: '#1A1A1A' },
  histStatLabel: { fontSize: 11, color: '#777', marginTop: 2 },
  requestBtn: {
    marginTop: 12,
    backgroundColor: '#2E7D32',
    paddingVertical: 11,
    borderRadius: 10,
    alignItems: 'center',
  },
  requestBtnDisabled: { backgroundColor: '#E5E7EB' },
  requestBtnText: { color: '#FFFFFF', fontSize: 13, fontWeight: '700' },
  requestBtnTextDisabled: { color: '#6B7280' },

  emptyBox: {
    paddingVertical: 36,
    alignItems: 'center',
  },
  emptyText: { fontSize: 13, color: '#999' },

  /* MODAL */
  modalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.45)',
    justifyContent: 'flex-end',
  },
  modalSheet: {
    backgroundColor: '#FFFFFF',
    borderTopLeftRadius: 22,
    borderTopRightRadius: 22,
    paddingHorizontal: 22,
    paddingTop: 22,
    paddingBottom: 22,
  },
  modalTitle: { fontSize: 17, fontWeight: '800', color: '#111' },
  modalSub: { fontSize: 12, color: '#777', marginTop: 4, marginBottom: 14 },
  modalRow: {
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#F1F5F9',
  },
  modalRowText: { fontSize: 15, color: '#111' },

  reasonInput: {
    borderWidth: 1,
    borderColor: '#E6EDE7',
    borderRadius: 10,
    padding: 12,
    minHeight: 90,
    fontSize: 14,
    color: '#111',
    textAlignVertical: 'top',
    marginBottom: 14,
  },
  submitBtn: {
    backgroundColor: '#2E7D32',
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  submitBtnText: { color: '#FFFFFF', fontSize: 14, fontWeight: '700' },
});
  modalRowText: { fontSize: 15, color: '#111' },

  reasonInput: {
    borderWidth: 1,
    borderColor: '#E6EDE7',
    borderRadius: 10,
    padding: 12,
    minHeight: 90,
    fontSize: 14,
    color: '#111',
    textAlignVertical: 'top',
    marginBottom: 14,
  },
  submitBtn: {
    backgroundColor: '#2E7D32',
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  submitBtnText: { color: '#FFFFFF', fontSize: 14, fontWeight: '700' },
});
ical: 36,
    alignItems: 'center',
  },
  emptyText: { fontSize: 13, color: '#999' },

  /* MODAL */
  modalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.45)',
    justifyContent: 'flex-end',
  },
  modalSheet: {
    backgroundColor: '#FFFFFF',
    borderTopLeftRadius: 22,
    borderTopRightRadius: 22,
    paddingHorizontal: 22,
    paddingTop: 22,
    paddingBottom: 22,
  },
  modalTitle: { fontSize: 17, fontWeight: '800', color: '#111' },
  modalSub: { fontSize: 12, color: '#777', marginTop: 4, marginBottom: 14 },
  modalRow: {
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#F1F5F9',
  },
  modalRowText: { fontSize: 15, color: '#111' },

  reasonInput: {
    borderWidth: 1,
    borderColor: '#E6EDE7',
    borderRadius: 10,
    padding: 12,
    minHeight: 90,
    fontSize: 14,
    color: '#111',
    textAlignVertical: 'top',
    marginBottom: 14,
  },
  submitBtn: {
    backgroundColor: '#2E7D32',
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  submitBtnText: { color: '#FFFFFF', fontSize: 14, fontWeight: '700' },
});
