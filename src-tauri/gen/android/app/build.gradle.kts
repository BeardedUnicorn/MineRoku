import java.io.FileInputStream
import java.util.Properties
import org.gradle.api.JavaVersion
import org.jetbrains.kotlin.gradle.dsl.JvmTarget

plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
    id("rust")
}

// Load Tauri properties
val tauriProperties = Properties().apply {
    val propFile = project.file("tauri.properties")
    if (propFile.exists()) {
        propFile.inputStream().use { load(it) }
    }
}

android {
    compileSdk = 37
    namespace = "com.rokucontroller.remote"

    defaultConfig {
        applicationId = "com.rokucontroller.remote"
        minSdk = 24
        targetSdk = 37
        versionCode = tauriProperties
            .getProperty("tauri.android.versionCode", "1")
            .toInt()
        versionName = tauriProperties
            .getProperty("tauri.android.versionName", "1.0")
    }

    signingConfigs {
        create("release") {
            val keyPropertiesFile = rootProject.file("keystore.properties")
            if (keyPropertiesFile.exists()) {
                val keyProps = Properties().apply {
                    load(FileInputStream(keyPropertiesFile))
                }
                keyAlias = keyProps.getProperty("keyAlias")
                keyPassword = keyProps.getProperty("password")
                storeFile = file(keyProps.getProperty("storeFile"))
                storePassword = keyProps.getProperty("password")
            }
        }
    }

    buildTypes {
        getByName("debug") {
            isDebuggable = true
            isJniDebuggable = true
            isMinifyEnabled = false
            packaging {
                jniLibs.keepDebugSymbols.add("*/arm64-v8a/*.so")
                jniLibs.keepDebugSymbols.add("*/armeabi-v7a/*.so")
                jniLibs.keepDebugSymbols.add("*/x86/*.so")
                jniLibs.keepDebugSymbols.add("*/x86_64/*.so")
            }
        }
        getByName("release") {
            isMinifyEnabled = true
            signingConfig = signingConfigs.getByName("release")
            proguardFiles(
                *fileTree(".") { include("**/*.pro") }
                    .plus(getDefaultProguardFile("proguard-android-optimize.txt"))
                    .toList()
                    .toTypedArray()
            )
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    buildFeatures {
        buildConfig = true
    }
}

kotlin {
    compilerOptions {
        jvmTarget = JvmTarget.JVM_17
    }
}

rust {
    rootDirRel = "../../../"
}

dependencies {
    implementation("androidx.webkit:webkit:1.18.0")
    implementation("androidx.appcompat:appcompat:1.8.0")
    implementation("com.google.android.material:material:1.14.0")
    implementation("androidx.media:media:1.8.0")
    implementation("org.jetbrains.kotlinx:kotlinx-coroutines-android:1.11.0")
    testImplementation("junit:junit:4.13.2")
    androidTestImplementation("androidx.test.ext:junit:1.3.0")
    androidTestImplementation("androidx.test.espresso:espresso-core:3.7.0")
}

apply(from = project.file("tauri.build.gradle.kts"))
