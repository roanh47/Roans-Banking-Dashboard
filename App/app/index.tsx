// Home Screen — Net worth, accounts, charts
import React, { useState, useCallback } from 'react';
import {
  View, Text, ScrollView, StyleSheet, RefreshControl,
  Dimensions, TouchableOpacity,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { BarChart } from 'react-native-chart-kit';
import { Colors } from '../src/Theme/Colors';
import AccountCard from '../src/Components/AccountCard';
import SpendingChart from '../src/Components/SpendingChart';
import {
  fetchAccountSummary, fetchAccounts, fetchMonthlyInsights,
  fetchSpendingInsights, fetchTopMerchants, syncAll,
  Account, MonthlyData, SpendingInsight, TopMerchant,
} from '../src/API/Client';

const screenWidth = Dimensions.get('window').width;

export default function HomeScreen() {
  const [refreshing, setRefreshing] = useState(false);
  const [totalBalance, setTotalBalance] = useState(0);
  const [accountCount, setAccountCount] = useState(0);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [months, setMonths] = useState<MonthlyData[]>([]);
  const [spending, setSpending] = useState<SpendingInsight[]>([]);
  const [merchants, setMerchants] = useState<TopMerchant[]>([]);
  const [error, setError] = useState('');

  const loadData = useCallback(async () => {
    try {
      setError('');
      const [summary, accData, monthly, spendData, merchantData] = await Promise.all([
        fetchAccountSummary(),
        fetchAccounts(),
        fetchMonthlyInsights(),
        fetchSpendingInsights(90),
        fetchTopMerchants(30, 5),
      ]);
      setTotalBalance(summary.total_balance);
      setAccountCount(summary.account_count);
      setAccounts(accData.accounts);
      setMonths(monthly.months);
      setSpending(spendData.insights);
      setMerchants(merchantData.merchants);
    } catch (e: any) {
      setError(e.message || 'Could not load data');
    }
  }, []);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    try { await syncAll(); } catch {}
    await loadData();
    setRefreshing(false);
  }, [loadData]);

  React.useEffect(() => { loadData(); }, [loadData]);

  const latestMonth = months.length ? months[months.length - 1] : null;

  return (
    <ScrollView
      style={styles.container}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={Colors.Accent} />}
    >
      {/* Header */}
      <View style={styles.header}>
        <View>
          <Text style={styles.greeting}>Banking Dashboard</Text>
          <Text style={styles.subtitle}>Pull to sync</Text>
        </View>
        <TouchableOpacity onPress={onRefresh}>
          <Ionicons name="sync" size={22} color={Colors.Accent} />
        </TouchableOpacity>
      </View>

      {error ? (
        <View style={styles.errorBox}>
          <Text style={styles.errorText}>{error}</Text>
        </View>
      ) : null}

      {/* Net Worth */}
      <View style={styles.cardWide}>
        <Text style={styles.cardLabel}>Net Worth</Text>
        <Text style={styles.cardAmount}>
          {new Intl.NumberFormat('nl-NL', { style: 'currency', currency: 'EUR' }).format(totalBalance)}
        </Text>
        <Text style={styles.cardSub}>{accountCount} account{accountCount !== 1 ? 's' : ''}</Text>
      </View>

      {/* Monthly Summary */}
      {latestMonth ? (
        <View style={styles.row}>
          <View style={[styles.card, { marginRight: 8 }]}>
            <Text style={styles.cardLabel}>Spending</Text>
            <Text style={[styles.cardAmount, { color: Colors.Red, fontSize: 18 }]}>
              -{new Intl.NumberFormat('nl-NL', { style: 'currency', currency: 'EUR' }).format(latestMonth.spending)}
            </Text>
            <Text style={styles.cardSub}>this month</Text>
          </View>
          <View style={styles.card}>
            <Text style={styles.cardLabel}>Income</Text>
            <Text style={[styles.cardAmount, { color: Colors.Green, fontSize: 18 }]}>
              +{new Intl.NumberFormat('nl-NL', { style: 'currency', currency: 'EUR' }).format(latestMonth.income)}
            </Text>
            <Text style={styles.cardSub}>this month</Text>
          </View>
        </View>
      ) : null}

      {/* Account Cards */}
      {accounts.length > 0 ? (
        <View style={styles.row}>
          {accounts.map((a) => (
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

      {/* Monthly Chart */}
      {months.length > 0 ? (
        <View style={styles.chartCard}>
          <Text style={styles.chartTitle}>Monthly Overview</Text>
          <BarChart
            data={{
              labels: [...months].reverse().map(m => {
                const [, mo] = m.month.split('-');
                return ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'][parseInt(mo)-1];
              }),
              datasets: [{
                data: [...months].reverse().map(m => m.income - m.spending),
              }],
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

      {/* Spending + Merchants */}
      <View style={styles.row}>
        <View style={[styles.chartCard, { flex: 1, marginRight: 8 }]}>
          <Text style={styles.chartTitle}>Spending by Category</Text>
          <SpendingChart data={spending} />
        </View>
        <View style={[styles.chartCard, { flex: 1 }]}>
          <Text style={styles.chartTitle}>Top Merchants</Text>
          {merchants.length > 0 ? merchants.map((m, i) => (
            <View key={i} style={styles.merchantRow}>
              <Text style={styles.merchantName} numberOfLines={1}>{m.merchant}</Text>
              <Text style={styles.merchantAmount}>
                -{new Intl.NumberFormat('nl-NL', { style: 'currency', currency: 'EUR' }).format(m.total)}
              </Text>
            </View>
          )) : (
            <Text style={styles.emptyText}>No merchant data</Text>
          )}
        </View>
      </View>

      <View style={{ height: 24 }} />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.Background },
  header: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    paddingHorizontal: 16, paddingTop: 56, paddingBottom: 12,
  },
  greeting: { color: Colors.TextPrimary, fontSize: 22, fontWeight: '700' },
  subtitle: { color: Colors.TextMuted, fontSize: 13, marginTop: 2 },
  errorBox: {
    backgroundColor: Colors.Red + '22', marginHorizontal: 16, marginBottom: 12,
    padding: 12, borderRadius: 8, borderWidth: 1, borderColor: Colors.Red + '44',
  },
  errorText: { color: Colors.Red, fontSize: 13 },
  cardWide: {
    backgroundColor: Colors.Card, borderRadius: 12, borderWidth: 1,
    borderColor: Colors.CardBorder, padding: 20, marginHorizontal: 16, marginBottom: 12,
  },
  card: {
    backgroundColor: Colors.Card, borderRadius: 12, borderWidth: 1,
    borderColor: Colors.CardBorder, padding: 16, flex: 1, marginBottom: 12,
  },
  row: {
    flexDirection: 'row', paddingHorizontal: 16, marginBottom: 12,
  },
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
  emptyText: { color: Colors.TextMuted, fontSize: 13, textAlign: 'center', padding: 16 },
});
