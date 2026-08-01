# Настройка Firebase Cloud Messaging (действия владельца)

Этот документ — то, что должен сделать человек с доступом к Firebase Console
и Google Play/Apple Developer аккаунтам компании. Ничего из этого не может
быть автоматизировано агентом кода: нужны реальные учётные записи и решения
о product ownership (какой Google-аккаунт владеет проектом Firebase).

## 1. Создать проект Firebase

1. https://console.firebase.google.com → «Add project» → назвать, например,
   `resilient-taxi-prod` (и отдельно `resilient-taxi-staging`, если нужен
   изолированный staging-проект — рекомендуется, чтобы тестовые пуши не
   могли случайно уйти в prod-топики/аналитику).
2. Google Analytics для проекта Firebase не требуется — push не использует
   Firebase Analytics; можно отключить при создании.

## 2. Зарегистрировать Android-приложения (по одному на flavor)

driver-android собирается с тремя flavor'ами, у каждого свой
`applicationId` — в Firebase они регистрируются как **три отдельных
Android-приложения** внутри одного проекта:

| Flavor  | applicationId                              | Файл `google-services.json` (заменить placeholder)         |
| ------- | ------------------------------------------ | ---------------------------------------------------------- |
| dev     | `ru.location.resilienttaxi.driver.dev`     | `apps/driver-android/app/src/dev/google-services.json`     |
| staging | `ru.location.resilienttaxi.driver.staging` | `apps/driver-android/app/src/staging/google-services.json` |
| prod    | `ru.location.resilienttaxi.driver`         | `apps/driver-android/app/src/prod/google-services.json`    |

Для каждого: Firebase Console → Project settings → «Add app» → Android →
указать точный `applicationId` из таблицы → скачать `google-services.json` →
положить в указанный путь, заменив placeholder-файл (у него есть поле
`"_comment"`, прямо помечающее его как placeholder — по этому полю легко
проверить, что файл ещё не заменён).

passenger-mobile (Expo) регистрируется как Android-приложение только если
собирается нативный (non-Expo-Go) билд — Expo сам генерирует
`google-services.json`/`GoogleService-Info.plist` через
`app.json`/`app.config` на этапе EAS Build, если он указан в конфиге. Для
голого dev-режима через Expo Go push всё равно работает через
`Notifications.getDevicePushTokenAsync()`, который для managed workflow
получает нативный FCM-токен без отдельного `google-services.json` в
репозитории — при переходе на EAS Build нужно будет добавить
`google-services.json`/APNs-конфигурацию в EAS-секреты (см. документацию
Expo `expo-notifications` + FCM V1).

## 3. iOS: включить APNs через Firebase (Вариант B, см. `apns.md`)

Так как backend отправляет на iOS через FCM (не напрямую в APNs), для iOS
устройств нужно один раз загрузить в Firebase Console → Project settings →
Cloud Messaging → «Apple app configuration» → APNs Authentication Key:

1. Apple Developer → Certificates, Identifiers & Profiles → Keys → создать
   новый key с включённым «Apple Push Notifications service (APNs)».
2. Скачать `.p8`-файл (Apple выдаёт его **один раз**, повторно скачать
   нельзя — сохранить в защищённое хранилище секретов компании, не в git).
3. Загрузить `.p8` + Key ID + Team ID в Firebase Console (там же, где
   регистрируется iOS-приложение с `Bundle ID`).

Это разовая настройка на стороне Firebase — после неё backend продолжает
работать только с Firebase Admin SDK, не зная про APNs напрямую.

## 4. Сервисный аккаунт для backend (`firebase-admin`)

Backend аутентифицируется в Firebase не файлом `google-services.json` (это
клиентский конфиг), а сервисным аккаунтом:

1. Firebase Console → Project settings → Service accounts → «Generate new
   private key» → скачается JSON вида
   `{"project_id", "client_email", "private_key", ...}`.
2. Не коммитить этот JSON в репозиторий. Разложить три поля в переменные
   окружения backend (`.env`/секреты деплоя):
   - `FIREBASE_PROJECT_ID` = `project_id`
   - `FIREBASE_CLIENT_EMAIL` = `client_email`
   - `FIREBASE_PRIVATE_KEY` = `private_key` (сохраняет `\n` — при
     необходимости экранировать при вставке в `.env`, `FirebasePushProvider`
     ожидает обычный PEM-текст с реальными переводами строк)
3. Выполнять для **каждого** окружения (staging/prod) отдельно, с отдельными
   Firebase-проектами — не переиспользовать боевой сервисный аккаунт в
   staging.

## 5. Переключить окружение на реальный FCM

По умолчанию `PUSH_PROVIDER=development` (см. `.env.example`) — реальный
Firebase не задействован, `DevelopmentPushProvider` только логирует. Чтобы
включить реальную отправку:

```
PUSH_PROVIDER=fcm
FIREBASE_PROJECT_ID=...
FIREBASE_CLIENT_EMAIL=...
FIREBASE_PRIVATE_KEY=...
```

`PushProviderResolver` учитывает и `app.appEnvironment` — в `development`/
`test` `DevelopmentPushProvider` используется независимо от `PUSH_PROVIDER`
(см. `providers/push-provider-selection.ts`), так что случайно отправить
боевой пуш из локальной разработки нельзя.

## 6. Проверить интеграцию перед продакшеном

`pnpm staging:test:push` (см. корневой README/`../staging`) прогоняет полный
сценарий: регистрация токена → отправка → инбокс → админ-мониторинг —
но **всегда через `DevelopmentPushProvider`** (staging-инструмент
`/admin/staging/push/test-send` намеренно не бьёт в реальный FCM, см.
`monitoring.md`). Чтобы проверить именно реальную доставку в FCM, нужно
вручную зарегистрировать реальное устройство с `PUSH_PROVIDER=fcm` в
staging-окружении и убедиться, что push действительно приходит — это шаг,
который нельзя автоматизировать без реального устройства и реального
Firebase-проекта.

## Что НЕ входит в эту интеграцию

- Firebase Analytics/Crashlytics — не настраивались, они не нужны для push.
- Rich-уведомления с изображениями/действиями (`Notification Service
Extension` на iOS, `BigPictureStyle` на Android) — не реализованы;
  текущий payload — только заголовок/текст/data (см. `privacy.md`).
- Topic-based рассылка (`FirebaseMessaging.subscribeToTopic`) — намеренно не
  используется; таргетинг всегда по конкретным токенам конкретного
  пользователя, чтобы не создавать канал для широковещательного/маркетингового
  push в будущем без отдельного явного решения.
- Web Push (FCM для браузера) — passenger-mobile/driver-android покрыты,
  admin-web push-уведомления не реализованы (в этом нет требования задачи 28).
