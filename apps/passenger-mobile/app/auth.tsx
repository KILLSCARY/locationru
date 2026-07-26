import { zodResolver } from '@hookform/resolvers/zod';
import { router } from 'expo-router';
import { useState } from 'react';
import { Controller, useForm } from 'react-hook-form';
import { Button, Text, TextInput } from 'react-native';
import * as SecureStore from 'expo-secure-store';
import { z } from 'zod';
import { requestCode, verifyCode } from '@/features/auth/api';
import { Screen } from '@/components/Screen';
import { useSessionStore } from '@/store/session';

const phoneSchema = z.object({ phone: z.string().min(8, 'Введите номер в международном формате') });
const codeSchema = z.object({ code: z.string().regex(/^\d{6}$/, 'Введите 6 цифр') });

export default function AuthScreen() {
  const [phone, setPhone] = useState('');
  const [codeRequested, setCodeRequested] = useState(false);
  const [error, setError] = useState<string>();
  const setSession = useSessionStore((state) => state.setSession);
  const phoneForm = useForm<z.infer<typeof phoneSchema>>({ resolver: zodResolver(phoneSchema) });
  const codeForm = useForm<z.infer<typeof codeSchema>>({ resolver: zodResolver(codeSchema) });

  const submitPhone = phoneForm.handleSubmit(async ({ phone: rawPhone }) => {
    setError(undefined);
    const normalized = rawPhone.replace(/[\s()-]/g, '');
    try {
      await requestCode(normalized);
      setPhone(normalized);
      setCodeRequested(true);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Не удалось отправить код');
    }
  });

  const submitCode = codeForm.handleSubmit(async ({ code }) => {
    setError(undefined);
    try {
      const deviceId = (await SecureStore.getItemAsync('passenger_device_id')) ?? `passenger-${Date.now()}`;
      await SecureStore.setItemAsync('passenger_device_id', deviceId);
      const tokens = await verifyCode(phone, code, deviceId);
      await setSession(tokens.accessToken, tokens.refreshToken);
      router.replace('/trip/new');
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Неверный код');
    }
  });

  return (
    <Screen>
      <Text>{codeRequested ? `Код отправлен на ${phone}` : 'Вход пассажира по телефону'}</Text>
      {!codeRequested ? (
        <>
          <Controller control={phoneForm.control} name="phone" render={({ field }) => <TextInput placeholder="+7 999 123-45-67" value={field.value} onChangeText={field.onChange} />} />
          {phoneForm.formState.errors.phone && <Text>{phoneForm.formState.errors.phone.message}</Text>}
          <Button title="Получить код" onPress={submitPhone} />
        </>
      ) : (
        <>
          <Controller control={codeForm.control} name="code" render={({ field }) => <TextInput keyboardType="number-pad" placeholder="Код из SMS" value={field.value} onChangeText={field.onChange} />} />
          {codeForm.formState.errors.code && <Text>{codeForm.formState.errors.code.message}</Text>}
          <Button title="Войти" onPress={submitCode} />
        </>
      )}
      {error && <Text>{error}</Text>}
    </Screen>
  );
}
