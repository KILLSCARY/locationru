import { zodResolver } from '@hookform/resolvers/zod';
import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { Controller, useForm } from 'react-hook-form';
import { Button, Text, TextInput } from 'react-native';
import { z } from 'zod';
import { requestCode, resendCode, verifyCode } from '@/features/auth/api';
import { Screen } from '@/components/Screen';
import { useSessionStore } from '@/store/session';

const phoneSchema = z.object({
  phone: z.string().min(8, 'Введите номер в международном формате'),
});
const codeSchema = z.object({
  code: z.string().regex(/^\d{4,10}$/, 'Введите код из SMS'),
});

function maskPhone(phone: string): string {
  return phone.length > 4
    ? `${phone.slice(0, 2)}${'*'.repeat(phone.length - 4)}${phone.slice(-2)}`
    : phone;
}

export default function AuthScreen() {
  const [phone, setPhone] = useState('');
  const [requestId, setRequestId] = useState<string>();
  // Absolute wall-clock timestamp, not a countdown value — surviving app
  // backgrounding/foregrounding without needing to persist a running timer.
  const [resendAvailableAt, setResendAvailableAt] = useState<number>();
  const [remainingSeconds, setRemainingSeconds] = useState(0);
  const [error, setError] = useState<string>();
  const setSession = useSessionStore((state) => state.setSession);
  const phoneForm = useForm<z.infer<typeof phoneSchema>>({
    resolver: zodResolver(phoneSchema),
  });
  const codeForm = useForm<z.infer<typeof codeSchema>>({
    resolver: zodResolver(codeSchema),
  });

  useEffect(() => {
    if (!resendAvailableAt) return;
    const tick = () => {
      setRemainingSeconds(
        Math.max(0, Math.ceil((resendAvailableAt - Date.now()) / 1000)),
      );
    };
    tick();
    const interval = setInterval(tick, 1000);
    return () => clearInterval(interval);
  }, [resendAvailableAt]);

  const submitPhone = phoneForm.handleSubmit(async ({ phone: rawPhone }) => {
    setError(undefined);
    const normalized = rawPhone.replace(/[\s()-]/g, '');
    try {
      const result = await requestCode(normalized);
      setPhone(normalized);
      setRequestId(result.requestId);
      setResendAvailableAt(Date.now() + result.resendInSeconds * 1_000);
    } catch (reason) {
      setError(
        reason instanceof Error ? reason.message : 'Не удалось отправить код',
      );
    }
  });

  const submitResend = async () => {
    if (!requestId || remainingSeconds > 0) return;
    setError(undefined);
    try {
      const result = await resendCode(requestId, phone);
      setResendAvailableAt(Date.now() + result.resendInSeconds * 1_000);
    } catch (reason) {
      setError(
        reason instanceof Error
          ? reason.message
          : 'Не удалось отправить код повторно',
      );
    }
  };

  const submitCode = codeForm.handleSubmit(async ({ code }) => {
    if (!requestId) return;
    setError(undefined);
    try {
      const tokens = await verifyCode(requestId, phone, code);
      await setSession(tokens.accessToken, tokens.refreshToken);
      router.replace('/trip/new');
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Неверный код');
    }
  });

  return (
    <Screen>
      <Text>
        {requestId
          ? `Код отправлен на ${maskPhone(phone)}`
          : 'Вход пассажира по телефону'}
      </Text>
      {!requestId ? (
        <>
          <Controller
            control={phoneForm.control}
            name="phone"
            render={({ field }) => (
              <TextInput
                placeholder="+7 999 123-45-67"
                value={field.value}
                onChangeText={field.onChange}
              />
            )}
          />
          {phoneForm.formState.errors.phone && (
            <Text>{phoneForm.formState.errors.phone.message}</Text>
          )}
          <Button title="Получить код" onPress={submitPhone} />
        </>
      ) : (
        <>
          <Controller
            control={codeForm.control}
            name="code"
            render={({ field }) => (
              <TextInput
                keyboardType="number-pad"
                textContentType="oneTimeCode"
                autoComplete="sms-otp"
                placeholder="Код из SMS"
                value={field.value}
                onChangeText={field.onChange}
              />
            )}
          />
          {codeForm.formState.errors.code && (
            <Text>{codeForm.formState.errors.code.message}</Text>
          )}
          <Button title="Войти" onPress={submitCode} />
          <Button
            title={
              remainingSeconds > 0
                ? `Отправить повторно (${remainingSeconds}с)`
                : 'Отправить код повторно'
            }
            onPress={submitResend}
            disabled={remainingSeconds > 0}
          />
        </>
      )}
      {error && <Text>{error}</Text>}
    </Screen>
  );
}
