// Shared 1-10 scale input, extracted from the identical local copies that the
// Check-In and Urge screens each carried. The relapse flow uses it too.
// Keeping it in one file means the accessibility labels and clamped bounds
// stay consistent across every self-report screen.
import { Pressable, StyleSheet, Text, View } from 'react-native';

export interface ScaleInputProps {
  label: string;
  value: number;
  onChange: (value: number) => void;
}

function ScaleInput({ label, value, onChange, min = 1, max = 10 }: ScaleInputProps & { min?: number; max?: number }) {
  const steps = Array.from({ length: max - min + 1 }, (_, i) => min + i);
  return (
    <View style={styles.field}>
      <View style={styles.fieldHeader}>
        <Text style={styles.fieldLabel}>{label}</Text>
        <Text style={styles.fieldValue}>{value}</Text>
      </View>
      <View style={styles.scaleRow}>
        {steps.map((step) => {
          const selected = step === value;
          return (
            <Pressable
              key={step}
              onPress={() => onChange(step)}
              accessibilityRole="button"
              accessibilityLabel={`${label} ${step} of ${max}`}
              accessibilityState={{ selected }}
              style={[styles.step, selected && styles.stepSelected]}>
              <Text style={[styles.stepText, selected && styles.stepTextSelected]}>{step}</Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

export default ScaleInput;

const styles = StyleSheet.create({
  field: {
    marginBottom: 18,
  },
  fieldHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  fieldLabel: {
    color: '#e2e8f0',
    fontSize: 15,
    fontWeight: '600',
  },
  fieldValue: {
    color: '#7dd3fc',
    fontSize: 16,
    fontWeight: '700',
  },
  scaleRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
  },
  step: {
    width: 30,
    height: 30,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#243141',
  },
  stepSelected: {
    backgroundColor: '#38bdf8',
  },
  stepText: {
    color: '#94a3b8',
    fontSize: 13,
    fontWeight: '600',
  },
  stepTextSelected: {
    color: '#0f1720',
  },
});
