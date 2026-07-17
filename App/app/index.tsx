// Home Screen — Net worth, accounts, charts
import React, { useState, useCallback } from 'react';
import {
  View, Text, ScrollView, StyleSheet, RefreshControl,
  Dimensions, TouchableOpacity,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { SafeAreaView } from 'react-native-safe-area-context';
import { BarChart } from 'react-native-chart-kit';
import { Colors } from '../src/Theme/Colors';
import AccountCard from '../src/Components/AccountCard';
import SpendingChart from '../src/Components/SpendingChart';
import { getLocalAccounts, getLocalTransactions, Account, Transaction } from '../src/API/Client';

const screenWidth = Dimensions.get('window').width;

export default function HomeScreen() {
  const [refreshing, setRefreshing] = useState(false);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [transactions, setTransactions] = useState<Transaction[]>([]);

  const loadData = useCallback(async () => {
    const [accs, txs] = await Promise.all([getLocalAccounts(), getLocalTransactions()]);
    setAccounts(accs);
    setTransactions(txs);
  }, []);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await loadData();
    setRefreshing(false);
  }, [loadData]);

  React.useEffect(() => { loadData(); }, [loadData]);

  const totalBalance = accounts.reduce((sum, a) => sum + a.balance, 0);
  const now = new Date();
  const thisMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  const monthTxs = transactions.filter(t => t.booking_date?.startsWith(thisMonth));
  const monthSpending = monthTxs.filter(t => t.amount < 0).reduce((sum, t) => sum + Math.abs(t.amount), 0);
  const monthIncome = monthTxs.filter(t => t.amount > 0).reduce((sum, t) => sum + t.amount, 0);

  const categoryTotals: Record<string, number> = {};
  transactions.filter(t => t.amount < 0).forEach(t => {
    const cat = t.category || 'other';
    categoryTotals[cat] = (categoryTotals[cat] || 0) + Math.abs(t.amount);
  });
  const spendingData = Object.entries(categoryTotals)
    .map(([category, total]) => ({ category, total }))
    .sort((a, b) => b.total - a.total);

  const merchantTotals: Record<string, number> = {};
  transactions.filter(t => t.amount < 0 && t.merchant_name).forEach(t => {
    merchantTotals[t.merchant_name] = (merchantTotals[t.merchant_name] || 0) + Math.abs(t.amount);
  });
  const topMerchants = Object.entries(merchantTotals)
    .map(([merchant, total]) => ({ merchant, total }))
    .sort((a, b) => b.total - a.total)
    .slice(0, 5);

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
          <View>
            <Text style={styles.greeting}>Banking Dashboard</Text>
            <Text style={styles.subtitle}>Pull to sync</Text>
          </View>
          <TouchableOpacity onPress={onRefresh}>
            <Ionicons name="sync" size={22} color={Colors.Accent} />
          </TouchableOpacity>
        </View>

        <View style={styles.cardWide}>
          <Text style={styles.cardLabel}>Net Worth</Text>
          <Text style={styles.cardAmount}>{fmt(totalBalance)}</Text>
          <Text style={styles.cardSub}>{accounts.length} account{accounts.length !== 1 ? 's' : ''}</Text>
        </View>

        <View style={styles.row}>
          <View style={[styles.card, { marginRight: 8 }]}>
            <Text style={styles.cardLabel}>Spending</Text>
            <Text style={[styles.cardAmount, { color: Colors.Red, fontSize: 18 }]}>-{fmt(monthSpending)}</Text>
            <Text style={styles.cardSub}>this month</Text>
          </View>
          <View style={styles.card}>
            <Text style={styles.cardLabel}>Income</Text>
            <Text style={[styles.cardAmount, { color: Colors.Green, fontSize: 18 }]}>+{fmt(monthIncome)}</Text>
            <Text style={styles.cardSub}>this month</Text>
          </View>
        </View>

        {accounts.length > 0 ? (
          <View style={styles.row}>
            {accounts.map(a => (
              <View key={a.id} style={{ flex: 1, marginRight: 8 }}>
                <AccountCard
                  name={a.name}
                  balance={a.balance}
                  currency={a.currency}
                  subtitle={a.iban ? a.iban.slice(0, 18) + '...' : a.account_type}
                />
              </View>
            ))}
          </View>
        ) : null}

        {months.length > 0 ? (
          <View style={styles.chartCard}>
            <Text style={styles.chartTitle}>Monthly Overview</Text>
            <BarChart
              data={{
                labels: months.map(([m]) => monthShort(m)),
                datasets: [{ data: months.map(([, m]) => m.income - m.spending) }],
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

        <View style={styles.row}>
          <View style={[styles.chartCard, { flex: 1, marginRight: 8 }]}>
            <Text style={styles.chartTitle}>Spending by Category</Text>
            <SpendingChart data={spendingData} />
          </View>
          <View style={[styles.chartCard, { flex: 1 }]}>
            <Text style={styles.chartTitle}>Top Merchants</Text>
            {topMerchants.length > 0 ? topMerchants.map((m, i) => (
              <View key={i} style={styles.merchantRow}>
                <Text style={styles.merchantName} numberOfLines={1}>{m.merchant}</Text>
                <Text style={styles.merchantAmount}>-{fmt(m.total)}</Text>
              </View>
            )) : (
              <Text style={styles.emptyText}>No merchant data</Text>
            )}
          </View>
        </View>

        {accounts.length === 0 && transactions.length === 0 ? (
          <View style={styles.emptyBox}>
            <Ionicons name="card-outline" size={48} color={Colors.TextMuted} />
            <Text style={styles.emptyTitle}>No data yet</Text>
            <Text style={styles.emptyText}>Connect a bank in Profile to get started.</Text>
          </View>
        ) : null}

        <View style={{ height: 24 }} />
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.Background },
  scroll: { flex: 1 },
  header: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    paddingHorizontal: 16, paddingTop: 16, paddingBottom: 12,
  },
  greeting: { color: Colors.TextPrimary, fontSize: 22, fontWeight: '700' },
  subtitle: { color: Colors.TextMuted, fontSize: 13, marginTop: 2 },
  cardWide: {
    backgroundColor: Colors.Card, borderRadius: 12, borderWidth: 1,
    borderColor: Colors.CardBorder, padding: 20, marginHorizontal: 16, marginBottom: 12,
  },
  card: {
    backgroundColor: Colors.Card, borderRadius: 12, borderWidth: 1,
    borderColor: Colors.CardBorder, padding: 16, flex: 1, marginBottom: 12,
  },
  row: { flexDirection: 'row', paddingHorizontal: 16, marginBottom: 12 },
  cardLabel: { color: Colors.TextSecondary, fontSize: 13, marginBottom: 6 },
  cardAmount: { color: Colors.TextPrimary, fontSize: 26, fontWeight: '700' },
  cardSub: { color: Colors.TextMuted, fontSize: 12, marginTop: 4 },
  chartCard: {
    backgroundColor: Colors.Card, borderRadius: 12, borderWidth: 1,
    borderColor: Colors.CardBorder, padding: 16, marginHorizontal: 16, marginBottom: 12,
  },
  chartTitle: { color: Colors.TextPrimary, fontSize: 15, fontWeight: '600', marginBottom: 12 },
  merchantRow: {
    flexDirection: 'row', justifyContent: 'space-between',
    paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: Colors.CardBorder,
  },
  merchantName: { color: Colors.TextPrimary, fontSize: 13, flex: 1, marginRight: 8 },
  merchantAmount: { color: Colors.Red, fontSize: 13, fontWeight: '600' },
  emptyBox: { alignItems: 'center', padding: 40, gap: 8 },
  emptyTitle: { color: Colors.TextPrimary, fontSize: 18, fontWeight: '600' },
  emptyText: { color: Colors.TextMuted, fontSize: 13, textAlign: 'center' },
});
