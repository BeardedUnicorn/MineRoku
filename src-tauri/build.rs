fn main() {
    // Google Play requires 16 KB page-size support. NDK r28+ aligns to 16 KB by default; the
    // flags make it explicit so older NDKs produce a compatible library too.
    if std::env::var("CARGO_CFG_TARGET_OS").as_deref() == Ok("android") {
        println!("cargo:rustc-link-arg=-Wl,-z,max-page-size=16384");
        println!("cargo:rustc-link-arg=-Wl,-z,common-page-size=16384");
    }

    tauri_build::build()
}
