/**
 * Announcements screen — full list with category filter, pull-to-refresh,
 * and expandable cards.
 *
 * Entry points:
 *   - Home page "View All" button   (app/(tabs)/index.tsx)
 *   - Side drawer "Announcement"    (components/SideDrawer.tsx)
 *
 * Data source: GET /api/announcement (announcementAPI.list)
 *
 * Design notes:
 *   - Each card has a colored category badge + icon, body preview (3 lines)
 *     and tap-to-expand for the full body.
 *   - Filter chips run along the top so the user can narrow to holidays
 *     only, policies only, etc.
 *   - Time labels render relative ("2h ago", "yesterday") via a tiny helper.
 *   - The featured (most recent) announcement gets a slightly bolder card
 *     so the screen never looks like a wall of identical boxes.
 */

import React, { useCallback, useEffect, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  RefreshControl,
  ActivityIndicator,
  Image,
  Linking,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons, Feather, MaterialCommunityIcons } from '@expo/vector-icons';
import { router, useFocusEffect } from 'expo-router';
import { announcementAPI } from '../services/api';

const GREEN      = '#2E7D32';
const GREEN_SOFT = '#43A047';

type Category = 'holiday' | 'policy' | 'event' | 'general';
type Announcement = {
  _id: string;
  title: string;
  body: string;
  category?: Category;
  postedBy?: string;
  createdAt?: string;
};

const CATEGORY_THEME: Record<
  Category,
  { bg: string; bgSoft: string; fg: string; iconName: string; iconLib: 'ion' | 'mci' | 'feather'; label: string }
> = {
  holiday: {
    bg:       '#FF8A65',
    bgSoft:   '#FFE0CC',
    fg:       '#BF360C',
    iconName: 'calendar-outline',
    iconLib:  'ion',
    label:    'Holiday',
  },
  policy: {
    bg:       '#1976D2',
    bgSoft:   '#BBDEFB',
    fg:       '#0D47A1',
    iconName: 'file-document-outline',
    iconLib:  'mci',
    label:    'Policy',
  },
  event: {
    bg:       '#7B1FA2',
    bgSoft:   '#E1BEE7',
    fg:       '#4A148C',
    iconName: 'gift-outline',
    iconLib:  'ion',
    label:    'Event',
  },
  general: {
    bg:       '#2E7D32',
    bgSoft:   '#C8E6C9',
    fg:       '#1B5E20',
    iconName: 'megaphone-outline',
    iconLib:  'ion',
    label:    'General',
  },
};

function CategoryIcon({ cat, size = 18 }: { cat: Category; size?: number }) {
  const t = CATEGORY_THEME[cat] || CATEGORY_THEME.general;
  if (t.iconLib === 'mci') {
    return <MaterialCommunityIcons name={t.iconName as any} size={size} color={t.fg} />;
  }
  if (t.iconLib === 'feather') {
    return <Feather name={t.iconName as any} size={size} color={t.fg} />;
  }
  return <Ionicons name={t.iconName as any} size={size} color={t.fg} />;
}

/** "2h ago", "yesterday", "Mar 18". Short, human-friendly. */
function relativeTime(iso?: string): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '';
  const diffSec = Math.floor((Date.now() - d.getTime()) / 1000);
  if (diffSec < 60)     return 'just now';
  if (diffSec < 3600)   return `${Math.floor(diffSec / 60)}m ago`;
  if (diffSec < 86400)  return `${Math.floor(diffSec / 3600)}h ago`;
  if (diffSec < 172800) return 'yesterday';
  if (diffSec < 604800) return `${Math.floor(diffSec / 86400)}d ago`;
  return (() => { const __d = d; if (!__d || isNaN(__d.getTime?.() ?? new Date(__d).getTime())) return '—'; const __dd = (__d instanceof Date) ? __d : new Date(__d); const __day = String(__dd.getDate()).padStart(2,'0'); const __mo  = String(__dd.getMonth()+1).padStart(2,'0'); const __yr  = __dd.getFullYear(); return __day + '-' + __mo + '-' + __yr; })();
}

const FILTERS: Array<{ key: Category | 'all'; label: string }> = [
  { key: 'all',     label: 'All'      },
  { key: 'holiday', label: 'Holidays' },
  { key: 'policy',  label: 'Policies' },
  { key: 'event',   label: 'Events'   },
  { key: 'general', label: 'General'  },
];

