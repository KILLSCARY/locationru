import { zodResolver } from '@hookform/resolvers/zod';
import { router } from 'expo-router';
import { Controller, useForm } from 'react-hook-form';
import { Button, Text, TextInput } from 'react-native';
import { z } from 'zod';
import { Screen } from '@/components/Screen';
import { createTrip, startSearch } from '@/features/trips/api';
import { useSessionStore } from '@/store/session';

const coordinates = z.coerce.number().finite();
const formSchema = z.object({
  pickupLatitude: coordinates.min(-90).max(90),
  pickupLongitude: coordinates.min(-180).max(180),
  destinationLatitude: coordinates.min(-90).max(90),
  destinationLongitude: coordinates.min(-180).max(180),
  pickupAddress: z.string().min(2),
  destinationAddress: z.string().min(2),
  passengerPriceKopecks: z.coerce.number().int().positive(),
});
type FormInput = z.input<typeof formSchema>;
type FormValues = z.output<typeof formSchema>;

const fields: Array<{ name: keyof FormValues; placeholder: string; numeric?: boolean }> = [
  { name: 'pickupLatitude', placeholder: 'Широта подачи, например 55.7558', numeric: true },
  { name: 'pickupLongitude', placeholder: 'Долгота подачи, например 37.6173', numeric: true },
  { name: 'pickupAddress', placeholder: 'Адрес подачи' },
  { name: 'destinationLatitude', placeholder: 'Широта назначения', numeric: true },
  { name: 'destinationLongitude', placeholder: 'Долгота назначения', numeric: true },
  { name: 'destinationAddress', placeholder: 'Адрес назначения' },
  { name: 'passengerPriceKopecks', placeholder: 'Цена в копейках', numeric: true },
];

export default function NewTripScreen() {
  const setActiveTripId = useSessionStore((state) => state.setActiveTripId);
  const form = useForm<FormInput, unknown, FormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: { pickupLatitude: 55.7558, pickupLongitude: 37.6173, destinationLatitude: 55.7512, destinationLongitude: 37.6184, passengerPriceKopecks: 50000 },
  });
  const submit = form.handleSubmit(async (values) => {
    const trip = await createTrip({
      pickup: { latitude: values.pickupLatitude, longitude: values.pickupLongitude },
      destination: { latitude: values.destinationLatitude, longitude: values.destinationLongitude },
      pickupAddress: values.pickupAddress,
      destinationAddress: values.destinationAddress,
      passengerPriceKopecks: values.passengerPriceKopecks,
    });
    await startSearch(trip.id);
    await setActiveTripId(trip.id);
    router.replace(`/trip/${trip.id}`);
  });
  return (
    <Screen>
      <Text>Создание заказа. Пока используются текстовые координаты и адреса.</Text>
      {fields.map(({ name, placeholder, numeric }) => (
        <Controller
          key={name}
          control={form.control}
          name={name}
          render={({ field }) => (
            <TextInput
              placeholder={placeholder}
              keyboardType={numeric ? 'decimal-pad' : 'default'}
              value={field.value === undefined ? '' : String(field.value)}
              onChangeText={field.onChange}
            />
          )}
        />
      ))}
      {form.formState.errors.root && <Text>{form.formState.errors.root.message}</Text>}
      <Button title={form.formState.isSubmitting ? 'Создаём…' : 'Создать и начать поиск'} onPress={submit} disabled={form.formState.isSubmitting} />
    </Screen>
  );
}
