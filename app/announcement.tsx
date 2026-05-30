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
              {visible.map((a, idx) => {
                // HRMS may post with capitalised categories ('General',
                // 'HR', 'Policy', 'Event', etc.). Normalize to the lowercase
                // enum the mobile theme map expects, and fall back to
                // 'general' when no theme exists for the value.
                const raw = String(a.category || 'general').toLowerCase();
                const cat = (raw.includes('holiday') ? 'holiday'
                          :  raw.includes('policy')  ? 'policy'
                          :  raw.includes('event')   ? 'event'
                          :                             'general') as Category;
                const theme = CATEGORY_THEME[cat];
                const isExpanded = expandedId === a._id;
                const isFeatured = idx === 0 && filter === 'all';

                return (
                  <TouchableOpacity
                    key={a._id}
                    onPress={() => setExpandedId(isExpanded ? null : a._id)}
                    activeOpacity={0.85}
                    style={[
                      styles.card,
                      isFeatured && styles.cardFeatured,
                      { borderLeftColor: theme.bg },
                    ]}
                  >
                    {/* Category badge — top-right */}
                    <View style={[styles.catBadge, { backgroundColor: theme.bgSoft }]}>
                      <Text style={[styles.catBadgeText, { color: theme.fg }]}>
                        {theme.label}
                      </Text>
                    </View>

                    {/* Featured ribbon for the first item in "All" */}
                    {isFeatured && (
                      <View style={styles.featuredRibbon}>
                        <Ionicons name="star" size={10} color="#FFFFFF" />
                        <Text style={styles.featuredRibbonText}>LATEST</Text>
                      </View>
                    )}

                    <View style={styles.cardRow}>
                      <View style={[styles.iconCircle, { backgroundColor: theme.bgSoft }]}>
                        <CategoryIcon cat={cat} size={20} />
                      </View>

                      <View style={{ flex: 1, marginLeft: 12 }}>
                        <Text style={[styles.cardTitle, isFeatured && { fontSize: 15 }]}>
                          {a.title}
                        </Text>
                        <Text
                          style={styles.cardBody}
                          numberOfLines={isExpanded ? undefined : 3}
                        >
                          {a.body}
                        </Text>

                        <View style={styles.metaRow}>
                          <View style={styles.metaLeft}>
                            <View style={styles.metaAvatar}>
                              <Text style={styles.metaAvatarText}>
                                {(a.postedBy || 'HR').slice(0, 1).toUpperCase()}
                              </Text>
                            </View>
                            <Text style={styles.metaText}>
                              {a.postedBy || 'HR'}
                            </Text>
                            <Text style={styles.metaDot}>·</Text>
                            <Text style={styles.metaText}>
                              {relativeTime(a.createdAt)}
                            </Text>
                          </View>
                          <Feather
                            name={isExpanded ? 'chevron-up' : 'chevron-down'}
                            size={16}
                            color="#9E9E9E"
                          />
                        </View>
                      </View>
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
  emptyTitle: { fontSize: 15, fontWeight: '700', color: '#333', marginBottom: 4 },
  emptyBody:  { fontSize: 12.5, color: '#888', textAlign: 'center', lineHeight: 18 },

  /* Card */
  card: {
    backgroundColor: '#FFFFFF',
    borderRadius: 14,
    borderLeftWidth: 4,
    borderTopWidth: 1,
    borderRightWidth: 1,
    borderBottomWidth: 1,
    borderTopColor: '#F0F0F0',
    borderRightColor: '#F0F0F0',
    borderBottomColor: '#F0F0F0',
    paddingVertical: 14,
    paddingHorizontal: 14,
    marginBottom: 12,
    position: 'relative',
  },
  cardFeatured: {
    shadowColor: '#000',
    shadowOpacity: 0.07,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 4 },
    elevation: 2,
    backgroundColor: '#FFFFFF',
  },
  cardRow: { flexDirection: 'row', alignItems: 'flex-start' },
  iconCircle: {
    width: 42, height: 42, borderRadius: 21,
    alignItems: 'center', justifyContent: 'center',
  },
  cardTitle: {
    fontSize: 14,
    fontWeight: '800',
    color: '#1A1A1A',
    paddingRight: 72, /* room for the category badge */
  },
  cardBody: {
    fontSize: 12.5,
    color: '#5A5A5A',
    marginTop: 6,
    lineHeight: 18,
  },

  catBadge: {
    position: 'absolute',
    top: 12, right: 12,
    paddingHorizontal: 9,
    paddingVertical: 3,
    borderRadius: 10,
  },
  catBadgeText: { fontSize: 10.5, fontWeight: '800', letterSpacing: 0.3 },

  featuredRibbon: {
    position: 'absolute',
    top: -1, left: -1,
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: GREEN_SOFT,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderTopLeftRadius: 12,
    borderBottomRightRadius: 10,
  },
  featuredRibbonText: {
    color: '#FFFFFF',
    fontSize: 9.5,
    fontWeight: '800',
    letterSpacing: 0.7,
    marginLeft: 4,
  },

  metaRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: 10,
  },
  metaLeft: { flexDirection: 'row', alignItems: 'center' },
  metaAvatar: {
    width: 18, height: 18, borderRadius: 9,
    backgroundColor: '#E8F5E9',
    alignItems: 'center', justifyContent: 'center',
  },
  metaAvatarText: { color: GREEN, fontSize: 9, fontWeight: '800' },
  metaText: { fontSize: 11, color: '#7A7A7A', fontWeight: '600', marginLeft: 5 },
  metaDot:  { fontSize: 11, color: '#BBB', marginHorizontal: 5 },
});
