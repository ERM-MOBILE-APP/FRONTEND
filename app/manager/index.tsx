import React, { useCallback, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  RefreshControl,
  ActivityIndicator,
  LayoutAnimation,
  Platform,
  UIManager,
} from 'react-native';
import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { router, useFocusEffect } from 'expo-router';
import ScreenErrorBoundary from '../../components/ScreenErrorBoundary';
import { ManagerHeader, Card, MC, Loading } from '../../components/manager/ManagerUI';
import { managerAPI } from '../../services/api';

// Smooth expand/collapse on Android too.
if (Platform.OS === 'android' && UIManager.setLayoutAnimationEnabledExperimental) {
  UIManager.setLayoutAnimationEnabledExperimental(true);
}

type Person = {
  _id: string;
  employeeId?: string;
  name: string;
  designation?: string;
  department?: string;
  teamCount?: number;
  active?: boolean;
};

const initialOf = (n: string) => (n || '?').trim()[0]?.toUpperCase() || '?';

// Feature rows shown under an expanded sub-manager. Each opens the existing
// feature screen SCOPED to that sub-manager (managerId + managerName params),
// so the backend re-scopes the data to that manager's own team.
// Rendered AFTER the Team Members row, so the full node order matches the
// manager's own cards: Team Members, Approvals, Attendance, Live Tracking,
// Announcements.
const NODE_FEATURES: {
  key: string; label: string; route: string;
  render: () => React.ReactNode;
}[] = [
  { key: 'approvals',     label: 'Approvals',          route: '/manager/approvals',
    render: () => <MaterialCommunityIcons name="clipboard-check-outline" size={18} color={MC.green} /> },
  { key: 'attendance',    label: 'Attendance Reports', route: '/manager/attendance',
    render: () => <MaterialCommunityIcons name="calendar-account-outline" size={18} color={MC.green} /> },
  { key: 'tracking',      label: 'Live Tracking',      route: '/manager/tracking',
    render: () => <Ionicons name="location-outline" size={18} color={MC.green} /> },
  { key: 'announcements', label: 'Announcements',      route: '/manager/announcements',
    render: () => <Ionicons name="megaphone-outline" size={18} color={MC.green} /> },
];

/**
 * One collapsible node in the reporting tree — a sub-manager. Collapsed it
 * shows just the name + a "Manager" tag + team size. Expanded it reveals that
 * manager's full dashboard entry points (Approvals, Live Tracking,
 * Announcements, Attendance Reports) plus a nested, lazy-loaded Team Members
 * list — each entry point opens the real feature screen scoped to THIS manager.
 */
