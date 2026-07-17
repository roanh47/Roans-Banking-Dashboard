// Insights Screen — Full spending breakdown
import React, { useState, useCallback } from 'react';
import {
  View, Text, ScrollView, StyleSheet, Dimensions, RefreshControl,
} from 'react-native';
import { BarChart } from 'react-native-chart-kit';
import { Colors } from '../src/Theme/Colors';
import SpendingChart from '../src/Components/SpendingChart';
import { getLocalTransactions, Transaction } from '../src/API/Client';

const screenWidth = Dimensions.get('window').width;

export default function InsightsScreen() {
  const [refreshing, setRefreshing] = useState(false);
  const [transactions, setTransactions] = useState<Transaction[]>([]);

  const loadData = useCallback(async () => {
    const txs = await getLocalTransactions();
    setTransactions(txs);
  }, []);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await loadData();
    setRefreshing(false);
  }, [loadData]);

  React.useEffect(() => { loadData(); }, [loadData]);

  // Spending by category (last 90 days)
  const cutoff = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const recentTxs = transactions.filter(t => t.booking_date >= cutoff);
  const categoryTotals: Record<string, { total: number; count: number }> = {};
  recentTxs.filter(t => t.amount < 0).forEach(t => {
    const cat = t.category || 'other';
    if (!categoryTotals[cat]) categoryTotals[cat] = { total: 0, count: 0 };
    categoryTotals[cat].total += Math.abs(t.amount);
    categoryTotals[cat].count += 1;
  });
  const spending = Object.entries(categoryTotals)
    .map(([category, data]) => ({ category, total: data.total, count: data.count }))
    .sort((a, b) => b.total - a.total);

  // Monthly data
  const monthlyData: Record<string, { income: number; spending: number }> = {};
  transactions.forEach(t => {
    const month = t.booking_date?.slice(0, 7);
    if (!month) return;
    if (!monthlyData[month]) monthlyData[month] = { income: 0, spending: 0 };
    if (t.amount > 0) monthlyData[month].income += t.amount;
    else monthlyData[month].spending += Math.abs(t.amount);
  });
  const months = Object.entries(monthlyData).sort(([a], [b]) => a.localeCompare(b)).slice(-6);
  const fmt = (n: number) => new Intl.NumberFormat('nl-NL', { style: 'currency', currency: 'EUR' }).format(n);

  return (
    <ScrollView
      style={styles.container}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={Colors.Accent} />}
    >
      <View style={styles.header}>
        <Text style={styles.title}>Insights</Text>
        <Text style={styles.subtitle}>Last 90 days</Text>
      </View>

      <View style={styles.card}>
        <Text style={styles.cardTitle}>Spending Breakdown</Text>
        <SpendingChart data={spending} />
      </View>

      {months.length > 0 ? (
        <View style={styles.card}>
          <Text style={styles.cardTitle}>Income vs Spending</Text>
          <BarChart
            data={{
              labels: months.map(([m]) => {
                const [, mo] = m.split('-');
                return ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'][parseInt(mo)-1];
              }),
              datasets: [
                { data: months.map(([, m]) => m.income) },
                { data: months.map(([, m]) => m.spending) },
              ],
            }}
            width={screenWidth - 48}
            height={200}
            yAxisLabel=""
            yAxisSuffix=""
            chartConfig={{
              backgroundColor: Colors.Card,
              backgroundGradientFrom: Colors.Card,
              backgroundGradientTo: Colors.Card,
              decimalPlaces: 0,
              color: (opacity = 1) => `rgba(108, 92, 231, ${opacity})`,
              labelColor: () => Colors.TextSecondary,
              barPercentage: 0.4,
            }}
            style={{ borderRadius: 8 }}
          />
        </View>
      ) : null}

      <View style={styles.card}>
        <Text style={styles.cardTitle}>All Categories</Text>
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
        {spending.length === 0 ? <Text style={styles.emptyText}>No spending data</Text> : null}
      </View>

      <View style={{ height: 24 }} />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.Background },
  header: { paddingHorizontal: 16, paddingTop: 56, paddingBottom: 12 },
  title: { color: Colors.TextPrimary, fontSize: 22, fontWeight: '700' },
  subtitle: { color: Colors.TextMuted, fontSize: 13, marginTop: 2 },
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
