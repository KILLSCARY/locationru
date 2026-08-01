# APNs: выбранный вариант и обоснование

## Что реализовано: Вариант B (FCM → APNs passthrough)

Реализация — `apps/api/src/notifications/providers/apns-push.provider.ts`.
`ApnsPushProvider` не содержит собственной логики отправки: каждый метод
(`sendToDevice`/`sendToDevices`/`validateToken`/`disableToken`/`healthCheck`)
делегирует в `FirebasePushProvider`. Прямого клиента APNs (HTTP/2 + `.p8`
JWT, `apn`/`node-apn` или аналог) в кодовой базе нет.

Это работает потому, что iOS-приложение (passenger-mobile через Expo/
`expo-notifications`, при использовании нативного FCM-SDK на iOS) получает
свой push-токен через Firebase iOS SDK — то, что приходит в
`POST /notifications/devices` для iOS-устройства, уже является FCM
registration token, а не «сырым» APNs device token. `FirebasePushProvider.
platformConfig()` уже собирает блок `apns` (priority/expiration/collapse-id/
push-type) на каждое сообщение (см. `firebase-push.provider.ts`) — именно
этот блок долетает до устройства через APNs, потому что сам Firebase
пересылает сообщение туда за нас (после того как в Firebase Console один раз
загружен APNs Authentication Key — см. `fcm.md`, шаг 3).

`PushProviderType.APNS` при этом остаётся отдельным, осмысленным значением:
при регистрации токена iOS-устройство помечается `provider: APNS` (в
отличие от Android → `FCM`), что нужно для статистики/мониторинга
(`monitoring.md`) и для того, чтобы `PushProviderResolver` мог в будущем
подставить другую реализацию под этот тип без изменения схемы БД.

## Почему не Вариант A (прямой APNs-клиент)

Прямой APNs потребовал бы:

- отдельного `.p8`-ключа/сертификата и обязательного различения
  sandbox/production APNs-хостов (`api.sandbox.push.apple.com` /
  `api.push.apple.com`) — ещё один набор секретов и ещё один свитч по
  окружению, полностью параллельный тому, что уже есть у FCM;
- отдельного HTTP/2-клиента и обработки кодов ошибок APNs
  (`BadDeviceToken`, `Unregistered` и т.д.), не пересекающихся с обработкой
  ошибок FCM в `FirebasePushProvider`;
- отдельного места хранения APNs device token — но текущая схема
  `DevicePushToken` не различает «сырой APNs-токен» и «FCM-токен на iOS»
  на уровне структуры данных, что означало бы миграцию.

Плата за Вариант B — все iOS-пуши зависят от доступности релея Firebase→APNs,
а не только от APNs напрямую (см. `../runbooks/push-provider-outage.md`).
Это принятый компромисс: меньше кода и секретов для поддержки, при
незначительно возросшем радиусе отказа (Firebase почти никогда не является
единственной причиной недоступности, когда APNs сам по себе работает).

## Что нужно, чтобы добавить Вариант A позже

Если в будущем понадобится прямой APNs-клиент (например, из-за отказа
Firebase-релея или потребности в APNs-специфичных фичах вроде
`VoIP`-пушей или `Notification Service Extension` для расшифровки
end-to-end зашифрованного контента):

1. Добавить `.p8`/Key ID/Team ID/Bundle ID как отдельные `APNS_*`
   переменные окружения — они уже зарезервированы в `.env.example`
   (`APNS_TEAM_ID`, `APNS_KEY_ID`, `APNS_PRIVATE_KEY`, `APNS_BUNDLE_ID`,
   `APNS_USE_SANDBOX`), но пока ничем не используются.
2. Реализовать `ApnsPushProvider` как самостоятельный класс, реализующий
   `PushProvider` напрямую (HTTP/2 JWT-аутентификация), без делегирования в
   `FirebasePushProvider`.
3. Решить, как клиент отличает «зарегистрировать через Firebase iOS SDK» от
   «зарегистрировать сырой APNs device token» — потребует либо нового поля в
   `RegisterDeviceRequestSchema`, либо полного перехода iOS на
   `PKPushRegistry`/`UNUserNotificationCenter` вместо Firebase SDK.
4. Обновить `PushProviderResolver`/`push-provider-selection.ts`, чтобы для
   `platform: IOS` в проде выбирался новый прямой клиент вместо
   `FirebasePushProvider`-based `ApnsPushProvider`.

Ничего из этого не начато — задокументировано как явный путь развития, а не
недоделанная часть текущей задачи (текущая задача явно допускала оба
варианта и требовала зафиксировать выбор, что и сделано выше).