function ManagerNode({ mgr }: { mgr: Person }) {
  const [open, setOpen] = useState(false);
  const [teamOpen, setTeamOpen] = useState(false);
  const [members, setMembers] = useState<Person[] | null>(null);
  const [loadingTeam, setLoadingTeam] = useState(false);

  const scopedParams = { managerId: String(mgr._id), managerName: mgr.name };
  const openScoped = (route: string) =>
    router.push({ pathname: route as any, params: scopedParams });

  const toggle = () => {
    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
    setOpen((v) => !v);
  };

  const toggleTeam = async () => {
    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
    const next = !teamOpen;
    setTeamOpen(next);
    if (next && members === null && !loadingTeam) {
      setLoadingTeam(true);
      try {
        const res = await managerAPI.team(String(mgr._id));
        setMembers(res?.data?.team || []);
      } catch {
        setMembers([]);
      } finally {
        setLoadingTeam(false);
      }
    }
  };

  return (
    <Card style={styles.node}>
      {/* Node header — tap to expand this manager's access. */}
      <TouchableOpacity style={styles.nodeHead} activeOpacity={0.75} onPress={toggle}>
        <View style={styles.nodeAvatar}>
          <Text style={styles.nodeAvatarText}>{initialOf(mgr.name)}</Text>
        </View>
        <View style={{ flex: 1 }}>
          <View style={styles.nodeNameRow}>
            <Text style={styles.nodeName} numberOfLines={1}>{mgr.name}</Text>
            <View style={styles.mgrTag}>
              <MaterialCommunityIcons name="account-supervisor" size={11} color={MC.green} />
              <Text style={styles.mgrTagText}>Manager</Text>
            </View>
          </View>
          <Text style={styles.nodeSub} numberOfLines={1}>
            {mgr.designation ? `${mgr.designation} · ` : ''}
            {mgr.teamCount ?? 0} {(mgr.teamCount ?? 0) === 1 ? 'member' : 'members'}
          </Text>
        </View>
        <Ionicons name={open ? 'chevron-up' : 'chevron-down'} size={20} color={MC.sub} />
      </TouchableOpacity>

      {open && (
        <View style={styles.nodeBody}>
          {/* Team Members FIRST — nested, lazy-loaded list. */}
          <TouchableOpacity style={styles.featureRow} activeOpacity={0.7} onPress={toggleTeam}>
            <View style={styles.featureIcon}>
              <Ionicons name="people-outline" size={18} color={MC.green} />
            </View>
            <Text style={styles.featureLabel}>Team Members</Text>
            <Text style={styles.featureCount}>{mgr.teamCount ?? 0}</Text>
            <Ionicons name={teamOpen ? 'chevron-up' : 'chevron-down'} size={16} color="#C4C9CF" />
          </TouchableOpacity>

          {teamOpen && (
            <View style={styles.memberWrap}>
              {loadingTeam ? (
                <View style={styles.memberLoading}>
                  <ActivityIndicator size="small" color={MC.green} />
                </View>
              ) : (members && members.length > 0) ? (
                <>
                  {members.map((m) => (
                    <View key={m._id} style={styles.memberRow}>
                      <View style={styles.memberDot} />
                      <View style={{ flex: 1 }}>
                        <Text style={styles.memberName} numberOfLines={1}>{m.name}</Text>
                        {!!m.designation && (
                          <Text style={styles.memberSub} numberOfLines={1}>{m.designation}</Text>
                        )}
                      </View>
                      {m.active === false && (
                        <Text style={styles.memberInactive}>Inactive</Text>
                      )}
                    </View>
                  ))}
                  <TouchableOpacity
                    style={styles.openTeamBtn}
                    activeOpacity={0.7}
                    onPress={() => openScoped('/manager/team')}
                  >
                    <Text style={styles.openTeamText}>Open full team screen</Text>
                    <Ionicons name="arrow-forward" size={14} color={MC.green} />
                  </TouchableOpacity>
                </>
              ) : (
                <Text style={styles.memberEmpty}>No team members found.</Text>
              )}
            </View>
          )}

          {/* Then the rest, in the same order as the own-team cards. */}
          {NODE_FEATURES.map((f) => (
            <TouchableOpacity
              key={f.key}
              style={styles.featureRow}
              activeOpacity={0.7}
              onPress={() => openScoped(f.route)}
            >
              <View style={styles.featureIcon}>{f.render()}</View>
              <Text style={styles.featureLabel}>{f.label}</Text>
              <Ionicons name="chevron-forward" size={16} color="#C4C9CF" />
            </TouchableOpacity>
          ))}
        </View>
      )}
    </Card>
  );
}

/**
 * Manager hub — the landing screen for the Manager section. For a plain
 * manager it shows their own feature cards; for a HIGHER-LEVEL (senior) manager
 * it ALSO shows the reporting tree: each sub-manager is an expandable node that
 * opens that manager's own dashboard + team (never a flat blob of all people).
 * The tree is derived live from HRMS `assignedTo`, so it restructures itself
 * automatically when reporting lines change.
 */
