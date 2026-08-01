# Deep links из push-уведомлений

## Схема

`resilienttaxi://` — общая схема для обоих мобильных приложений:

- **driver-android**: хост `driver` (`resilienttaxi://driver/...`), плюс
  `AndroidManifest.xml` регистрирует его как `ACTION_VIEW` +
  `CATEGORY_BROWSABLE` intent-filter на `MainActivity`
  (`android:launchMode="singleTask"`, `<data android:scheme="resilienttaxi"
  android:host="driver" />`).
- **passenger-mobile**: без выделенного хоста (`resilienttaxi://trips/...`,
  `resilienttaxi://payments/...`, `resilienttaxi://account/...`).
  `app.json` → `"scheme": ["resilienttaxi", "resilienttaxi-passenger"]`
  (второе значение — исходная, более узкая схема приложения, оставлена для
  обратной совместимости с уже установленными билдами).

Оба приложения используют одну и ту же схему `resilienttaxi://` — это
осознанный компромисс: DRIVER и PASSENGER — разные роли и в норме не
устанавливаются на одно устройство одновременно, поэтому конфликт
регистрации схемы не является практической проблемой. Если это когда-либо
изменится (например, тестовое устройство с обоими приложениями), Android/iOS
решают конфликт per-app disambiguation диалогом — deep link не сломается
молча, просто ОС спросит пользователя, каким приложением открыть.

## Обнаруженный и исправленный баг: рассинхронизация схемы

До этой задачи `passenger-mobile/app.json` объявлял `"scheme":
"resilienttaxi-passenger"`, а `NotificationTemplateService` всегда
формировал deep link вида `resilienttaxi://trips/{tripId}` — то есть **ни
один** push для пассажира не мог открыть приложение по ссылке: Android/iOS
искали обработчик схемы `resilienttaxi`, которого приложение не
регистрировало. Обнаружено при кросс-сверке реального вывода
`notification-template.service.ts` со значением `scheme` в манифесте
приложения — до этой сверки баг не проявлялся ни в одном тесте, потому что
ни один существующий тест не проверял связку «сгенерированная ссылка →
реально регистрируемая схема». Исправлено добавлением `resilienttaxi` в
список схем (см. выше).

## Allow-list маршрутов

Deep link — это только «куда перейти после открытия», не источник данных:
экран всегда сам обращается к REST/WebSocket за актуальным состоянием
(см. `../runbooks/push-provider-outage.md`, «push никогда не источник
истины»). Полный список маршрутов, которые реально генерирует
`NotificationTemplateService` (единственное место, формирующее deep link —
клиент не может получить произвольную ссылку не из этого списка):

| Deep link | Тип(ы) | Клиент | Экран |
|---|---|---|---|
| `driver/orders/{tripId}` | `DRIVER_NEW_TRIP_AVAILABLE` | driver-android | список заказов / карточка заказа |
| `driver/active-trip/{tripId}` | `DRIVER_BID_ACCEPTED`, `DRIVER_PAYMENT_RESERVED`, `DRIVER_PICKUP_REMINDER` | driver-android | экран активной поездки |
| `trips/{tripId}/bids` | `PASSENGER_BID_RECEIVED` | passenger-mobile | список предложений по поездке |
| `trips/{tripId}` | `PASSENGER_DRIVER_SELECTED`, `_EN_ROUTE`, `_ARRIVED`, `_TRIP_STARTED`, `_TRIP_COMPLETED`, `_TRIP_CANCELLED`, `PASSENGER_PAYMENT_RESERVED` | passenger-mobile | экран поездки |
| `payments/{paymentId}` | `PASSENGER_PAYMENT_FAILED`, `PASSENGER_REFUND_COMPLETED` | passenger-mobile | нет экрана (см. ниже) |
| `account/security` | `SECURITY_SESSION_REVOKED` | оба | нет экрана в passenger-mobile (см. ниже) |

Остальные 14 типов не несут deep link (`deepLink: () => null` в шаблоне) —
уведомление просто открывает приложение на текущем экране.

## Обработка на клиенте

### driver-android

`MainActivity.onNewIntent`/`tripIdFromIntent()` парсит только сегменты
`orders/{id}` и `active-trip/{id}` из пути intent'а — id извлекается как
голая строка пути, никакой дополнительной валидации UUID на этом этапе нет
(навигация всё равно ведёт только к запросу актуального состояния по этому
id через `DriverWorkspaceViewModel.handleDeepLink()` →
`refreshWorkspace()`; неверный/несуществующий id просто не найдёт заказ на
сервере). В приложении пока нет полноценного `NavHost` (задокументированный
компромисс, см. ниже) — переход отображается как отклоняемый баннер
«Открыто по уведомлению о поездке {id}» поверх текущего экрана рабочего
пространства, а не переход на отдельный экран.

### passenger-mobile

`src/features/notifications/payload.ts`:`routeForDeepLink(deepLink)` —
единственное место, транслирующее deep link в маршрут `expo-router`. Регэксп
`^resilienttaxi:\/\/trips\/([^/]+)` матчит только `trips/{id}` →
`/trip/${id}`; для `payments/...` и `account/security` функция намеренно
возвращает `null` — в приложении ещё нет экранов `/payment/[id]` и
`/account/security`, и `routeForDeepLink` не пытается угадывать
несуществующий маршрут. `app/_layout.tsx` подписывается на
`Notifications.addNotificationResponseReceivedListener` и вызывает
`router.push(path)` только когда `path` не `null` — тап по push с deep link
на ещё не реализованный экран просто открывает приложение на текущем
экране, без краша и без "белого экрана".

## Требования безопасности к deep link

- **Deep link никогда не несёт чувствительных данных** — только тип
  сущности + её id (см. `privacy.md`, `PushDataPayloadSchema.strict()`).
- **Переход по ссылке не равен авторизации** — каждый экран, открытый по
  deep link, обязан заново запросить данные через REST/WebSocket с текущим
  access-токеном; сервер применяет обычную проверку владения ресурсом
  (пассажир/водитель может увидеть только свою поездку/платёж) независимо от
  того, как получен id. Deep link из чужого/поддельного push не может
  раскрыть данные, к которым у текущего залогиненного пользователя нет прав.
- **Неизвестный/чужой id** — сервер отвечает обычной 403/404, клиент
  показывает нейтральную ошибку («Поездка не найдена»), а не техническую
  детализацию.
- **Идентификаторы — UUID** везде, где применимо
  (`PushDataPayloadSchema`: `tripId`/`bidId`/`paymentId`/`notificationId` —
  все `z.string().uuid()`) — payload, не проходящий строгую Zod-схему,
  вообще не попадёт в отправку (см. `privacy.md`).
