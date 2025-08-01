import java.io.File

android {
    buildTypes {
        getByName("release") {
            // Include proguard rules provided by the Tauri tooling if they exist.
            val tauriProguard = project.file("proguard-tauri.pro")
            if (tauriProguard.exists()) {
                proguardFiles(tauriProguard)
            }
        }
    }
}