function ManagerHome() {
  const insets = useSafeAreaInsets();
  const [loading, setLoading]   = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [managerName, setManagerName] = useState('');
  const [teamSize, setTeamSize] = useState(0);
  const [subManagers, setSubManagers] = useState<Person[]>([]);
  const [directReports, setDirectReports] = useState<Person[]>([]);
  const [counts, setCounts] = useState({ leaves: 0, allowances: 0, attnReqs: 0 });
  const [err, setErr] = useState('');

  const load = useCallback(async () => {
    setErr('');
    try {
      // #515 perf — one hierarchy call drives the whole hub (manager name, the
      // sub-manager nodes, and the direct-team count). We dropped the separate
      // team() call: its full-downline walk duplicated work and the summary now
      // shows the DIRECT team count, which hierarchy already returns.
      const hierRes = await managerAPI.hierarchy();
      const subs   = hierRes?.data?.managers || [];
      const direct = hierRes?.data?.directReports || [];
      setSubManagers(subs);
      setDirectReports(direct);
      setManagerName(hierRes?.data?.manager?.name || '');
      setTeamSize(subs.length + direct.length);

      // Pending badges: for a SENIOR manager (has sub-managers), count only
      // their OWN direct reports' pending — the sub-teams are triaged by their
      // own managers first and shown under each manager node. A plain manager
      // counts their whole team (which is just their direct reports anyway).
      const scopeArg: 'direct' | undefined = subs.length > 0 ? 'direct' : undefined;
      const [leaveRes, travelRes, petrolRes, attnRes] = await Promise.all([
        managerAPI.leaves({ status: 'pending', scope: scopeArg }),
        managerAPI.allowances({ type: 'travel', status: 'pending', scope: scopeArg }),
        managerAPI.allowances({ type: 'petrol', status: 'pending', scope: scopeArg }),
        managerAPI.attendanceRequests({ status: 'pending', scope: scopeArg }),
      ]);

      const leaves = (leaveRes?.data?.items || []).filter((l: any) => !l.managerStatus).length;
      const allowances =
        (travelRes?.data?.items || []).filter((a: any) => !a.managerStatus).length +
        (petrolRes?.data?.items || []).filter((a: any) => !a.managerStatus).length;
      const attnReqs = (attnRes?.data?.items || []).filter((r: any) => !r.managerStatus).length;
      setCounts({ leaves, allowances, attnReqs });
    } catch (e: any) {
      setErr(e?.response?.data?.message || e?.message || 'Could not load manager data.');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useFocusEffect(useCallback(() => { load(); }, [load]));
  const onRefresh = () => { setRefreshing(true); load(); };

  const isSenior = subManagers.length > 0;
  const pending = counts.leaves + counts.allowances + counts.attnReqs;
  // A senior manager's OWN team = their direct reports (sub-managers as people +
  // leaf employees). Their sub-managers' sub-teams are NOT counted here — those
  // live under each manager node above.
  const directCount = subManagers.length + directReports.length;

  // Params passed to the manager's OWN feature cards. For a senior manager they
  // carry scope='direct' so each screen shows only the direct team (never the
  // sub-managers' employees); for a plain manager, no scope (whole team).
  const ownParams = isSenior ? { scope: 'direct' } : undefined;
  const openOwn = (route: string) =>
    router.push(ownParams ? ({ pathname: route as any, params: ownParams }) : (route as any));

  // The manager's OWN feature cards — scoped to their direct team.
  const sections = [
    {
      key: 'team',
      title: 'Team Members',
      desc: isSenior
        ? `${directCount} direct ${directCount === 1 ? 'report' : 'reports'}`
        : (teamSize ? `${teamSize} people report to you` : 'Your assigned team'),
      icon: <Ionicons name="people-outline" size={24} color="#fff" />,
      color: '#0EA5E9',
      badge: 0,
      route: '/manager/team',
    },
    {
      key: 'approvals',
      title: 'Approvals',
      desc: 'Leave, permission, allowance & attendance requests',
      icon: <MaterialCommunityIcons name="clipboard-check-outline" size={24} color="#fff" />,
      color: MC.green,
      badge: pending,
      route: '/manager/approvals',
    },
    {
      key: 'attendance',
      title: 'Team Attendance',
      desc: 'Monthly report — present, late, absent',
      icon: <MaterialCommunityIcons name="calendar-account-outline" size={24} color="#fff" />,
      color: '#2563EB',
      badge: 0,
      route: '/manager/attendance',
    },
    {
      key: 'tracking',
      title: 'Live Tracking',
      desc: 'Where your team is right now',
      icon: <Ionicons name="location-outline" size={24} color="#fff" />,
      color: '#7C3AED',
      badge: 0,
      route: '/manager/tracking',
    },
    {
      key: 'announcements',
      title: 'Announcements',
      desc: 'Post to your team',
      icon: <Ionicons name="megaphone-outline" size={24} color="#fff" />,
      color: '#0D9488',
      badge: 0,
      route: '/manager/announcements',
    },
  ];

  return (
    <View style={[styles.screen, { paddingBottom: insets.bottom }]}>
      <ManagerHeader
        title="Manager"
        subtitle={managerName ? `Signed in as ${managerName}` : 'Team management'}
        onBack={() => router.replace('/(tabs)/')}
      />
      {loading ? (
        <Loading label="Loading your team…" />
      ) : (
        <ScrollView
          contentContainerStyle={{ paddingBottom: 24 }}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} colors={[MC.green]} />}
        >
          {/* Team summary strip — both halves are tappable. */}
          <Card style={styles.summaryCard}>
            <TouchableOpacity
              style={styles.summaryItem}
              activeOpacity={0.7}
              onPress={() => openOwn('/manager/team')}
            >
              <Text style={styles.summaryNum}>{directCount}</Text>
              <Text style={styles.summaryLabel}>Team members</Text>
              <View style={styles.summaryHintRow}>
                <Text style={styles.summaryHint}>View list</Text>
                <Ionicons name="chevron-forward" size={12} color={MC.sub} />
              </View>
            </TouchableOpacity>
            <View style={styles.summaryDivider} />
            <TouchableOpacity
              style={styles.summaryItem}
              activeOpacity={0.7}
              onPress={() => openOwn('/manager/approvals')}
            >
              <Text style={[styles.summaryNum, { color: MC.amber }]}>{pending}</Text>
              <Text style={styles.summaryLabel}>Pending actions</Text>
              <View style={styles.summaryHintRow}>
                <Text style={styles.summaryHint}>Review now</Text>
                <Ionicons name="chevron-forward" size={12} color={MC.sub} />
              </View>
            </TouchableOpacity>
          </Card>

          {!!err && (
            <Card style={{ backgroundColor: MC.redBg }}>
              <Text style={{ color: MC.red, fontSize: 13 }}>{err}</Text>
              <Text style={{ color: MC.sub, fontSize: 12, marginTop: 6 }}>
                If you were just made a manager, pull to refresh. If this persists, the
                server may still be starting up.
              </Text>
            </Card>
          )}

          {/* ── Senior manager: YOUR OWN TEAM first ────────────────────── */}
          {isSenior && (
            <>
              <View style={styles.sectionHeaderRow}>
                <Ionicons name="person-outline" size={15} color={MC.green} />
                <Text style={styles.sectionHeader}>Your own team</Text>
                <View style={styles.sectionCountPill}>
                  <Text style={styles.sectionCountText}>{directCount}</Text>
                </View>
              </View>
              <Text style={styles.sectionCaption}>
                Your direct reports only — the sub-teams below are managed separately.
              </Text>
            </>
          )}

          {/* ── The manager's own feature cards (direct team) ──────────── */}
          {sections.map((s) => (
            <TouchableOpacity
              key={s.key}
              activeOpacity={0.85}
              onPress={() => openOwn(s.route)}
            >
              <Card style={styles.navCard}>
                <View style={[styles.navIcon, { backgroundColor: s.color }]}>{s.icon}</View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.navTitle}>{s.title}</Text>
                  <Text style={styles.navDesc}>{s.desc}</Text>
                </View>
                {s.badge > 0 && (
                  <View style={styles.badge}>
                    <Text style={styles.badgeText}>{s.badge > 99 ? '99+' : s.badge}</Text>
                  </View>
                )}
                <Ionicons name="chevron-forward" size={20} color="#C4C9CF" />
              </Card>
            </TouchableOpacity>
          ))}

          {/* ── Senior manager: MANAGERS REPORTING TO YOU (after own team) ── */}
          {isSenior && (
            <>
              <View style={styles.sectionSpacer} />
              <View style={[styles.sectionHeaderRow, { marginTop: 4 }]}>
                <MaterialCommunityIcons name="account-tie-outline" size={17} color={MC.green} />
                <Text style={styles.sectionHeader}>Managers reporting to you</Text>
                <View style={styles.sectionCountPill}>
                  <Text style={styles.sectionCountText}>{subManagers.length}</Text>
                </View>
              </View>
              <Text style={styles.sectionCaption}>
                Tap a manager to open their approvals, tracking, announcements,
                attendance & team.
              </Text>
              {subManagers.map((m) => <ManagerNode key={m._id} mgr={m} />)}
            </>
          )}
        </ScrollView>
      )}
    </View>
  );
}

