plugins {
    id("com.android.library")
    id("org.jetbrains.kotlin.android")
}

// Deliberately no kapt/Hilt here: kapt's javac-based stub generator cannot
// read some of this AAR's class files (Yandex MapKit ships classes built for
// a newer bytecode version than kapt's stub compiler accepts), so any module
// that stores a MapKit-typed property or exposes one in a function signature
// must stay outside annotation processing. See YandexMapProvider's kdoc.
android {
    namespace = "ru.location.resilienttaxi.driver.core.maps.yandex"
    compileSdk = 36
    defaultConfig {
        // Matches :app — Yandex MapKit requires minSdk 26.
        minSdk = 26
    }
    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
}

kotlin {
    jvmToolchain(17)
}

dependencies {
    implementation(project(":core:maps"))
    implementation("com.yandex.android:maps.mobile:4.42.0-lite")
}