export default function AnnouncementScreen() {
  const [items, setItems]           = useState<Announcement[]>([]);
  const [loading, setLoading]       = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [filter, setFilter]         = useState<Category | 'all'>('all');
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [error, setError]           = useState('');

  const fetchItems = useCallback(async () => {
    try {
      setError('');
      const res = await announcementAPI.list(50);
      setItems(Array.isArray(res.data) ? res.data : []);
    } catch (e: any) {
      setError(e?.response?.data?.message || 'Could not load announcements.');
    }
  }, []);

  useEffect(() => {
    setLoading(true);
    fetchItems().finally(() => setLoading(false));
  }, [fetchItems]);

  // Re-fetch when the user comes back to this tab so new posts show up.
  useFocusEffect(
    useCallback(() => {
      fetchItems();
    }, [fetchItems])
  );

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await fetchItems();
    setRefreshing(false);
  }, [fetchItems]);

  // Categories were removed at HR's request — show everything in one
  // flat list, newest first. `filter` state is kept so the rest of the
  // file (analytics, badge colour, etc.) still has a defined value, but
  // it's effectively always 'all' now.
  const visible = items;

  return (
    <View style={styles.root}>
      <SafeAreaView edges={['top']} style={{ flex: 1 }}>

        {/* ─── Header ──────────────────────────────────────────────────── */}
        <View style={styles.header}>
          <TouchableOpacity
            style={styles.backBtn}
            onPress={() => router.back()}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          >
            <Ionicons name="arrow-back" size={22} color="#FFFFFF" />
          </TouchableOpacity>
          <View style={styles.headerCenter}>
            <Text style={styles.headerTitle}>Announcements</Text>
            <View style={styles.headerSubRow}>
              <Ionicons name="megaphone-outline" size={13} color="rgba(255,255,255,0.85)" />
              <Text style={styles.headerSub}>Latest company updates &amp; notices</Text>
            </View>
          </View>
          {/* Count chip — small visual anchor on the right */}
          <View style={styles.countChip}>
            <Text style={styles.countChipText}>{items.length}</Text>
          </View>
        </View>

        {/* ─── Body card ──────────────────────────────────────────────── */}
        <View style={styles.body}>

          {/* Category filter chips removed — HR asked for a single flat
              list, no All / Holidays / Policies / Events / General tabs. */}

          {loading ? (
            <View style={styles.centered}>
              <ActivityIndicator color={GREEN} />
              <Text style={styles.dimText}>Loading announcements…</Text>
            </View>
          ) : error ? (
            <View style={styles.centered}>
              <Ionicons name="cloud-offline-outline" size={48} color="#CCC" />
              <Text style={styles.dimText}>{error}</Text>
            </View>
          ) : visible.length === 0 ? (
            <View style={styles.centered}>
              <View style={styles.emptyCircle}>
                <Ionicons name="megaphone-outline" size={32} color="#9E9E9E" />
              </View>
              <Text style={styles.emptyTitle}>No announcements yet</Text>
              <Text style={styles.emptyBody}>
                {filter === 'all'
                  ? 'When HR posts updates they will show up here.'
                  : `No ${FILTERS.find((f) => f.key === filter)?.label.toLowerCase()} posted yet.`}
              </Text>
            </View>
          ) : (
            <ScrollView
              showsVerticalScrollIndicator={false}
              contentContainerStyle={{ paddingHorizontal: 18, paddingBottom: 30 }}
              refreshControl={
                <RefreshControl
                  refreshing={refreshing}
                  onRefresh={onRefresh}
                  tintColor={GREEN}
                />
              }
            >
              {visible.map((a) => {
                const isExpanded = expandedId === a._id;
                // Categories were removed at HR's request (Jun 2026 brief —
                // match the Figma). Cards are now uniform white tiles with
                // title + body + "Posted by HR · time-ago" footer.
                return (
                  <TouchableOpacity
                    key={a._id}
                    onPress={() => setExpandedId(isExpanded ? null : a._id)}
                    activeOpacity={0.85}
                    style={styles.card}
                  >
                    <View style={{ width: '100%' }}>
                      <Text style={styles.cardTitle}>{a.title}</Text>
                      <Text
                        style={styles.cardBody}
                        numberOfLines={isExpanded ? undefined : 2}
                      >
                        {a.body}
                      </Text>

                        {/* Attachments — images preview inline plus an
                            explicit "View document" button (tap = open in
                            the system viewer). Non-image files surface as
                            a row with the filename and a tappable "View"
                            chip. HR uploads them from HRMS; we render
                            whatever lands on the shared announcement
                            doc's `attachments` array. */}
                        {Array.isArray((a as any).attachments) && (a as any).attachments.length > 0 && (
                          <View style={{ marginTop: 10, gap: 10 }}>
                            {(a as any).attachments.map((att: any, i: number) => {
                              const src = att.dataBase64
                                ? `data:${att.mimeType || 'application/octet-stream'};base64,${att.dataBase64}`
                                : (att.url || '');
                              if (!src) return null;
                              const isImage = String(att.mimeType || '').startsWith('image/') ||
                                              /\.(png|jpe?g|gif|webp|svg)$/i.test(att.name || '');
                              const sizeLbl = att.size ? ` (${Math.round(att.size / 1024)} KB)` : '';
                              if (isImage) {
                                return (
                                  <View key={i} style={{ gap: 6 }}>
                                    <Image
                                      source={{ uri: src }}
                                      style={{ width: '100%', height: 200, borderRadius: 8, backgroundColor: '#F1F5F9' }}
                                      resizeMode="cover"
                                    />
                                    <TouchableOpacity
                                      onPress={() => Linking.openURL(src).catch(() => {})}
                                      style={{
                                        alignSelf: 'flex-start',
                                        flexDirection: 'row', alignItems: 'center', gap: 6,
                                        paddingVertical: 6, paddingHorizontal: 12,
                                        backgroundColor: '#EFF6FF', borderRadius: 8,
                                        borderWidth: 1, borderColor: '#BFDBFE',
                                      }}
                                    >
                                      <Text style={{ fontSize: 12, color: '#1D4ED8', fontWeight: '700' }}>
                                        View document{sizeLbl}
                                      </Text>
                                    </TouchableOpacity>
                                  </View>
                                );
                              }
                              return (
                                <View
                                  key={i}
                                  style={{
                                    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
                                    paddingVertical: 10, paddingHorizontal: 12,
                                    backgroundColor: '#F8FAFC', borderRadius: 10,
                                    borderWidth: 1, borderColor: '#E2E8F0',
                                  }}
                                >
                                  <Text
                                    style={{ flex: 1, fontSize: 13, color: '#0F172A', fontWeight: '600' }}
                                    numberOfLines={1}
                                  >
                                    📎 {att.name || 'Attachment'}{sizeLbl}
                                  </Text>
                                  <TouchableOpacity
                                    onPress={() => Linking.openURL(src).catch(() => {})}
                                    style={{
                                      flexDirection: 'row', alignItems: 'center', gap: 4,
                                      paddingVertical: 6, paddingHorizontal: 12,
                                      backgroundColor: '#EFF6FF', borderRadius: 8,
                                      borderWidth: 1, borderColor: '#BFDBFE',
                                      marginLeft: 8,
                                    }}
                                  >
                                    <Text style={{ fontSize: 12, color: '#1D4ED8', fontWeight: '700' }}>
                                      View
                                    </Text>
                                  </TouchableOpacity>
                                </View>
                              );
                            })}
                          </View>
                        )}

                      {/* Footer (Jun 2026 Figma): plain text "Posted by HR
                          · 2h ago" — avatar circle dropped to match the
                          flat tile design. No chevron either; tapping
                          the card still expands/collapses the body. */}
                      <Text style={styles.metaFooter}>
                        Posted by {a.postedBy || 'HR'}  ·  {relativeTime(a.createdAt)}
                      </Text>
                    </View>
                  </TouchableOpacity>
                );
              })}
            </ScrollView>
          )}
        </View>
      </SafeAreaView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: GREEN },

  /* Header */
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
  headerCenter: { marginLeft: 6, flex: 1 },
  headerTitle: { color: '#FFFFFF', fontSize: 20, fontWeight: '800' },
  headerSubRow: { flexDirection: 'row', alignItems: 'center', marginTop: 3 },
  headerSub: {
    color: 'rgba(255,255,255,0.92)',
    fontSize: 12,
    marginLeft: 5,
  },
  countChip: {
    backgroundColor: 'rgba(255,255,255,0.22)',
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 12,
    minWidth: 32,
    alignItems: 'center',
  },
  countChipText: {
    color: '#FFFFFF',
    fontSize: 12,
    fontWeight: '800',
  },

  /* Body sheet */
  body: {
    flex: 1,
    backgroundColor: '#FFFFFF',
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    paddingTop: 6,
  },

  /* Filter chip row */
  filterRow: {
    maxHeight: 56,
    flexGrow: 0,
  },
  filterChip: {
    paddingHorizontal: 14,
    paddingVertical: 7,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#E5E5E5',
    marginRight: 8,
    backgroundColor: '#FAFAFA',
  },
  filterChipActive: {
    backgroundColor: GREEN,
    borderColor: GREEN,
  },
  filterChipText: {
    fontSize: 12.5,
    fontWeight: '700',
    color: '#555',
  },

  /* Empty / loading */
  centered: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 70,
    paddingHorizontal: 30,
  },
  dimText: { marginTop: 10, color: '#888', fontSize: 13, textAlign: 'center' },
  emptyCircle: {
    width: 76, height: 76, borderRadius: 38,
    backgroundColor: '#F4F4F4',
    alignItems: 'center', justifyContent: 'center',
    marginBottom: 14,
  },
  emptyTitle: { fontSize: 16, fontWeight: '700', color: '#111', marginBottom: 6, textAlign: 'center' },

  /* Announcement card (Jun 2026 Figma): flat white tile, no colored
     category band, no icon circle, no chevron. Just title + body +
     "Posted by HR · time-ago" footer. */
  card: {
    backgroundColor: '#FFFFFF',
    borderRadius: 12,
    paddingVertical: 14,
    paddingHorizontal: 16,
    marginHorizontal: 16,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: '#EEF1EE',
    shadowColor: '#000',
    shadowOpacity: 0.04,
    shadowOffset: { width: 0, height: 2 },
    shadowRadius: 6,
    elevation: 1,
  },
  cardTitle: {
    fontSize: 15,
    fontWeight: '800',
    color: '#1A1A1A',
    marginBottom: 6,
  },
  cardBody: {
    fontSize: 13,
    color: '#4A4A4A',
    lineHeight: 18,
  },
  metaFooter: {
    marginTop: 14,
    fontSize: 11,
    fontWeight: '600',
    color: '#9A9A9A',
  },
});
