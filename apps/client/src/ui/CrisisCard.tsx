/**
 * The resource card. Shown whenever the crisis gate matches, before the
 * entry is saved. It never blocks: the entry saves whether or not the person
 * taps anything here. Plain words, real numbers, no interpretation.
 */
import React from 'react';
import { Linking, View } from 'react-native';
import { CRISIS_RESOURCES, type CrisisResourceId } from '@ledger/shared';
import { Button, Card, H2, P, Small, useTheme } from './index';

export function CrisisCard({ resources, onDismiss }: { resources: CrisisResourceId[]; onDismiss: () => void }) {
  const t = useTheme();
  return (
    <Card style={{ borderColor: t.accent, borderWidth: 2 }}>
      <H2>If any part of this is about wanting to die or hurt yourself</H2>
      <P>You don’t have to be sure. These lines are for exactly this, any hour, and you can hang up whenever you want.</P>
      {resources.map((id) => {
        const r = CRISIS_RESOURCES[id];
        const tel = 'tel' in r ? r.tel : undefined;
        const sms = 'sms' in r ? r.sms : undefined;
        return (
          <View key={id} style={{ marginBottom: 8 }}>
            <P style={{ fontWeight: '600', marginBottom: 2 }}>{r.name}</P>
            <Small>{r.action}</Small>
            <View style={{ flexDirection: 'row', gap: 8 }}>
              {tel ? <Button title={`Call ${tel}`} kind="secondary" onPress={() => Linking.openURL(`tel:${tel}`)} /> : null}
              {sms ? <Button title={`Text ${sms}`} kind="secondary" onPress={() => Linking.openURL(`sms:${sms}`)} /> : null}
            </View>
          </View>
        );
      })}
      <Small>CourageLoop is a notebook, not a therapist. This card is a pointer to people who can help; it is not help.</Small>
      <Button title="Continue" kind="link" onPress={onDismiss} />
    </Card>
  );
}
