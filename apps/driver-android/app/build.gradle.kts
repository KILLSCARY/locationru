plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
    id("org.jetbrains.kotlin.plugin.compose")
    id("org.jetbrains.kotlin.kapt")
    id("com.google.dagger.hilt.android")
}

// Resolves the API base URL for a flavor, in order of precedence:
// Gradle property (-PdriverDevApiBaseUrl=...), environment variable
// (DRIVER_DEV_API_BASE_URL), then the placeholder default. Lets CI and local
// builds target a real backend without editing this file.
fun apiBaseUrl(
    flavor: String,
    default: String,
): String {
    val property = "driver${flavor.replaceFirstChar(Char::uppercase)}ApiBaseUrl"
    val environment = "DRIVER_${flavor.uppercase()}_API_BASE_URL"
    return (project.findProperty(property) as String?)?.takeIf { it.isNotBlank() }
        ?: System.getenv(environment)?.takeIf { it.isNotBlank() }
        ?: default
}

// Yandex MapKit API key, from a Gradle property (-PmapkitApiKey=...) or the
// MAPKIT_API_KEY environment variable (a GitHub Actions secret in CI). Empty
// when unset — the app then shows a placeholder instead of the map.
fun mapkitApiKey(): String =
    (project.findProperty("mapkitApiKey") as String?)?.takeIf { it.isNotBlank() }
        ?: System.getenv("MAPKIT_API_KEY")?.takeIf { it.isNotBlank() }
        ?: ""

android {
    namespace = "ru.location.resilienttaxi.driver"
    compileSdk = 36

    defaultConfig {
        applicationId = "ru.location.resilienttaxi.driver"
        // Yandex MapKit requires minSdk 26.
        minSdk = 26
        targetSdk = 36
        versionCode = 1
        versionName = "0.1.0"
        testInstrumentationRunner = "androidx.test.runner.AndroidJUnitRunner"
        buildConfigField("String", "MAPKIT_API_KEY", "\"${mapkitApiKey()}\"")
    }

    flavorDimensions += "environment"
    productFlavors {
        create("dev") {
            dimension = "environment"
            applicationIdSuffix = ".dev"
            versionNameSuffix = "-dev"
            val url = apiBaseUrl("dev", "https://api-dev.example.invalid/api/v1/")
            buildConfigField("String", "API_BASE_URL", "\"$url\"")
        }
        create("prod") {
            dimension = "environment"
            val url = apiBaseUrl("prod", "https://api.example.invalid/api/v1/")
            buildConfigField("String", "API_BASE_URL", "\"$url\"")
        }
    }

    buildFeatures {
        buildConfig = true
        compose = true
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
}

kotlin {
    jvmToolchain(17)
}

// The offline development map view is forbidden in production. This is
// attached to the prod assemble/bundle tasks' *execution* (not project
// configuration), so it only fails a build that actually produces a prod
// artifact — a plain `assembleDevDebug` never needs a key.
afterEvaluate {
    tasks
        .matching { it.name.startsWith("assembleProd") || it.name.startsWith("bundleProd") }
        .configureEach {
            doFirst {
                check(mapkitApiKey().isNotBlank()) {
                    "MAPKIT_API_KEY (or -PmapkitApiKey=...) is required to build the prod flavor; " +
                        "the development map view must not ship in production."
                }
            }
        }
}

dependencies {
    implementation(project(":domain"))
    implementation(project(":core:network"))
    implementation(project(":core:database"))
    implementation(project(":core:location"))
    implementation(project(":core:maps"))
    implementation(project(":core:maps-yandex"))
    implementation(project(":core:designsystem"))
    implementation(project(":feature:auth"))
    implementation(project(":feature:home"))
    implementation(project(":feature:orders"))
    implementation(project(":feature:active-trip"))
    implementation(project(":feature:earnings"))

    implementation(platform("androidx.compose:compose-bom:2026.06.00"))
    implementation("androidx.activity:activity-compose:1.13.0")
    implementation("androidx.compose.material3:material3")
    implementation("androidx.navigation:navigation-compose:2.9.6")
    implementation("androidx.lifecycle:lifecycle-runtime-ktx:2.10.0")
    implementation("androidx.lifecycle:lifecycle-runtime-compose:2.10.0")
    implementation("androidx.lifecycle:lifecycle-viewmodel-compose:2.10.0")
    implementation("com.yandex.android:maps.mobile:4.42.0-lite")
    implementation("androidx.work:work-runtime-ktx:2.11.2")
    implementation("com.squareup.retrofit2:retrofit:2.11.0")
    implementation("com.squareup.retrofit2:converter-kotlinx-serialization:2.11.0")
    implementation("com.squareup.okhttp3:okhttp:4.12.0")
    implementation("io.socket:socket.io-client:2.1.1")
    implementation("org.jetbrains.kotlinx:kotlinx-serialization-json:1.8.1")
    implementation("com.google.dagger:hilt-android:2.57.2")
    implementation("androidx.hilt:hilt-navigation-compose:1.2.0")
    kapt("com.google.dagger:hilt-compiler:2.57.2")

    testImplementation("junit:junit:4.13.2")
}
