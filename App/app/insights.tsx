// Insights Screen — Per-month spending breakdown
import React, { useState, useCallback } from 'react';
import {
  View, Text, ScrollView, StyleSheet, Dimensions, RefreshControl, TouchableOpacity,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { BarChart } from 'react-native-chart-kit';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Colors } from '../src/Theme/Colors';
import SpendingChart from '../src/Components/SpendingChart';
import { getLocalTransactions, Transaction } from '../src/API/Client';

const screenWidth = Dimensions.get('window').width;

export default function InsightsScreen() {
  const [refreshing, setRefreshing] = useState(false);
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [selectedMonth, setSelectedMonth] = useState('');

  const loadData = useCallback(async () => {
    const txs = await getLocalTransactions();
    setTransactions(txs);
    // Default to current month
    const now = new Date();
    const current = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    setSelectedMonth(current);
  }, []);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await loadData();
    setRefreshing(false);
  }, [loadData]);

  React.useEffect(() => { loadData(); }, [loadData]);

  // Get all available months
  const monthSet = new Set<string>();
  transactions.forEach(t => {
    if (t.booking_date) monthSet.add(t.booking_date.slice(0, 7));
  });
  const allMonths = [...monthSet].sort().reverse();

  // Filter transactions for selected month
  const monthTxs = transactions.filter(t => t.booking_date?.startsWith(selectedMonth));

  // Spending by category for selected month
  const categoryTotals: Record<string, { total: number; count: number }> = {};
  monthTxs.filter(t => t.amount < 0).forEach(t => {
    const cat = t.category || 'other';
    if (!categoryTotals[cat]) categoryTotals[cat] = { total: 0, count: 0 };
    categoryTotals[cat].total += Math.abs(t.amount);
    categoryTotals[cat].count += 1;
  });
  const spending = Object.entries(categoryTotals)
    .map(([category, data]) => ({ category, total: data.total, count: data.count }))
    .sort((a, b) => b.total - a.total);

  // Monthly totals for bar chart
  const monthlyData: Record<string, { income: number; spending: number }> = {};
  transactions.forEach(t => {
    const month = t.booking_date?.slice(0, 7);
    if (!month) return;
    if (!monthlyData[month]) monthlyData[month] = { income: 0, spending: 0 };
    if (t.amount > 0) monthlyData[month].income += t.amount;
    else monthlyData[month].spending += Math.abs(t.amount);
  });
  const chartMonths = Object.entries(monthlyData).sort(([a], [b]) => a.localeCompare(b)).slice(-6);

  const monthTotal = monthTxs.reduce((sum, t) => sum + t.amount, 0);
  const monthSpending = monthTxs.filter(t => t.amount < 0).reduce((sum, t) => sum + Math.abs(t.amount), 0);
  const monthIncome = monthTxs.filter(t => t.amount > 0).reduce((sum, t) => sum + t.amount, 0);

  const fmt = (n: number) => new Intl.NumberFormat('nl-NL', { style: 'currency', currency: 'EUR' }).format(n);
  const monthLabel = (m: string) => {
    const [y, mo] = m.split('-');
    return ['January','February','March','April','May','June','July','August','September','October','November','December'][parseInt(mo)-1] + ' ' + y;
  };
  const monthShort = (m: string) => {
    const [, mo] = m.split('-');
    return ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'][parseInt(mo)-1];
  };

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <ScrollView
        style={styles.scroll}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={Colors.Accent} />}
      >
        <View style={styles.header}>
          <Text style={styles.title}>Insights</Text>
        </View>

        {/* Month Selector */}
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.monthScroll} contentContainerStyle={{ paddingHorizontal: 16 }}>
          {allMonths.map(m => (
            <TouchableOpacity
              key={m}
              style={[styles.monthChip, selectedMonth === m && styles.monthChipActive]}
              onPress={() => setSelectedMonth(m)}
            >
              <Text style={[styles.monthChipText, selectedMonth === m && styles.monthChipTextActive]}>
                {monthShort(m)}
              </Text>
            </TouchableOpacity>
          ))}
        </ScrollView>

        {/* Month Summary */}
        <View style={styles.monthSummary}>
          <Text style={styles.monthLabel}>{monthLabel(selectedMonth)}</Text>
          <View style={styles.monthRow}>
            <View style={styles.monthStat}>
              <Text style={styles.monthStatLabel}>Income</Text>
              <Text style={[styles.monthStatValue, { color: Colors.Green }]}>{fmt(monthIncome)}</Text>
            </View>
            <View style={styles.monthStat}>
              <Text style={styles.monthStatLabel}>Spending</Text>
              <Text style={[styles.monthStatValue, { color: Colors.Red }]}>{fmt(monthSpending)}</Text>
            </View>
            <View style={styles.monthStat}>
              <Text style={styles.monthStatLabel}>Net</Text>
              <Text style={[styles.monthStatValue, { color: monthTotal >= 0 ? Colors.Green : Colors.Red }]}>
                {fmt(monthTotal)}
              </Text>
            </View>
          </View>
        </View>

        {/* Spending Doughnut */}
        <View style={styles.card}>
          <Text style={styles.cardTitle}>Spending Breakdown</Text>
          <SpendingChart data={spending} />
        </View>

        {/* Monthly Bar Chart */}
        {chartMonths.length > 0 ? (
          <View style={styles.card}>
            <Text style={styles.cardTitle}>Monthly Overview</Text>
            <BarChart
              data={{
                labels: chartMonths.map(([m]) => monthShort(m)),
                datasets: [{ data: chartMonths.map(([, m]) => m.income - m.spending) }],
              }}
              width={screenWidth - 48}
              height={180}
              yAxisLabel=""
              yAxisSuffix=""
              chartConfig={{
                backgroundColor: Colors.Card,
                backgroundGradientFrom: Colors.Card,
                backgroundGradientTo: Colors.Card,
                decimalPlaces: 0,
                color: (opacity = 1) => `rgba(108, 92, 231, ${opacity})`,
                labelColor: () => Colors.TextSecondary,
                barPercentage: 0.6,
              }}
              style={{ borderRadius: 8 }}
            />
          </View>
        ) : null}

        {/* Category Table */}
        <View style={styles.card}>
          <Text style={styles.cardTitle}>Categories</Text>
          <View style={styles.tableHeader}>
            <Text style={[styles.th, { flex: 2 }]}>Category</Text>
            <Text style={[styles.th, { flex: 1, textAlign: 'right' }]}>Total</Text>
            <Text style={[styles.th, { flex: 1, textAlign: 'right' }]}>Txns</Text>
          </View>
          {spending.map((s, i) => {
            const catColor = Colors.CategoryColors[s.category] || Colors.TextMuted;
            return (
              <View key={i} style={styles.tableRow}>
                <View style={{ flex: 2, flexDirection: 'row', alignItems: 'center' }}>
                  <View style={[styles.dot, { backgroundColor: catColor }]} />
                  <Text style={styles.td}>{s.category.charAt(0).toUpperCase() + s.category.slice(1)}</Text>
                </View>
                <Text style={[styles.td, { flex: 1, textAlign: 'right', fontWeight: '600' }]}>{fmt(s.total)}</Text>
                <Text style={[styles.td, { flex: 1, textAlign: 'right', color: Colors.TextMuted }]}>{s.count}</Text>
              </View>
            );
          })}
          {spending.length === 0 ? <Text style={styles.emptyText}>No spending data for this month</Text> : null}
        </View>

        <View style={{ height: 24 }} />
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.Background },
  scroll: { flex: 1 },
  header: { paddingHorizontal: 16, paddingTop: 16, paddingBottom: 12 },
  title: { color: Colors.TextPrimary, fontSize: 22, fontWeight: '700' },
  monthScroll: { marginBottom: 12 },
  monthChip: {
    paddingHorizontal: 16, paddingVertical: 8, borderRadius: 20,
    backgroundColor: Colors.InputBg, borderWidth: 1, borderColor: Colors.InputBorder, marginRight: 8,
  },
  monthChipActive: { backgroundColor: Colors.Accent + '33', borderColor: Colors.Accent },
  monthChipText: { color: Colors.TextSecondary, fontSize: 13, fontWeight: '500' },
  monthChipTextActive: { color: Colors.Accent, fontWeight: '700' },
  monthSummary: {
    backgroundColor: Colors.Card, borderRadius: 12, borderWidth: 1,
    borderColor: Colors.CardBorder, padding: 16, marginHorizontal: 16, marginBottom: 12,
  },
  monthLabel: { color: Colors.TextPrimary, fontSize: 16, fontWeight: '600', marginBottom: 12 },
  monthRow: { flexDirection: 'row', gap: 12 },
  monthStat: { flex: 1 },
  monthStatLabel: { color: Colors.TextMuted, fontSize: 12, marginBottom: 4 },
  monthStatValue: { fontSize: 16, fontWeight: '700' },
  card: {
    backgroundColor: Colors.Card, borderRadius: 12, borderWidth: 1,
    borderColor: Colors.CardBorder, padding: 16, marginHorizontal: 16, marginBottom: 12,
  },
  cardTitle: { color: Colors.TextPrimary, fontSize: 15, fontWeight: '600', marginBottom: 12 },
  tableHeader: {
    flexDirection: 'row', paddingBottom: 8,
    borderBottomWidth: 1, borderBottomColor: Colors.CardBorder, marginBottom: 4,
  },
  th: { color: Colors.TextMuted, fontSize: 12, fontWeight: '600' },
  tableRow: {
    flexDirection: 'row', alignItems: 'center', paddingVertical: 10,
    borderBottomWidth: 1, borderBottomColor: Colors.CardBorder,
  },
  dot: { width: 8, height: 8, borderRadius: 4, marginRight: 8 },
  td: { color: Colors.TextPrimary, fontSize: 13 },
  emptyText: { color: Colors.TextMuted, fontSize: 13, textAlign: 'center', padding: 16 },
});
