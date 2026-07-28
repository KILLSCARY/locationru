# Resilient Taxi Driver Android

Android driver client built with Kotlin, Jetpack Compose, Material 3, Hilt,
Retrofit, Room, DataStore and WorkManager. `minSdk` is **23**, because the
current stable WorkManager line requires API 23+ and can use JobScheduler on
every supported device.

## Variants

- `devDebug` uses the development application id and local API base URL.
- `prodDebug` uses the production application id and production API base URL.

## Commands

```powershell
.\gradlew.bat :app:assembleDevDebug
.\gradlew.bat test
.\gradlew.bat detekt ktlintCheck
```

The project requires JDK 17, Android SDK Platform 36 and Build Tools 36.0.0.
It uses AGP 8.13 and Gradle 8.13 for compatibility with Hilt/KAPT.
GNSS and cellular collection are intentionally not implemented at this stage.

## Installable APK

A debug APK is produced by the `Android APK` GitHub Actions workflow
(`.github/workflows/android-apk.yml`) — run it manually (Run workflow) or push
to `master`, then download the `resilient-taxi-driver-dev-debug` artifact and
sideload the `.apk`. Locally, `./gradlew :app:assembleDevDebug` writes it to
`app/build/outputs/apk/dev/debug/`.

To reach a real backend, override the placeholder `API_BASE_URL` in the `dev`
flavor (`app/build.gradle.kts`) with a host the phone can actually reach. In
development the OTP code is written to the API log, not sent by SMS, until a
real SMS gateway is wired in.
