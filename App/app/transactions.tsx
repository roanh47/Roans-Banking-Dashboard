// Transactions Screen — Searchable list with category filters
import React, { useState, useCallback } from 'react';
import {
  View, Text, ScrollView, StyleSheet, TextInput, TouchableOpacity, RefreshControl,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Colors } from '../src/Theme/Colors';
import TransactionRow from '../src/Components/TransactionRow';
import { fetchTransactions, Transaction } from '../src/API/Client';

export default function TransactionsScreen() {
  const [refreshing, setRefreshing] = useState(false);
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [search, setSearch] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('');
  const [categories, setCategories] = useState<string[]>([]);

  const loadData = useCallback(async () => {
    const data = await fetchTransactions(100, 90);
    setTransactions(data.transactions);
    const cats = [...new Set(data.transactions.map(t => t.category || 'other'))].sort();
    setCategories(cats);
  }, []);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await loadData();
    setRefreshing(false);
  }, [loadData]);

  React.useEffect(() => { loadData(); }, [loadData]);

  const filtered = transactions.filter(t => {
    const matchSearch = !search || (t.description || '').toLowerCase().includes(search.toLowerCase());
    const matchCat = !categoryFilter || t.category === categoryFilter;
    return matchSearch && matchCat;
  });

  return (
    <View style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <Text style={styles.title}>Transactions</Text>
        <Text style={styles.subtitle}>{transactions.length} transactions (last 90 days)</Text>
      </View>

      {/* Search & Filter */}
      <View style={styles.filterRow}>
        <View style={styles.searchBox}>
          <Ionicons name="search" size={16} color={Colors.TextMuted} />
          <TextInput
            style={styles.searchInput}
            placeholder="Search transactions..."
            placeholderTextColor={Colors.TextMuted}
            value={search}
            onChangeText={setSearch}
          />
        </View>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.catScroll}>
          <TouchableOpacity
            style={[styles.catChip, !categoryFilter && styles.catChipActive]}
            onPress={() => setCategoryFilter('')}
          >
            <Text style={[styles.catChipText, !categoryFilter && styles.catChipTextActive]}>All</Text>
          </TouchableOpacity>
          {categories.map(c => (
            <TouchableOpacity
              key={c}
              style={[styles.catChip, categoryFilter === c && styles.catChipActive]}
              onPress={() => setCategoryFilter(c === categoryFilter ? '' : c)}
            >
              <Text style={[styles.catChipText, categoryFilter === c && styles.catChipTextActive]}>
                {c.charAt(0).toUpperCase() + c.slice(1)}
              </Text>
            </TouchableOpacity>
          ))}
        </ScrollView>
      </View>

      {/* Transaction List */}
      <ScrollView
        style={styles.list}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={Colors.Accent} />}
      >
        {filtered.length > 0 ? filtered.map(t => (
          <TransactionRow
            key={t.id}
            date={t.booking_date || '--'}
            description={t.description || t.merchant_name || 'Unknown'}
            category={t.category || 'other'}
            amount={t.amount}
            currency={t.currency}
          />
        )) : (
          <View style={styles.empty}>
            <Ionicons name="document-text-outline" size={40} color={Colors.TextMuted} />
            <Text style={styles.emptyText}>No transactions found</Text>
          </View>
        )}
        <View style={{ height: 24 }} />
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.Background },
  header: { paddingHorizontal: 16, paddingTop: 56, paddingBottom: 8 },
  title: { color: Colors.TextPrimary, fontSize: 22, fontWeight: '700' },
  subtitle: { color: Colors.TextMuted, fontSize: 13, marginTop: 2 },
  filterRow: { paddingHorizontal: 16, marginBottom: 8 },
  searchBox: {
    flexDirection: 'row', alignItems: 'center', backgroundColor: Colors.InputBg,
    borderRadius: 10, borderWidth: 1, borderColor: Colors.InputBorder,
    paddingHorizontal: 12, paddingVertical: 8, marginBottom: 8,
  },
  searchInput: {
    flex: 1, color: Colors.TextPrimary, fontSize: 14, marginLeft: 8,
    padding: 0,
  },
  catScroll: { flexDirection: 'row' },
  catChip: {
    paddingHorizontal: 12, paddingVertical: 6, borderRadius: 16,
    backgroundColor: Colors.InputBg, borderWidth: 1, borderColor: Colors.InputBorder,
    marginRight: 6,
  },
  catChipActive: {
    backgroundColor: Colors.Accent + '33', borderColor: Colors.Accent,
  },
  catChipText: { color: Colors.TextSecondary, fontSize: 12 },
  catChipTextActive: { color: Colors.Accent, fontWeight: '600' },
  list: { flex: 1 },
  empty: { alignItems: 'center', paddingTop: 60, gap: 8 },
  emptyText: { color: Colors.TextMuted, fontSize: 14 },
});
