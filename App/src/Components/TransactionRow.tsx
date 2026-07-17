// Transaction Row Component
import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Colors } from '../Theme/Colors';

interface Props {
  date: string;
  description: string;
  category: string;
  amount: number;
  currency?: string;
}

export default function TransactionRow({ date, description, category, amount, currency = 'EUR' }: Props) {
  const isIncome = amount > 0;
  const formatted = new Intl.NumberFormat('nl-NL', {
    style: 'currency',
    currency,
  }).format(Math.abs(amount));

  const catColor = Colors.CategoryColors[category] || Colors.TextMuted;

  return (
    <View style={styles.row}>
      <View style={styles.left}>
        <Text style={styles.date}>{date}</Text>
        <Text style={styles.desc} numberOfLines={1}>{description || 'Unknown'}</Text>
      </View>
      <View style={styles.right}>
        <View style={[styles.badge, { backgroundColor: catColor + '22' }]}>
          <Text style={[styles.badgeText, { color: catColor }]}>{category}</Text>
        </View>
        <Text style={[styles.amount, { color: isIncome ? Colors.Green : Colors.Red }]}>
          {isIncome ? '+' : '-'}{formatted}
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderBottomWidth: 1,
    borderBottomColor: Colors.CardBorder,
  },
  left: {
    flex: 1,
    marginRight: 12,
  },
  date: {
    color: Colors.TextMuted,
    fontSize: 12,
    marginBottom: 2,
  },
  desc: {
    color: Colors.TextPrimary,
    fontSize: 14,
  },
  right: {
    alignItems: 'flex-end',
    gap: 4,
  },
  badge: {
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 6,
  },
  badgeText: {
    fontSize: 11,
    fontWeight: '600',
    textTransform: 'capitalize',
  },
  amount: {
    fontSize: 14,
    fontWeight: '600',
  },
});
