plugins {
    id("com.android.application") version "8.13.0" apply false
    id("com.android.library") version "8.13.0" apply false
    id("org.jetbrains.kotlin.android") version "2.2.21" apply false
    id("org.jetbrains.kotlin.jvm") version "2.2.21" apply false
    id("org.jetbrains.kotlin.plugin.compose") version "2.2.21" apply false
    id("org.jetbrains.kotlin.kapt") version "2.2.21" apply false
    id("org.jetbrains.kotlin.plugin.serialization") version "2.2.21" apply false
    id("com.google.dagger.hilt.android") version "2.57.2" apply false
    id("io.gitlab.arturbosch.detekt") version "1.23.8" apply false
    id("org.jlleitschuh.gradle.ktlint") version "13.1.0" apply false
}

subprojects {
    plugins.withId("org.jetbrains.kotlin.android") {
        apply(plugin = "io.gitlab.arturbosch.detekt")
        apply(plugin = "org.jlleitschuh.gradle.ktlint")
    }
    plugins.withId("org.jetbrains.kotlin.jvm") {
        apply(plugin = "io.gitlab.arturbosch.detekt")
        apply(plugin = "org.jlleitschuh.gradle.ktlint")
    }
}

tasks.register("unitTest") {
    group = "verification"
    description = "Runs unit tests for every Android build variant."
    dependsOn(":app:testDevDebugUnitTest", ":app:testProdDebugUnitTest", ":domain:test")
}

tasks.register("quality") {
    group = "verification"
    description = "Runs static analysis for all Android modules."
    dependsOn("detekt", "ktlintCheck")
}
