plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

val ksFile = rootProject.file("cloudsync.keystore")
val ksPass = System.getenv("KEYSTORE_PASS") ?: "cloudsync"

android {
    namespace = "com.cloudsync.app"
    compileSdk = 35

    defaultConfig {
        applicationId = "com.cloudsync.app"
        minSdk = 26
        targetSdk = 35
        versionCode = 3
        versionName = "2.2.0"
        resourceConfigurations += listOf("es", "en")
    }

    signingConfigs {
        if (ksFile.exists()) {
            create("propia") {
                storeFile = ksFile
                storePassword = ksPass
                keyAlias = System.getenv("KEY_ALIAS") ?: "cloudsync"
                keyPassword = ksPass
            }
        }
    }

    buildTypes {
        release {
            isMinifyEnabled = true
            isShrinkResources = true
            proguardFiles(
                getDefaultProguardFile("proguard-android-optimize.txt"),
                "proguard-rules.pro"
            )
            signingConfig =
                if (ksFile.exists()) signingConfigs.getByName("propia")
                else signingConfigs.getByName("debug")
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    kotlinOptions {
        jvmTarget = "17"
    }

    packaging {
        resources.excludes += setOf(
            "META-INF/*.kotlin_module",
            "META-INF/DEPENDENCIES",
            "META-INF/LICENSE*"
        )
    }
}

dependencies {
    implementation("androidx.core:core-ktx:1.13.1")
    implementation("androidx.appcompat:appcompat:1.7.0")
    implementation("com.google.android.material:material:1.12.0")
}
