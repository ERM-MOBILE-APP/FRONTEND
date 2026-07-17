/**
 * Announcements screen — Figma reference (Jun 2026).
 *
 * Design spec (per the user's screenshot):
 *   - White background, top bar with back arrow + centered "Announcements"
 *     title + megaphone icon + mark-all-read button on the right.
 *   - Subtitle line "Latest company updates and important notices" in
 *     muted grey directly below the top bar.
 *   - Cards are rounded, soft-bordered white tiles with a small grey
 *     drop shadow and a slim green left-edge accent stripe. Cards have
 *     a comfortable horizontal margin from the screen edges and a small
 *     vertical gap between them.
 *   - Each card: title (1 line, bold), body (2 lines, grey), footer
 *     "Posted by {who} · {time-ago}" in tiny muted grey text.
 *   - Unread cards get a faint light-green wash; read cards are pure
 *     white. Tap-to-read marks the announcement read for this user.
 */

import React, { useCallback, useEffect, useState, useRef } from 'react';
// #428 — Local error boundary + unmount guards for every setState.
import ScreenErrorBoundary from '../components/ScreenErrorBoundary';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  RefreshControl,
  Image,
  Linking,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { router, useFocusEffect } from 'expo-router';
import { announcementAPI } from '../services/api';

type Category = 'holiday' | 'policy' | 'event' | 'general';
type Attachment = {
  name?: string;
  mimeType?: string;
  size?: number;
  dataBase64?: string;
  url?: string;
};
type Announcement = {
  _id: string;
  title: string;
  body: string;
  // Some HRMS-posted rows have only `description` (the HRMS UI's field
  // name). We accept it as an alias so older announcements still show
  // their content on mobile. See bodyOf() below.
  description?: string;
  content?: string;
  category?: Category;
  postedBy?: string;
  createdAt?: string;
  isRead?: boolean;
  attachments?: Attachment[];
};

/** Read the body text from whichever field the server populated. */
function bodyOf(a: Announcement): string {
  // Prefer `body` (the canonical mobile field) but accept `description`
  // / `content` because HRMS posts have historically used either name.
  // Without this fallback, an announcement created by HRMS before the
  // backend mirrored its `description` into `body` showed a blank card
  // body on mobile — the user saw the title but no content.
  return String(a?.body ?? a?.description ?? a?.content ?? '').trim();
}

const CATEGORY_EDGE: Record<Category, string> = {
  holiday: '#FF8A65',
  policy:  '#1976D2',
  event:   '#7B1FA2',
  general: '#2E7D32',
};

const GREEN = '#4CAF50';
const GREEN_DEEP = '#2E7D32';

function formatRelative(iso?: string): string {
  if (!iso) return '';
  try {
    const diff = Date.now() - new Date(iso).getTime();
    const mins = Math.floor(diff / 60000);
    if (mins < 1) return 'just now';
    if (mins < 60) return `${mins}m ago`;
    const hrs = Math.floor(mins / 60);
    if (hrs < 24) return `${hrs}h ago`;
    const days = Math.floor(hrs / 24);
    if (days < 7) return `${days}d ago`;
    const weeks = Math.floor(days / 7);
    return `${weeks}w ago`;
  } catch {
    return '';
  }
}

