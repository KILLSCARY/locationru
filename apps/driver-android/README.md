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
