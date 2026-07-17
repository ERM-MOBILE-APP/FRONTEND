import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
  RefreshControl,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { notificationAPI } from '../services/api';
// #428 — Per-screen boundary so a render error inside the list (bad
// notification payload with an unexpected `n.type`, malformed date,
// etc.) is caught locally and shows a "Try again" card instead of
// bubbling to RootErrorBoundary and tearing down the whole app.
import ScreenErrorBoundary from '../components/ScreenErrorBoundary';

type NotificationItem = {
  _id: string;
  title: string;
  body: string;
  type: string;
  isRead: boolean;
  link?: string;
  createdAt: string;
};

const TYPE_EDGE: Record<string, string> = {
  leave: '#4CAF50',
  attendance: '#1565C0',
  allowance: '#FFA726',
  payslip: '#6A1B9A',
  announcement: '#2E7D32',
  general: '#9E9E9E',
};

function NotificationsScreenInner() {
  // Start empty — only show real server-side notifications.
  const [items, setItems] = useState<NotificationItem[]>([]);
  const [refreshing, setRefreshing] = useState(false);

  // #428 — Guard every setState behind mountedRef. The Notifications
  // screen is reachable via the home-page bell (rapid taps happen) and
  // any of its 3 async paths (initial load, pull-to-refresh, mark-read)
  // could fire setState after the user backs out. Under Hermes RN 0.81
  // that escalates to SIGTERM. This closes the crash class for this
  // screen entirely.
  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  const load = useCallback(async () => {
    try {
      const res = await notificationAPI.list({ limit: 50 });
      const list = res?.data?.items;
      // Always trust the server — set whatever it returned (including [])
      // so notifications the user already read or that were deleted
      // disappear correctly.
      if (mountedRef.current) setItems(Array.isArray(list) ? list : []);
    } catch {
      // Network/server error — leave whatever's currently on screen alone.
    }
  }, []);

  // On screen mount: load notifications AND automatically mark them all
  // read so the bell badge on the home page clears as soon as the user
  // opens this screen. We still keep the list items visible — only the
  // unread DOT is hidden — so they can scroll through everything.
  useEffect(() => {
    (async () => {
      await load();
      try {
        await notificationAPI.markAllRead();
      } catch {
        // Silent — if this fails the worst case is the badge stays one
        // extra render; user can pull-to-refresh to retry.
      }
    })();
  }, [load]);

  const onRefresh = async () => {
    if (mountedRef.current) setRefreshing(true);
    await load();
    if (mountedRef.current) setRefreshing(false);
  };

  const markAllRead = async () => {
    try {
      await notificationAPI.markAllRead();
      if (mountedRef.current) {
        setItems((prev) => prev.map((n) => ({ ...n, isRead: true })));
      }
    } catch {}
  };

  const openNotification = async (n: NotificationItem) => {
    if (!n.isRead) {
      try {
        await notificationAPI.markAsRead(n._id);
      } catch {}
    }
    if (mountedRef.current) {
      setItems((prev) =>
        prev.map((x) => (x._id === n._id ? { ...x, isRead: true } : x))
      );
    }
    if (n.link) {
      router.push(n.link as any);
    }
  };

  const formatRelative = (iso: string) => {
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
          <Text style={styles.title}>Notification</Text>
          <Ionicons
            name="notifications"
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
          <Ionicons name="checkmark-done" size={20} color="#2E7D32" />
        </TouchableOpacity>
      </View>

      {/* LIST */}
      <ScrollView
        contentContainerStyle={{ paddingHorizontal: 16, paddingTop: 8, paddingBottom: 40 }}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#2E7D32" />
        }
        showsVerticalScrollIndicator={false}
      >
        {items.length === 0 ? (
          <View style={styles.emptyBox}>
            <Ionicons name="notifications-off-outline" size={36} color="#BDBDBD" />
            <Text style={styles.emptyText}>You have no notifications.</Text>
          </View>
        ) : (
          items.map((n) => (
            <TouchableOpacity
              key={n._id}
              activeOpacity={0.85}
              onPress={() => openNotification(n)}
              style={[
                styles.card,
                {
                  borderLeftColor: TYPE_EDGE[n.type] || TYPE_EDGE.general,
                  backgroundColor: n.isRead ? '#FFFFFF' : '#F1F8F2',
                },
              ]}
            >
              <Text style={styles.cardTitle}>{n.title}</Text>
              <Text style={styles.cardBody}>{n.body}</Text>
              <View style={styles.metaRow}>
                <View style={styles.metaDot} />
                <Text style={styles.metaText}>{formatRelative(n.createdAt)}</Text>
                {!n.isRead && <View style={styles.unreadPill} />}
              </View>
            </TouchableOpacity>
          ))
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

// #428 — Export the boundary-wrapped screen. If anything inside renders
// wrong (bad payload, unexpected type, etc.), the boundary shows a
// "Try again" card locally — the rest of the app (tracking, other
// tabs, session) stays alive.
export default function NotificationsScreen() {
  return (
    <ScreenErrorBoundary name="Notifications">
      <NotificationsScreenInner />
    </ScreenErrorBoundary>
  );
}

const GREEN = '#4CAF50';

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
    backgroundColor: '#2E7D32',
    marginRight: 6,
  },
  metaText: {
    fontSize: 11,
    color: '#2E7D32',
    fontWeight: '600',
  },
  unreadPill: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: GREEN,
    marginLeft: 8,
  },

  emptyBox: {
    alignItems: 'center',
    paddingVertical: 60,
  },
  emptyText: { color: '#777', marginTop: 8, fontSize: 13 },
});
