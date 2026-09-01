import React, { useCallback, useState } from 'react';
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
  Alert,
} from 'react-native';
import { premiumAlert } from '../../services/premiumAlert';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useLocalSearchParams } from 'expo-router';
import ScreenErrorBoundary from '../../components/ScreenErrorBoundary';
import { ManagerHeader, Card, Loading, EmptyState, MC } from '../../components/manager/ManagerUI';
import { managerAPI } from '../../services/api';

const CATEGORIES = ['general', 'holiday', 'policy', 'event'];

function fmtDate(v: any) {
  try {
    const d = new Date(v);
    if (isNaN(d.getTime())) return '';
    return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
  } catch { return ''; }
}

/**
 * Manager team announcements — post, list, and delete announcements that
 * ONLY the manager's direct team sees (backend scopes by audienceUserIds).
 */
function ManagerAnnouncements() {
  const insets = useSafeAreaInsets();
  const params = useLocalSearchParams<{ managerId?: string; managerName?: string; scope?: string }>();
  const managerId   = typeof params?.managerId   === 'string' ? params.managerId   : undefined;
  const managerName = typeof params?.managerName === 'string' ? params.managerName : '';
  const scope: 'direct' | undefined = params?.scope === 'direct' ? 'direct' : undefined;
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [items, setItems] = useState<any[]>([]);
  const [err, setErr] = useState('');

  const [composing, setComposing] = useState(false);
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [category, setCategory] = useState('general');
  const [posting, setPosting] = useState(false);

  // Audience picker (senior managers only). Each option maps to a backend
  // scope: whole hierarchy (default), direct reports only (scope='direct'), or
  // a specific sub-manager's team (managerId). Empty for a plain manager or
  // when this screen was opened already scoped to one manager.
  type AudienceOpt = { key: string; label: string; count: number; managerId?: string; scope?: 'direct' };
  const [audiences, setAudiences] = useState<AudienceOpt[]>([]);
  const [audienceKey, setAudienceKey] = useState<string>('all');

  const load = useCallback(async () => {
    setErr('');
    setLoading(true);
    try {
      const res = await managerAPI.myAnnouncements();
      setItems(res?.data?.items || []);
    } catch (e: any) {
      setErr(e?.response?.data?.message || e?.message || 'Could not load announcements.');
      setItems([]);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  // Build the audience options for a senior manager (has sub-managers). Skipped
  // when the screen is already scoped to one manager (opened from a node).
  const loadAudiences = useCallback(async () => {
    if (managerId) { setAudiences([]); return; }
    try {
      const [teamRes, hierRes] = await Promise.all([
        managerAPI.team(),
        managerAPI.hierarchy(),
      ]);
      const subs: any[]   = hierRes?.data?.managers || [];
      const direct: any[] = hierRes?.data?.directReports || [];
      if (subs.length === 0) { setAudiences([]); return; }
      const fullCount   = teamRes?.data?.count ?? 0;
      const directCount = subs.length + direct.length;
      const opts: AudienceOpt[] = [
        { key: 'all',    label: 'My whole hierarchy', count: fullCount },
        { key: 'direct', label: 'My direct reports',  count: directCount, scope: 'direct' },
        ...subs.map((m) => ({
          key: String(m._id),
          label: `${m.name}'s team`,
          count: m.teamCount ?? 0,
          managerId: String(m._id),
        })),
      ];
      setAudiences(opts);
      // Default to the scope this screen was opened with (the "Your own team"
      // card passes scope='direct'); otherwise the whole hierarchy.
      setAudienceKey(scope === 'direct' ? 'direct' : 'all');
    } catch { setAudiences([]); }
  }, [managerId, scope]);

  React.useEffect(() => { load(); }, [load]);
  React.useEffect(() => { loadAudiences(); }, [loadAudiences]);
  const onRefresh = () => { setRefreshing(true); load(); loadAudiences(); };

  const openCompose = () => { setTitle(''); setBody(''); setCategory('general'); setComposing(true); };
  const closeCompose = () => { if (!posting) setComposing(false); };

  const post = async () => {
    if (!title.trim() || !body.trim()) {
      premiumAlert('Missing fields', 'Please add a title and a message.');
      return;
    }
    setPosting(true);
    try {
      const sel = audiences.find((a) => a.key === audienceKey);
      await managerAPI.postAnnouncement({
        title: title.trim(),
        body: body.trim(),
        category,
        // Explicit managerId param (opened from a node) wins; otherwise the
        // chosen audience decides (a sub-manager's team, or direct-only scope).
        managerId: managerId ?? sel?.managerId,
        scope: sel?.scope,
      });
      setComposing(false);
      load();
    } catch (e: any) {
      premiumAlert('Could not post', e?.response?.data?.message || e?.message || 'Please try again.');
    } finally {
      setPosting(false);
    }
  };

  const confirmDelete = (row: any) => {
    premiumAlert('Delete announcement', `Remove "${row.title}"? Your team will no longer see it.`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: async () => {
          try {
            await managerAPI.deleteAnnouncement(row._id);
            setItems((cur) => cur.filter((r) => r._id !== row._id));
          } catch (e: any) {
            premiumAlert('Could not delete', e?.response?.data?.message || e?.message || 'Please try again.');
          }
        },
      },
    ]);
  };

  return (
    <View style={[styles.screen, { paddingBottom: insets.bottom }]}>
      <ManagerHeader
        title="Announcements"
        subtitle={managerName ? `Posting to ${managerName}'s team` : 'Posts your team sees'}
        right={
          <TouchableOpacity onPress={openCompose} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
            <Ionicons name="add-circle" size={26} color="#fff" />
          </TouchableOpacity>
        }
      />

      {loading ? (
        <Loading label="Loading announcements…" />
      ) : (
        <ScrollView
          contentContainerStyle={{ paddingBottom: 24 }}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} colors={[MC.green]} />}
        >
          {!!err && (
            <Card style={{ backgroundColor: MC.redBg }}>
              <Text style={{ color: MC.red, fontSize: 13 }}>{err}</Text>
            </Card>
          )}

          {items.length === 0 && !err ? (
            <EmptyState
              icon="megaphone-outline"
              title="No announcements yet"
              hint="Tap + to post an update to your team."
            />
          ) : (
            items.map((a) => (
              <Card key={a._id}>
                <View style={styles.rowTop}>
                  <View style={styles.catPill}>
                    <Text style={styles.catText}>{String(a.category || 'general').toUpperCase()}</Text>
                  </View>
                  <Text style={styles.date}>{fmtDate(a.createdAt)}</Text>
                  <TouchableOpacity onPress={() => confirmDelete(a)} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                    <Ionicons name="trash-outline" size={18} color={MC.red} />
                  </TouchableOpacity>
                </View>
                <Text style={styles.title}>{a.title}</Text>
                <Text style={styles.body}>{a.body}</Text>
                <Text style={styles.audience}>
                  <Ionicons name="people-outline" size={12} color={MC.sub} />{' '}
                  Sent to {Array.isArray(a.audienceUserIds) ? a.audienceUserIds.length : 0} team member(s)
                </Text>
              </Card>
            ))
          )}
        </ScrollView>
      )}

      {/* Compose modal */}
      <Modal visible={composing} transparent animationType="slide" onRequestClose={closeCompose}>
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={styles.modalWrap}>
          <TouchableOpacity style={styles.modalBackdrop} activeOpacity={1} onPress={closeCompose} />
          <View style={[styles.sheet, { paddingBottom: insets.bottom + 22 }]}>
            <View style={styles.sheetHandle} />
            <Text style={styles.sheetTitle}>
              {managerName ? `Post to ${managerName}'s team` : 'New announcement'}
            </Text>
            {audiences.length > 0 && (
              <Text style={styles.sheetSub}>Choose who receives it</Text>
            )}

            <Text style={styles.fieldLabel}>Category</Text>
            <View style={styles.catRow}>
              {CATEGORIES.map((c) => (
                <TouchableOpacity
                  key={c}
                  style={[styles.catChip, category === c && styles.catChipActive]}
                  onPress={() => setCategory(c)}
                >
                  <Text style={[styles.catChipText, category === c && styles.catChipTextActive]}>
                    {c.charAt(0).toUpperCase() + c.slice(1)}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>

            <Text style={styles.fieldLabel}>Title</Text>
            <TextInput
              style={styles.input}
              value={title}
              onChangeText={setTitle}
              placeholder="Short headline"
              placeholderTextColor="#B7B7B7"
              maxLength={120}
            />

            <Text style={[styles.fieldLabel, { marginTop: 12 }]}>Message</Text>
            <TextInput
              style={[styles.input, styles.inputMultiline]}
              value={body}
              onChangeText={setBody}
              placeholder="What do you want your team to know?"
              placeholderTextColor="#B7B7B7"
              multiline
              maxLength={800}
            />

            {audiences.length > 0 && (
              <>
                <Text style={[styles.fieldLabel, { marginTop: 14 }]}>Audience</Text>
                <View style={{ gap: 8 }}>
                  {audiences.map((a) => {
                    const active = audienceKey === a.key;
                    return (
                      <TouchableOpacity
                        key={a.key}
                        style={[styles.audOpt, active && styles.audOptActive]}
                        activeOpacity={0.8}
                        onPress={() => setAudienceKey(a.key)}
                      >
                        <View style={[styles.radio, active && styles.radioActive]}>
                          {active && <View style={styles.radioDot} />}
                        </View>
                        <Text style={[styles.audLabel, active && styles.audLabelActive]} numberOfLines={1}>
                          {a.label}
                        </Text>
                        <Text style={styles.audCount}>{a.count}</Text>
                      </TouchableOpacity>
                    );
                  })}
                </View>
              </>
            )}

            <View style={styles.sheetBtns}>
              <TouchableOpacity style={styles.cancelBtn} onPress={closeCompose} disabled={posting}>
                <Text style={styles.cancelText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.confirmBtn} onPress={post} disabled={posting}>
                {posting ? <ActivityIndicator color="#fff" /> : <Text style={styles.confirmText}>Post</Text>}
              </TouchableOpacity>
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </View>
  );
}

export default function ManagerAnnouncementsScreen() {
  return (
    <ScreenErrorBoundary name="ManagerAnnouncements">
      <ManagerAnnouncements />
    </ScreenErrorBoundary>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: MC.bg },
  rowTop: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 8 },
  catPill: { backgroundColor: MC.greenBg, paddingHorizontal: 8, paddingVertical: 3, borderRadius: 6 },
  catText: { fontSize: 10, fontWeight: '800', color: MC.green },
  date: { flex: 1, fontSize: 11.5, color: MC.sub },
  title: { fontSize: 15, fontWeight: '800', color: MC.text, marginBottom: 4 },
  body: { fontSize: 13, color: '#374151', lineHeight: 19 },
  audience: { fontSize: 11.5, color: MC.sub, marginTop: 10 },

  modalWrap: { flex: 1, justifyContent: 'flex-end' },
  modalBackdrop: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0,0,0,0.4)' },
  sheet: {
    backgroundColor: '#fff', borderTopLeftRadius: 22, borderTopRightRadius: 22,
    paddingHorizontal: 20, paddingTop: 10, paddingBottom: 28,
  },
  sheetHandle: { alignSelf: 'center', width: 40, height: 4, borderRadius: 2, backgroundColor: '#DADCE0', marginBottom: 14 },
  sheetTitle: { fontSize: 17, fontWeight: '800', color: MC.text, marginBottom: 2 },
  sheetSub: { fontSize: 12.5, color: MC.sub, marginBottom: 14 },
  fieldLabel: { fontSize: 12.5, fontWeight: '700', color: MC.text, marginBottom: 6 },

  // Audience radio options
  audOpt: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    paddingHorizontal: 12, paddingVertical: 11, borderRadius: 12,
    borderWidth: 1.4, borderColor: MC.border, backgroundColor: '#fff',
  },
  audOptActive: { borderColor: MC.green, backgroundColor: MC.greenBg },
  radio: {
    width: 18, height: 18, borderRadius: 9, borderWidth: 2, borderColor: '#C4C9CF',
    alignItems: 'center', justifyContent: 'center',
  },
  radioActive: { borderColor: MC.green },
  radioDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: MC.green },
  audLabel: { flex: 1, fontSize: 13.5, fontWeight: '700', color: MC.text },
  audLabelActive: { color: MC.green },
  audCount: {
    fontSize: 12, fontWeight: '800', color: MC.sub,
    backgroundColor: '#F1F3F5', borderRadius: 999, paddingHorizontal: 8, paddingVertical: 1,
  },
  catRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 6 },
  catChip: { paddingHorizontal: 14, paddingVertical: 7, borderRadius: 999, borderWidth: 1, borderColor: MC.border, backgroundColor: '#fff' },
  catChipActive: { borderColor: MC.green, backgroundColor: MC.greenBg },
  catChipText: { fontSize: 12.5, color: MC.sub, fontWeight: '600' },
  catChipTextActive: { color: MC.green, fontWeight: '800' },
  input: {
    borderWidth: 1, borderColor: MC.border, backgroundColor: '#FAFAFA',
    borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10, fontSize: 14, color: MC.text,
  },
  inputMultiline: { minHeight: 96, textAlignVertical: 'top' },
  sheetBtns: { flexDirection: 'row', gap: 12, marginTop: 18 },
  cancelBtn: { flex: 1, paddingVertical: 13, borderRadius: 10, alignItems: 'center', backgroundColor: '#F1F1F1' },
  cancelText: { fontSize: 14, fontWeight: '700', color: MC.sub },
  confirmBtn: { flex: 1.4, paddingVertical: 13, borderRadius: 10, alignItems: 'center', backgroundColor: MC.green },
  confirmText: { fontSize: 14, fontWeight: '800', color: '#fff' },
});
