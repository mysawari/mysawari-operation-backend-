const fs = require('fs');

const newContent = `
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  RefreshControl,
  SafeAreaView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { router } from "expo-router";
import api from "../../../services/api";
import colors from "../../../theme/colors";
import { MaterialCommunityIcons } from "@expo/vector-icons";

const PAGE_SIZE = 500;

const TABS = [
  { key: "today", label: "Today" },
  { key: "yesterday", label: "Yesterday" },
  { key: "all", label: "All" },
];

const formatCurrency = (amount) => {
  const value = Number(amount) || 0;
  return \`₹\${value.toLocaleString("en-IN", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  })}\`;
};

const formatDate = (dateString) => {
  if (!dateString) return "--";
  const date = new Date(dateString);
  return date.toLocaleDateString("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: true,
  });
};

const isToday = (date) => {
  const today = new Date();
  const d = new Date(date);
  return d.getDate() === today.getDate() &&
    d.getMonth() === today.getMonth() &&
    d.getFullYear() === today.getFullYear();
};

const isYesterday = (date) => {
  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  const d = new Date(date);
  return d.getDate() === yesterday.getDate() &&
    d.getMonth() === yesterday.getMonth() &&
    d.getFullYear() === yesterday.getFullYear();
};

const PendingPaymentCard = ({ payment }) => {
  const method = String(payment.paymentMethod || "").toUpperCase();
  const type = String(payment.type || "PAYMENT").toUpperCase();

  return (
    <View style={styles.card}>
      <View style={styles.cardHeader}>
        <Text style={styles.cardType}>{type}</Text>
        <View style={styles.badge}>
          <Text style={styles.badgeText}>{method}</Text>
        </View>
      </View>

      <View style={styles.cardBody}>
        <View style={styles.amountBox}>
          <Text style={styles.amountLabel}>Pending</Text>
          <Text style={styles.amountValue}>{formatCurrency(payment.remainingAmount)}</Text>
        </View>

        <View style={styles.detailBox}>
          <Text style={styles.detailLabel}>Total Amount: {formatCurrency(payment.amount)}</Text>
          <Text style={styles.detailLabel}>Created: {formatDate(payment.createdAt)}</Text>
        </View>
      </View>
    </View>
  );
};

export default function PendingPaymentsScreen() {
  const [activeTab, setActiveTab] = useState("all");
  const [payments, setPayments] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const fetchPayments = async (isRefresh = false) => {
    try {
      if (isRefresh) setRefreshing(true);
      else setLoading(true);

      const [resCash, resPhonepe] = await Promise.all([
        api.get("/payments/pending", { params: { status: "pending", limit: PAGE_SIZE } }).catch(() => ({ data: { data: [] } })),
        api.get("/payments/phonepe/pending", { params: { status: "pending", limit: PAGE_SIZE } }).catch(() => ({ data: { data: [] } }))
      ]);

      const cashData = resCash.data?.data || [];
      const phonepeData = resPhonepe.data?.data || [];

      // Combine and deduplicate
      const combined = [...cashData, ...phonepeData];
      const uniqueMap = new Map();
      combined.forEach(p => {
        if (!uniqueMap.has(p._id)) {
          uniqueMap.set(p._id, p);
        } else {
          const existing = uniqueMap.get(p._id);
          existing.remainingAmount = Math.max(existing.remainingAmount, p.remainingAmount);
        }
      });

      const uniquePayments = Array.from(uniqueMap.values());
      uniquePayments.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
      
      setPayments(uniquePayments);
    } catch (err) {
      console.error("Failed to load pending payments", err);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useEffect(() => {
    fetchPayments();
  }, []);

  const displayedPayments = useMemo(() => {
    if (activeTab === "today") return payments.filter(p => isToday(p.createdAt));
    if (activeTab === "yesterday") return payments.filter(p => isYesterday(p.createdAt));
    return payments; // "all"
  }, [payments, activeTab]);

  const renderTab = ({ item }) => {
    const isActive = activeTab === item.key;
    return (
      <Pressable
        style={[styles.tab, isActive && styles.activeTab]}
        onPress={() => setActiveTab(item.key)}
      >
        <Text style={[styles.tabText, isActive && styles.activeTabText]}>
          {item.label}
        </Text>
      </Pressable>
    );
  };

  if (loading) {
    return (
      <SafeAreaView style={styles.safeArea}>
        <View style={styles.center}>
          <ActivityIndicator size="large" color={colors.primary} />
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safeArea}>
      <View style={styles.header}>
        <Text style={styles.title}>Pending Payments</Text>
        <Text style={styles.subtitle}>All pending collection summaries</Text>
      </View>

      <View style={styles.tabsContainer}>
        <FlatList
          horizontal
          showsHorizontalScrollIndicator={false}
          data={TABS}
          renderItem={renderTab}
          keyExtractor={(item) => item.key}
          contentContainerStyle={styles.tabsContent}
        />
      </View>

      <FlatList
        data={displayedPayments}
        keyExtractor={(item) => item._id}
        renderItem={({ item }) => <PendingPaymentCard payment={item} />}
        contentContainerStyle={styles.listContent}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={() => fetchPayments(true)} colors={[colors.primary]} />
        }
        ListEmptyComponent={
          <View style={styles.emptyContainer}>
            <MaterialCommunityIcons name="check-circle-outline" size={48} color={colors.green} />
            <Text style={styles.emptyTitle}>No Pending Payments</Text>
            <Text style={styles.emptySubtitle}>You're all caught up for {activeTab}!</Text>
          </View>
        }
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: "#F8FAFC",
  },
  center: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
  },
  header: {
    padding: 16,
    backgroundColor: "#FFF",
    borderBottomWidth: 1,
    borderBottomColor: "#E2E8F0",
  },
  title: {
    fontSize: 20,
    fontWeight: "bold",
    color: "#0F172A",
  },
  subtitle: {
    fontSize: 14,
    color: "#64748B",
    marginTop: 4,
  },
  tabsContainer: {
    backgroundColor: "#FFF",
    borderBottomWidth: 1,
    borderBottomColor: "#E2E8F0",
  },
  tabsContent: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    gap: 8,
  },
  tab: {
    paddingVertical: 8,
    paddingHorizontal: 16,
    borderRadius: 20,
    backgroundColor: "#F1F5F9",
    marginRight: 8,
  },
  activeTab: {
    backgroundColor: colors.primary || "#0EA5E9",
  },
  tabText: {
    fontSize: 14,
    fontWeight: "600",
    color: "#64748B",
  },
  activeTabText: {
    color: "#FFF",
  },
  listContent: {
    padding: 16,
    gap: 12,
  },
  card: {
    backgroundColor: "#FFF",
    borderRadius: 12,
    padding: 16,
    borderWidth: 1,
    borderColor: "#E2E8F0",
  },
  cardHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 12,
  },
  cardType: {
    fontSize: 14,
    fontWeight: "600",
    color: "#475569",
  },
  badge: {
    backgroundColor: "#FEF9C3",
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 4,
  },
  badgeText: {
    fontSize: 12,
    fontWeight: "600",
    color: "#CA8A04",
  },
  cardBody: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  amountBox: {
    flex: 1,
  },
  amountLabel: {
    fontSize: 12,
    color: "#64748B",
    marginBottom: 2,
  },
  amountValue: {
    fontSize: 20,
    fontWeight: "700",
    color: "#EAB308",
  },
  detailBox: {
    alignItems: "flex-end",
  },
  detailLabel: {
    fontSize: 12,
    color: "#64748B",
    marginBottom: 2,
  },
  emptyContainer: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingTop: 60,
  },
  emptyTitle: {
    fontSize: 18,
    fontWeight: "bold",
    color: "#0F172A",
    marginTop: 12,
  },
  emptySubtitle: {
    fontSize: 14,
    color: "#64748B",
    marginTop: 8,
    textAlign: "center",
  },
});
`;

fs.writeFileSync('/Users/anisulislam/Desktop/Mysawari customer + Operation App/Operation APP/my-sawari-backend/app/menu/payments/pendingPaymentsScreen.jsx', newContent.trim());
