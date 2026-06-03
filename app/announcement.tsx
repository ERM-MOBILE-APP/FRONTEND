/**
 * Announcements screen — redesigned Jun 2026 to mirror the Notifications
 * screen.
 *
 * What changed (vs the old green-banner design):
 *   • Top bar matches notifications.tsx — white background, back button,
 *     centered title with a megaphone icon, mark-all-read button.
 *   • Each announcement renders as a notification-style card: colored
 *     left edge, light-green tint for unread, plain white for read,
 *     title + body + bottom meta row with a small dot + relative time.
 *   • Unread state is tracked per user (Announcement.readBy in the DB).
 *     Tapping a card marks it read for the current user. The screen
 *     also fires markAllRead on mount so the home page bell badge clears.
 *   • Attachments still render inline below the body (images + a "View
 *     document" button for any other mime type) so HR uploads from HRMS
 *     still flow through.
 *
 * Entry points:
 *   - Home page "View All" button   (app/(tabs)/index.tsx)
 *   - Side drawer "Announcement"    (components/SideDrawer.tsx)
 *
 * Data sources:
 *   - GET   /api/announcement                      → list with isRead per row
 *   - PATCH /api/announcement/:id/read             → mark one read
 *   - PATCH /api/announcement/read-all             → mark all read
 */

import React, { useCallback, useEffect, useState } from 'react';
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
  category?: Category;
  postedBy?: string;
  createdAt?: string;
  isRead?: boolean;
  attachments?: Attachment[];
};

// Same edge-colour mapping the notifications screen uses, so the visual
// language between the two screens is identical.
const CATEGORY_EDGE: Record<Category, string> = {
  holiday: '#FF8A65',
  policy:  '#1976D2',
  event:   '#7B1FA2',
  general: '#2E7D32',
};

const GREEN = '#4CAF50';
const GREEN_DEEP = '#2E7D32';

/** "just now", "5m ago", "3h ago", "2d ago" — matches notifications.tsx. */
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

export default function AnnouncementScreen() {
  const [items, setItems]           = useState<Announcement[]>([]);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await announcementAPI.list(50);
      const list = Array.isArray(res?.data) ? (res.data as Announcement[]) : [];
      setItems(list);
    } catch {
      // Silent — keep whatever's on screen; pull-to-refresh retries.
    }
  }, []);

  // On mount: load AND auto-mark-all-read so the home page bell badge
  // clears the moment the user enters this screen. Cards stay visible.
  useEffect(() => {
    (async () => {
      await load();
      try { await announcementAPI.markAllRead(); } catch {}
    })();
  }, [load]);

  // Re-fetch when refocusing the tab so new posts show up.
  useFocusEffect(
    useCallback(() => {
      load();
    }, [load])
  );

  const onRefresh = async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  };

  const markAllRead = async () => {
    try {
      await announcementAPI.markAllRead();
      setItems((prev) => prev.map((a) => ({ ...a, isRead: true })));
    } catch {}
  };

  const openItem = async (a: Announcement) => {
    if (!a.isRead) {
      try { await announcementAPI.markAsRead(a._id); } catch {}
    }
    setItems((prev) => prev.map((x) => (x._id === a._id ? { ...x, isRead: true } : x)));
  };

  return (
    <SafeAreaView edges={['top']} style={styles.safe}>
      {/* TOP BAR — matches notifications.tsx layout exactly */}
      <View style={styles.topBar}>
        <TouchableOpacity
          style={styles.backBtn}
          onPress={() => router.back()}
          activeOpacity={0.7}
        >
          <Ionicons name="arrow-back" size={22} color="#1A1A1A" />
        </TouchableOpacity>

        <View style={styles.titleRow}>
          <Text style={styles.title}>Announcement</Text>
          <Ionicons
            name="megaphone"
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

      {/* LIST */}
      <ScrollView
        contentContainerStyle={{ paddingHorizontal: 16, paddingTop: 8, paddingBottom: 40 }}
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
                <Text style={styles.cardTitle}>{a.title}</Text>
                <Text style={styles.cardBody}>{a.body}</Text>

                {/* Attachments — keep the existing inline render. HR
                    uploads images and the occasional PDF from HRMS;
                    images render directly, other types show a "View"
                    chip that opens in the system viewer. */}
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
                          <View key={i} style={{ gap: 6 }}>
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
                        <View key={i} style={styles.attRow}>
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
                  <View style={styles.metaDot} />
                  <Text style={styles.metaText}>
                    {a.postedBy ? `${a.postedBy} · ` : ''}{formatRelative(a.createdAt)}
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

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#FFFFFF' },

  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 12,
  },
  backBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
  titleRow: {
    flex: 1,
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
  },
  title: { fontSize: 17, fontWeight: '800', color: '#1A1A1A' },
  markAllBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },

  /* Card — identical metrics to notifications.tsx */
  card: {
    backgroundColor: '#FFFFFF',
    borderRadius: 14,
    paddingHorizontal: 14,
    paddingVertical: 14,
    marginBottom: 12,
    borderLeftWidth: 5,
    borderWidth: 1,
    borderColor: '#EEEEEE',
    shadowColor: '#000',
    shadowOpacity: 0.05,
    shadowOffset: { width: 0, height: 2 },
    shadowRadius: 6,
    elevation: 2,
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
    width: 4,
    height: 4,
    borderRadius: 2,
    backgroundColor: GREEN_DEEP,
    marginRight: 6,
  },
  metaText: {
    fontSize: 11,
    color: GREEN_DEEP,
    fontWeight: '600',
  },
  unreadPill: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: GREEN,
    marginLeft: 8,
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
    gap: 4,
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

  emptyBox: {
    alignItems: 'center',
    paddingVertical: 60,
  },
  emptyText: { color: '#777', marginTop: 8, fontSize: 13 },
});
