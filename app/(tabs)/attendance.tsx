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
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { attendanceAPI } from '../../services/api';

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
    const d = new Date(cursor);
    d.setMonth(d.getMonth() + dir);
    setCursor(d);
  };

  // Build a 6x7 calendar grid (Mon-Sun rows)
  const today = new Date();
  const isCurrentMonth =
    today.getFullYear() === year && today.getMonth() + 1 === month;
  const firstDow = new Date(year, month - 1, 1).getDay();
  const startOffset = firstDow === 0 ? 6 : firstDow - 1;
  const daysInMonth = new Date(year, month, 0).getDate();
  const daysInPrev = new Date(year, month - 1, 0).getDate();

  const cells: { day: number; current: boolean; key: string }[] = [];
  for (let i = startOffset - 1; i >= 0; i--) {
    cells.push({ day: daysInPrev - i, current: false, key: `p-${daysInPrev - i}` });
  }
  for (let d = 1; d <= daysInMonth; d++) {
    cells.push({ day: d, current: true, key: `c-${d}` });
  }
  let next = 1;
  while (cells.length < 42) {
    cells.push({ day: next, current: false, key: `n-${next}` });
    next++;
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
      Alert.alert('Submitted', 'Your request has been sent to HR.');
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

  // Company started in April 2025 — floor the year picker at 2025.
  const years = (() => {
    const FLOOR = 2025;
    const top   = Math.max(year + 1, FLOOR);
    const out: number[] = [];
    for (let y = FLOOR; y <= top; y++) out.push(y);
    return out;
  })();

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
              <TouchableOpacity onPress={() => changeMonth(1)} style={styles.navBtn}>
                <Ionicons name="chevron-forward" size={18} color="#333" />
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
              const dateStr = current
                ? `${year}-${pad(month)}-${pad(day)}`
                : '';
              const item = current ? calendar[dateStr] : undefined;
              const status = item?.status;
              const isToday =
                current && isCurrentMonth && day === today.getDate();

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
                        !current && styles.dayNumDim,
                        isToday && styles.dayNumToday,
                      ]}
                    >
                      {day}
                    </Text>
                  </View>
                  <View style={styles.dotRow}>
                    {(() => {
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

              <TouchableOpacity
                style={[styles.requestBtn, requestClosed && styles.requestBtnDisabled]}
                onPress={() => {
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
                activeOpacity={requestClosed ? 1 : 0.85}
                disabled={requestClosed}
              >
                <Text
                  style={[styles.requestBtnText, requestClosed && styles.requestBtnTextDisabled]}
                >
                  {requestClosed ? 'Request window closed' : 'Request'}
                </Text>
              </TouchableOpacity>
            </View>
            );
          })
        )}
      </ScrollView>

      {/* MONTH PICKER */}
      <Modal visible={showMonthPicker} transparent animationType="fade">
        <Pressable style={styles.modalBackdrop} onPress={() => setShowMonthPicker(false)}>
          <View style={styles.modalSheet}>
            <Text style={styles.modalTitle}>Select Month</Text>
            <ScrollView>
              {MONTHS.map((m, i) => (
                <TouchableOpacity
                  key={m}
                  style={styles.modalRow}
                  onPress={() => {
                    const d = new Date(cursor);
                    d.setMonth(i);
                    setCursor(d);
                    setShowMonthPicker(false);
                  }}
                >
                  <Text style={[styles.modalRowText, i === month - 1 && { color: '#2E7D32', fontWeight: '700' }]}>
                    {m}
                  </Text>
                </TouchableOpacity>
              ))}
            </ScrollView>
          </View>
        </Pressable>
      </Modal>

      {/* YEAR PICKER */}
      <Modal visible={showYearPicker} transparent animationType="fade">
        <Pressable style={styles.modalBackdrop} onPress={() => setShowYearPicker(false)}>
          <View style={styles.modalSheet}>
            <Text style={styles.modalTitle}>Select Year</Text>
            {years.map((y) => (
              <TouchableOpacity
                key={y}
                style={styles.modalRow}
                onPress={() => {
                  const d = new Date(cursor);
                  d.setFullYear(y);
                  setCursor(d);
                  setShowYearPicker(false);
                }}
              >
                <Text style={[styles.modalRowText, y === year && { color: '#2E7D32', fontWeight: '700' }]}>
                  {y}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
        </Pressable>
      </Modal>

      {/* REQUEST MODAL */}
      <Modal visible={!!reqModalDate} transparent animationType="slide">
        <Pressable style={styles.modalBackdrop} onPress={() => setReqModalDate(null)}>
          <Pressable style={styles.modalSheet} onPress={() => {}}>
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
              style={[styles.submitBtn, submitting && { opacity: 0.6 }]}
              onPress={submitRequest}
              disabled={submitting}
            >
              <Text style={styles.submitBtnText}>
                {submitting ? 'Submitting...' : 'Submit Request'}
              </Text>
            </TouchableOpacity>
          </Pressable>
        </Pressable>
      </Modal>
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
  summaryHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginHorizontal: 16,
    marginTop: 22,
    marginBottom: 12,
  },
  summaryTitle: { fontSize: 16, fontWeight: '800', color: '#111' },
  pickerRow: { flexDirection: 'row' },
  picker: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#E0E0E0',
    borderRadius: 14,
    paddingHorizontal: 12,
    paddingVertical: 6,
    marginLeft: 8,
    shadowColor: '#000',
    shadowOpacity: 0.05,
    shadowOffset: { width: 0, height: 1 },
    shadowRadius: 2,
    elevation: 1,
  },
  pickerText: { fontSize: 12, color: '#333', marginRight: 4, fontWeight: '600' },

  /* STAT CARDS — explicit 2-per-row grid, matches Figma style */
  statsGrid: {
    paddingHorizontal: 12,
  },
  statsRow: {
    flexDirection: 'row',
    marginBottom: 10,
  },
  statCard: {
    flex: 1,
    marginHorizontal: 6,
    borderRadius: 18,        // slightly more rounded — matches figma corner radius
    paddingVertical: 22,     // a bit taller for the bold numbers
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOpacity: 0.12,
    shadowOffset: { width: 0, height: 6 },
    shadowRadius: 10,
    elevation: 4,
  },
  statCardLabel: {
    color: '#FFFFFF',
    fontSize: 13,
    fontWeight: '700',
    letterSpacing: 1.2,
  },
  statCardValue: {
    color: '#FFFFFF',
    fontSize: 34,
    fontWeight: '800',
    marginTop: 10,
    letterSpacing: 0.5,
  },

  /* LEAVE POLICY / LOP CARD */
  policyCard: {
    marginHorizontal: 16,
    marginTop: 18,
    marginBottom: 4,
    padding: 16,
    borderRadius: 14,
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#EEF1EE',
    shadowColor: '#000',
    shadowOpacity: 0.05,
    shadowOffset: { width: 0, height: 3 },
    shadowRadius: 6,
    elevation: 2,
  },
  policyHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
  },
  policyTitle: {
    fontSize: 14,
    fontWeight: '800',
    color: '#1A1A1A',
  },
  lopBadge: {
    backgroundColor: '#FFE7E7',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 12,
  },
  lopBadgeText: {
    color: '#C62828',
    fontSize: 11,
    fontWeight: '700',
  },
  policyRow: {
    flexDirection: 'row',
  },
  policyCol: {
    flex: 1,
  },
  policyLabel: {
    fontSize: 11.5,
    color: '#7A7A7A',
    fontWeight: '600',
  },
  policyValue: {
    fontSize: 14,
    color: '#1A1A1A',
    fontWeight: '700',
    marginTop: 3,
  },
  lopValue: {
    color: '#C62828',
  },
  lopHint: {
    fontSize: 11,
    color: '#C62828',
    fontWeight: '600',
  },
  policyDivider: {
    height: 1,
    backgroundColor: '#F0F0F0',
    marginVertical: 10,
  },
  policyHint: {
    fontSize: 10.5,
    color: '#9A9A9A',
    marginTop: 10,
    fontStyle: 'italic',
  },

  /* HISTORY */
  histCard: {
    backgroundColor: '#FFFFFF',
    marginHorizontal: 16,
    marginBottom: 12,
    padding: 14,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#EBEDEB',
    shadowColor: '#000',
    shadowOpacity: 0.04,
    shadowOffset: { width: 0, height: 2 },
    shadowRadius: 4,
    elevation: 1,
  },
  histTopRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  histDate: { fontSize: 14, fontWeight: '700', color: '#1A1A1A' },
  badge: {
    paddingHorizontal: 14,
    paddingVertical: 5,
    borderRadius: 14,
  },
  badgeText: { fontSize: 11, fontWeight: '700' },
  histStatsRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 14,
    marginBottom: 12,
  },
  histStat: { flex: 1, alignItems: 'center' },
  histStatValue: {
    fontSize: 13,
    color: '#2E7D32',
    fontWeight: '700',
  },
  histStatLabel: {
    fontSize: 11,
    color: '#555',
    marginTop: 2,
  },
  requestBtn: {
    backgroundColor: GREEN,
    borderRadius: 22,
    alignItems: 'center',
    paddingVertical: 10,
    marginTop: 4,
  },
  requestBtnDisabled: {
    backgroundColor: '#E0E0E0',
  },
  requestBtnText: {
    color: '#FFFFFF',
    fontSize: 13,
    fontWeight: '700',
  },
  requestBtnTextDisabled: {
    color: '#9E9E9E',
  },

  emptyBox: {
    marginHorizontal: 16,
    padding: 20,
    backgroundColor: '#F5F7F6',
    borderRadius: 12,
    alignItems: 'center',
  },
  emptyText: { color: '#777', fontSize: 13 },

  /* MODAL */
  modalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.4)',
    justifyContent: 'flex-end',
  },
  modalSheet: {
    backgroundColor: '#FFFFFF',
    borderTopLeftRadius: 22,
    borderTopRightRadius: 22,
    padding: 20,
    maxHeight: '70%',
  },
  modalTitle: { fontSize: 16, fontWeight: '700', color: '#111', marginBottom: 8 },
  modalSub: { fontSize: 12, color: '#666', marginBottom: 14 },
  modalRow: {
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#F0F0F0',
  },
  modalRowText: { fontSize: 14, color: '#222' },

  reasonInput: {
    borderWidth: 1,
    borderColor: '#E0E0E0',
    borderRadius: 12,
    padding: 12,
    minHeight: 80,
    textAlignVertical: 'top',
    color: '#111',
    marginBottom: 14,
  },
  submitBtn: {
    backgroundColor: GREEN,
    borderRadius: 22,
    paddingVertical: 12,
    alignItems: 'center',
  },
  submitBtnText: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '700',
  },
});