export default function ManagerHomeScreen() {
  return (
    <ScreenErrorBoundary name="Manager">
      <ManagerHome />
    </ScreenErrorBoundary>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: MC.bg },
  summaryCard: { flexDirection: 'row', alignItems: 'center', paddingVertical: 18 },
  summaryItem: { flex: 1, alignItems: 'center' },
  summaryDivider: { width: 1, height: 36, backgroundColor: MC.border },
  summaryNum: { fontSize: 26, fontWeight: '800', color: MC.green },
  summaryLabel: { fontSize: 12, color: MC.sub, marginTop: 2 },
  summaryHintRow: { flexDirection: 'row', alignItems: 'center', gap: 2, marginTop: 4 },
  summaryHint: { fontSize: 11, color: MC.sub, fontWeight: '600' },

  // Section headers (hierarchy grouping)
  sectionHeaderRow: {
    flexDirection: 'row', alignItems: 'center', gap: 7,
    paddingHorizontal: 16, marginTop: 16, marginBottom: 2,
  },
  sectionHeader: { fontSize: 13.5, fontWeight: '800', color: MC.text, letterSpacing: 0.2 },
  sectionSpacer: {
    height: 1, backgroundColor: MC.border,
    marginTop: 22, marginBottom: 4, marginHorizontal: 16,
  },
  sectionCaption: { fontSize: 11.5, color: MC.sub, paddingHorizontal: 16, marginBottom: 8 },
  sectionCountPill: {
    minWidth: 20, height: 20, borderRadius: 10, backgroundColor: MC.greenBg,
    alignItems: 'center', justifyContent: 'center', paddingHorizontal: 6,
  },
  sectionCountText: { fontSize: 11, fontWeight: '800', color: MC.green },

  // Manager node (collapsible)
  node: { paddingVertical: 4 },
  nodeHead: { flexDirection: 'row', alignItems: 'center', paddingVertical: 8 },
  nodeAvatar: {
    width: 40, height: 40, borderRadius: 20, backgroundColor: MC.greenBg,
    alignItems: 'center', justifyContent: 'center', marginRight: 12,
  },
  nodeAvatarText: { color: MC.green, fontWeight: '800', fontSize: 17 },
  nodeNameRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  nodeName: { fontSize: 15, fontWeight: '800', color: MC.text, flexShrink: 1 },
  mgrTag: {
    flexDirection: 'row', alignItems: 'center', gap: 3,
    backgroundColor: MC.greenBg, borderRadius: 999, paddingHorizontal: 8, paddingVertical: 2,
  },
  mgrTagText: { fontSize: 10.5, fontWeight: '800', color: MC.green },
  nodeSub: { fontSize: 12, color: MC.sub, marginTop: 2 },

  nodeBody: {
    marginTop: 6, marginLeft: 8, paddingLeft: 14,
    borderLeftWidth: 2, borderLeftColor: MC.greenBg,
  },
  featureRow: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    paddingVertical: 11, borderBottomWidth: 1, borderBottomColor: '#F2F3F5',
  },
  featureIcon: {
    width: 30, height: 30, borderRadius: 8, backgroundColor: MC.greenBg,
    alignItems: 'center', justifyContent: 'center',
  },
  featureLabel: { flex: 1, fontSize: 13.5, fontWeight: '700', color: MC.text },
  featureCount: {
    fontSize: 12, fontWeight: '800', color: MC.green,
    backgroundColor: MC.greenBg, borderRadius: 999, paddingHorizontal: 8, paddingVertical: 1, marginRight: 4,
  },

  memberWrap: { paddingVertical: 4, paddingLeft: 6 },
  memberLoading: { paddingVertical: 14, alignItems: 'flex-start' },
  memberRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 7 },
  memberDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: MC.green, marginLeft: 2 },
  memberName: { fontSize: 13, fontWeight: '700', color: MC.text },
  memberSub: { fontSize: 11, color: MC.sub, marginTop: 1 },
  memberInactive: { fontSize: 10.5, fontWeight: '800', color: MC.red },
  memberEmpty: { fontSize: 12, color: MC.sub, paddingVertical: 10 },
  openTeamBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    paddingVertical: 10, marginTop: 2,
  },
  openTeamText: { fontSize: 12.5, fontWeight: '800', color: MC.green },

  // Direct reports mini-list
  directRow: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    paddingVertical: 9, borderBottomWidth: 1, borderBottomColor: '#F2F3F5',
  },
  nodeAvatarSm: {
    width: 32, height: 32, borderRadius: 16, backgroundColor: MC.greenBg,
    alignItems: 'center', justifyContent: 'center',
  },
  nodeAvatarTextSm: { color: MC.green, fontWeight: '800', fontSize: 14 },
  directName: { fontSize: 13.5, fontWeight: '700', color: MC.text },
  directSub: { fontSize: 11.5, color: MC.sub, marginTop: 1 },

  navCard: { flexDirection: 'row', alignItems: 'center' },
  navIcon: {
    width: 46, height: 46, borderRadius: 12,
    alignItems: 'center', justifyContent: 'center', marginRight: 12,
  },
  navTitle: { fontSize: 15.5, fontWeight: '800', color: MC.text },
  navDesc: { fontSize: 12.5, color: MC.sub, marginTop: 2 },
  badge: {
    minWidth: 22, height: 22, borderRadius: 11, backgroundColor: MC.red,
    alignItems: 'center', justifyContent: 'center', paddingHorizontal: 6, marginRight: 6,
  },
  badgeText: { color: '#fff', fontSize: 11, fontWeight: '800' },
});
