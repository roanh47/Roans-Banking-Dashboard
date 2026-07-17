// Spending Chart Component (Doughnut)
import React from 'react';
import { View, Text, StyleSheet, Dimensions } from 'react-native';
import { PieChart } from 'react-native-chart-kit';
import { Colors } from '../Theme/Colors';

interface SpendingData {
  category: string;
  total: number;
}

interface Props {
  data: SpendingData[];
}

const screenWidth = Dimensions.get('window').width;

export default function SpendingChart({ data }: Props) {
  if (!data.length) {
    return (
      <View style={styles.empty}>
        <Text style={styles.emptyText}>No spending data yet</Text>
      </View>
    );
  }

  const chartData = data.map(item => ({
    name: item.category.charAt(0).toUpperCase() + item.category.slice(1),
    amount: item.total,
    color: Colors.CategoryColors[item.category] || Colors.TextMuted,
    legendFontColor: Colors.TextSecondary,
    legendFontSize: 12,
  }));

  return (
    <PieChart
      data={chartData}
      width={screenWidth - 64}
      height={180}
      chartConfig={{
        color: () => Colors.Accent,
      }}
      accessor="amount"
      backgroundColor="transparent"
      paddingLeft="0"
      absolute
    />
  );
}

const styles = StyleSheet.create({
  empty: {
    padding: 24,
    alignItems: 'center',
  },
  emptyText: {
    color: Colors.TextMuted,
    fontSize: 13,
  },
});
