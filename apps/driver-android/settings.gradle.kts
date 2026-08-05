pluginManagement {
    repositories {
        google()
        mavenCentral()
        gradlePluginPortal()
    }
}

dependencyResolutionManagement {
    repositoriesMode.set(RepositoriesMode.FAIL_ON_PROJECT_REPOS)
    repositories {
        google()
        mavenCentral()
    }
}

rootProject.name = "ResilientTaxiDriver"

include(":app")
include(":domain")
include(":core:network")
include(":core:database")
include(":core:location")
include(":core:push")
include(":core:maps")
include(":core:maps-yandex")
include(":core:designsystem")
include(":feature:auth")
include(":feature:home")
include(":feature:orders")
include(":feature:active-trip")
include(":feature:earnings")