function AnnouncementScreenInner() {
  const [items, setItems]           = useState<Announcement[]>([]);
  const [refreshing, setRefreshing] = useState(false);

  // #428 — Every setState guarded against post-unmount fire. This screen
  // has 4 async paths (load, focus-refetch, mark-all-read, mark-one-read)
  // and users tap the back button rapidly.
  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  const load = useCallback(async () => {
    try {
      const res = await announcementAPI.list(50);
      const list = Array.isArray(res?.data) ? (res.data as Announcement[]) : [];
      if (mountedRef.current) setItems(list);
    } catch {
      // Silent — pull-to-refresh retries.
    }
  }, []);

  useEffect(() => {
    (async () => {
      await load();
      try { await announcementAPI.markAllRead(); } catch {}
    })();
  }, [load]);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load])
  );

  const onRefresh = async () => {
    if (mountedRef.current) setRefreshing(true);
    await load();
    if (mountedRef.current) setRefreshing(false);
  };

  const markAllRead = async () => {
    try {
      await announcementAPI.markAllRead();
      if (mountedRef.current) {
        setItems((prev) => prev.map((a) => ({ ...a, isRead: true })));
      }
    } catch {}
  };

  const openItem = async (a: Announcement) => {
    if (!a.isRead) {
      try { await announcementAPI.markAsRead(a._id); } catch {}
    }
    if (mountedRef.current) {
      setItems((prev) => prev.map((x) => (x._id === a._id ? { ...x, isRead: true } : x)));
    }
  };

  return (
    <SafeAreaView edges={['top']} style={styles.safe}>
      {/* TOP BAR */}
      <View style={styles.topBar}>
        <TouchableOpacity
          style={styles.backBtn}
          onPress={() => router.back()}
          activeOpacity={0.7}
        >
          <Ionicons name="arrow-back" size={22} color="#1A1A1A" />
        </TouchableOpacity>

        <View style={styles.titleRow}>
          <Text style={styles.title}>Announcements</Text>
          <Ionicons
            name="megaphone-outline"
            size={18}
            color="#1A1A1A"
            style={{ marginLeft: 6 }}
          />
        </View>

        <TouchableOpacity
          style={styles.markAllBtn}
          onPress={markAllRead}
          activeOpacity={0.7}
        >
          <Ionicons name="checkmark-done" size={20} color={GREEN_DEEP} />
        </TouchableOpacity>
      </View>

      {/* Subtitle */}
      <Text style={styles.subtitle}>Latest company updates and important notices</Text>

      {/* List */}
      <ScrollView
        contentContainerStyle={{ paddingHorizontal: 16, paddingTop: 4, paddingBottom: 40 }}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={GREEN_DEEP} />
        }
        showsVerticalScrollIndicator={false}
      >
        {items.length === 0 ? (
          <View style={styles.emptyBox}>
            <Ionicons name="megaphone-outline" size={36} color="#BDBDBD" />
            <Text style={styles.emptyText}>No announcements yet.</Text>
          </View>
        ) : (
          items.map((a) => {
            const cat = (a.category && CATEGORY_EDGE[a.category]) ? a.category : 'general';
            const edge = CATEGORY_EDGE[cat as Category];
            return (
              <TouchableOpacity
                key={a._id}
                activeOpacity={0.85}
                onPress={() => openItem(a)}
                style={[
                  styles.card,
                  {
                    borderLeftColor: edge,
                    backgroundColor: a.isRead ? '#FFFFFF' : '#F1F8F2',
                  },
                ]}
              >
                {/* Title: allow up to 3 lines so HR can read long subjects
                    fully. Previously fixed at numberOfLines={1} which cut
                    "ERM is live from today. Please make use of it. If y…"
                    mid-sentence. Body still truncates at 2 lines, with
                    the full text available on tap (planned). */}
                <Text style={styles.cardTitle} numberOfLines={3}>{a.title}</Text>
                {!!bodyOf(a) && (
                  <Text style={styles.cardBody} numberOfLines={3}>{bodyOf(a)}</Text>
                )}

                {/* Attachments — images preview inline plus a "View
                    document" chip. Non-image files surface as a row
                    with the filename and a tappable "View" chip. */}
                {Array.isArray(a.attachments) && a.attachments.length > 0 && (
                  <View style={{ marginTop: 10, gap: 10 }}>
                    {a.attachments.map((att, i) => {
                      const src = att.dataBase64
                        ? `data:${att.mimeType || 'application/octet-stream'};base64,${att.dataBase64}`
                        : (att.url || '');
                      if (!src) return null;
                      const isImage = String(att.mimeType || '').startsWith('image/') ||
                                      /\.(png|jpe?g|gif|webp|svg)$/i.test(att.name || '');
                      const sizeLbl = att.size ? ` (${Math.round(att.size / 1024)} KB)` : '';
                      if (isImage) {
                        return (
                          <View key={att.url || att.name || `att-${i}`} style={{ gap: 6 }}>
                            <Image
                              source={{ uri: src }}
                              style={{ width: '100%', height: 180, borderRadius: 8, backgroundColor: '#F1F5F9' }}
                              resizeMode="cover"
                            />
                            <TouchableOpacity
                              onPress={() => Linking.openURL(src).catch(() => {})}
                              style={styles.viewBtn}
                            >
                              <Text style={styles.viewBtnText}>View document{sizeLbl}</Text>
                            </TouchableOpacity>
                          </View>
                        );
                      }
                      return (
                        <View key={att.url || att.name || `att-${i}`} style={styles.attRow}>
                          <Text style={styles.attName} numberOfLines={1}>
                            📎 {att.name || 'Attachment'}{sizeLbl}
                          </Text>
                          <TouchableOpacity
                            onPress={() => Linking.openURL(src).catch(() => {})}
                            style={styles.viewBtn}
                          >
                            <Text style={styles.viewBtnText}>View</Text>
                          </TouchableOpacity>
                        </View>
                      );
                    })}
                  </View>
                )}

                <View style={styles.metaRow}>
                  <Text style={styles.metaText}>
                    {/* #316 — Hardcoded "HR" regardless of postedBy.
                        HR's account is named "tescostructures" in the
                        DB and we don't want that leaking into the UI. */}
                    Posted by HR
                  </Text>
                  <View style={styles.metaDot} />
                  <Text style={styles.metaText}>
                    {formatRelative(a.createdAt)}
                  </Text>
                  {!a.isRead && <View style={styles.unreadPill} />}
                </View>
              </TouchableOpacity>
            );
          })
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

// #428 — Boundary wrapper so a render error inside Announcements stays
// scoped to this screen.
export default function AnnouncementScreen() {
  return (
    <ScreenErrorBoundary name="Announcements">
      <AnnouncementScreenInner />
    </ScreenErrorBoundary>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#FFFFFF' },

  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 12,
  },
  backBtn: {
    width: 36, height: 36, borderRadius: 18,
    alignItems: 'center', justifyContent: 'center',
  },
  titleRow: {
    flex: 1,
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
  },
  title: { fontSize: 17, fontWeight: '800', color: '#1A1A1A' },
  markAllBtn: {
    width: 36, height: 36, borderRadius: 18,
    alignItems: 'center', justifyContent: 'center',
  },

  /* Subtitle below the top bar */
  subtitle: {
    fontSize: 12.5,
    color: '#9A9A9A',
    paddingHorizontal: 18,
    paddingTop: 2,
    paddingBottom: 10,
    fontWeight: '500',
  },

  /* Card — Figma-matched: rounded white tile with soft border, light
     shadow, slim coloured left-edge stripe. Horizontal screen padding
     comes from the ScrollView (paddingHorizontal: 16). */
  card: {
    backgroundColor: '#FFFFFF',
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 12,
    marginBottom: 10,
    borderWidth: 1,
    borderColor: '#E5E7EB',
    borderLeftWidth: 4,
    shadowColor: '#000',
    shadowOpacity: 0.04,
    shadowOffset: { width: 0, height: 2 },
    shadowRadius: 4,
    elevation: 1,
  },
  cardTitle: {
    fontSize: 14,
    fontWeight: '800',
    color: '#1A1A1A',
  },
  cardBody: {
    fontSize: 12.5,
    color: '#555',
    marginTop: 4,
    lineHeight: 18,
  },

  metaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 10,
  },
  metaDot: {
    width: 3,
    height: 3,
    borderRadius: 1.5,
    backgroundColor: '#9CA3AF',
    marginHorizontal: 6,
  },
  metaText: {
    fontSize: 11,
    color: '#9A9A9A',
    fontWeight: '500',
  },
  unreadPill: {
    width: 7,
    height: 7,
    borderRadius: 3.5,
    backgroundColor: GREEN,
    marginLeft: 'auto',
  },

  /* Attachments */
  attRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 10,
    paddingHorizontal: 12,
    backgroundColor: '#F8FAFC',
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#E2E8F0',
  },
  attName: { flex: 1, fontSize: 13, color: '#0F172A', fontWeight: '600' },
  viewBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 6,
    paddingHorizontal: 12,
    backgroundColor: '#EFF6FF',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#BFDBFE',
    marginLeft: 8,
    alignSelf: 'flex-start',
  },
  viewBtnText: { fontSize: 12, color: '#1D4ED8', fontWeight: '700' },

  emptyBox: { alignItems: 'center', paddingVertical: 60 },
  emptyText: { color: '#777', marginTop: 8, fontSize: 13 },
});
