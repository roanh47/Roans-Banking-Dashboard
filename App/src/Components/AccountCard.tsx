// Account Card Component
import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Colors } from '../Theme/Colors';

interface Props {
  name: string;
  balance: number;
  currency?: string;
  subtitle?: string;
  highlight?: 'green' | 'red';
}

export default function AccountCard({ name, balance, currency = 'EUR', subtitle, highlight }: Props) {
  const formatted = new Intl.NumberFormat('nl-NL', {
    style: 'currency',
    currency,
  }).format(Math.abs(balance));

  const color = highlight === 'green' ? Colors.Green
    : highlight === 'red' ? Colors.Red
    : Colors.TextPrimary;

  return (
    <View style={styles.card}>
      <Text style={styles.label}>{name}</Text>
      <Text style={[styles.amount, { color }]}>
        {highlight === 'red' ? '-' : highlight === 'green' ? '+' : ''}{formatted}
      </Text>
      {subtitle ? <Text style={styles.sub}>{subtitle}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: Colors.Card,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: Colors.CardBorder,
    padding: 16,
    flex: 1,
    minWidth: 140,
  },
  label: {
    color: Colors.TextSecondary,
    fontSize: 13,
    marginBottom: 6,
  },
  amount: {
    fontSize: 20,
    fontWeight: '700',
  },
  sub: {
    color: Colors.TextMuted,
    fontSize: 12,
    marginTop: 4,
  },
});
