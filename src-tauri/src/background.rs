use once_cell::sync::Lazy;
use rusqlite::{params, Connection, Result as SqliteResult};
use serde::{Deserialize, Serialize};
use std::sync::{Arc, Mutex};
use tauri::async_runtime;
use tokio::sync::mpsc;
use tokio::sync::oneshot;

#[derive(Debug)]
pub enum BackgroundTask {
    CacheIcon {
        device_ip: String,
        app_id: String,
        icon_data: String,
        response: oneshot::Sender<SqliteResult<()>>,
    },
    GetIcon {
        device_ip: String,
        app_id: String,
        response: oneshot::Sender<SqliteResult<Option<String>>>,
    },
    CacheDevice {
        device: DeviceCache,
        response: oneshot::Sender<SqliteResult<()>>,
    },
    GetDevices {
        response: oneshot::Sender<SqliteResult<Vec<DeviceCache>>>,
    },
    CacheAppList {
        device_ip: String,
        apps: Vec<AppCache>,
        response: oneshot::Sender<SqliteResult<()>>,
    },
    GetApps {
        device_ip: String,
        response: oneshot::Sender<SqliteResult<Vec<AppCache>>>,
    },
    DeleteDevice {
        hardware_id: String,
        response: oneshot::Sender<SqliteResult<Option<String>>>,
    },
    ClearAllData {
        response: oneshot::Sender<SqliteResult<()>>,
    },
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DeviceCache {
    pub name: String,
    pub ip: String,
    pub port: u16,
    pub url: String,
    pub hardware_id: String,
    pub last_seen: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AppCache {
    pub id: String,
    pub name: String,
    pub version: String,
}

static TASK_SENDER: Lazy<Arc<Mutex<Option<mpsc::UnboundedSender<BackgroundTask>>>>> =
    Lazy::new(|| Arc::new(Mutex::new(None)));

pub struct DatabaseManager {
    conn: Arc<Mutex<Connection>>,
}

impl DatabaseManager {
    pub fn new(db_path: &str) -> SqliteResult<Self> {
        let conn = Connection::open(db_path)?;
        
        conn.execute(
            "CREATE TABLE IF NOT EXISTS icons (
                device_ip TEXT NOT NULL,
                app_id TEXT NOT NULL,
                icon_data TEXT NOT NULL,
                cached_at INTEGER NOT NULL,
                PRIMARY KEY (device_ip, app_id)
            )",
            [],
        )?;

        // Legacy installs created `apps` with FOREIGN KEY (device_ip) REFERENCES devices(ip).
        // Since devices is keyed by hardware_id, ip is no longer unique, and SQLite rejects
        // every write to either table with "foreign key mismatch". apps is only a cache, so
        // drop it and let the CREATE below rebuild it without the key. This runs before the
        // devices migration so dropping an IP-keyed devices table can't cascade through it.
        let apps_has_fk: bool = conn.query_row(
            "SELECT COUNT(*) FROM pragma_foreign_key_list('apps')",
            [],
            |row| row.get::<_, i64>(0),
        )? > 0;
        if apps_has_fk {
            conn.execute("DROP TABLE apps", [])?;
        }

        // Check if old devices table exists and needs migration
        let has_hardware_id: bool = {
            let mut stmt = conn.prepare(
                "SELECT COUNT(*) FROM pragma_table_info('devices') WHERE name='hardware_id'"
            )?;
            stmt.query_row([], |row| row.get::<_, i32>(0))? > 0
        };

        if !has_hardware_id {
            // Drop old table and create new one with hardware_id
            conn.execute("DROP TABLE IF EXISTS devices", [])?;
        }

        conn.execute(
            "CREATE TABLE IF NOT EXISTS devices (
                hardware_id TEXT PRIMARY KEY,
                ip TEXT NOT NULL,
                name TEXT NOT NULL,
                port INTEGER NOT NULL,
                url TEXT NOT NULL,
                last_seen INTEGER NOT NULL
            )",
            [],
        )?;

        conn.execute(
            "CREATE INDEX IF NOT EXISTS idx_devices_ip ON devices(ip)",
            [],
        )?;

        conn.execute(
            "CREATE TABLE IF NOT EXISTS apps (
                device_ip TEXT NOT NULL,
                app_id TEXT NOT NULL,
                name TEXT NOT NULL,
                version TEXT NOT NULL,
                cached_at INTEGER NOT NULL,
                PRIMARY KEY (device_ip, app_id)
            )",
            [],
        )?;

        conn.execute(
            "CREATE INDEX IF NOT EXISTS idx_icons_device ON icons(device_ip)",
            [],
        )?;

        conn.execute(
            "CREATE INDEX IF NOT EXISTS idx_apps_device ON apps(device_ip)",
            [],
        )?;

        Ok(DatabaseManager {
            conn: Arc::new(Mutex::new(conn)),
        })
    }

    fn cache_icon(&self, device_ip: &str, app_id: &str, icon_data: &str) -> SqliteResult<()> {
        let conn = self.conn.lock().unwrap();
        let now = chrono::Utc::now().timestamp();
        
        conn.execute(
            "INSERT OR REPLACE INTO icons (device_ip, app_id, icon_data, cached_at) 
             VALUES (?1, ?2, ?3, ?4)",
            params![device_ip, app_id, icon_data, now],
        )?;
        Ok(())
    }

    fn get_icon(&self, device_ip: &str, app_id: &str) -> SqliteResult<Option<String>> {
        let conn = self.conn.lock().unwrap();
        
        let mut stmt = conn.prepare(
            "SELECT icon_data FROM icons WHERE device_ip = ?1 AND app_id = ?2"
        )?;
        
        let result = stmt.query_row(params![device_ip, app_id], |row| {
            row.get::<_, String>(0)
        });

        match result {
            Ok(icon) => Ok(Some(icon)),
            Err(rusqlite::Error::QueryReturnedNoRows) => Ok(None),
            Err(e) => Err(e),
        }
    }

    fn cache_device(&self, device: &DeviceCache) -> SqliteResult<()> {
        let conn = self.conn.lock().unwrap();
        
        conn.execute(
            "INSERT OR REPLACE INTO devices (hardware_id, ip, name, port, url, last_seen) 
             VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
            params![device.hardware_id, device.ip, device.name, device.port, device.url, device.last_seen],
        )?;
        Ok(())
    }

    fn get_devices(&self) -> SqliteResult<Vec<DeviceCache>> {
        let conn = self.conn.lock().unwrap();
        
        let mut stmt = conn.prepare(
            "SELECT hardware_id, ip, name, port, url, last_seen FROM devices ORDER BY last_seen DESC"
        )?;
        
        let devices = stmt.query_map([], |row| {
            Ok(DeviceCache {
                hardware_id: row.get(0)?,
                ip: row.get(1)?,
                name: row.get(2)?,
                port: row.get(3)?,
                url: row.get(4)?,
                last_seen: row.get(5)?,
            })
        })?;

        devices.collect()
    }

    fn cache_app_list(&self, device_ip: &str, apps: &[AppCache]) -> SqliteResult<()> {
        let conn = self.conn.lock().unwrap();
        let now = chrono::Utc::now().timestamp();

        let tx = conn.unchecked_transaction()?;
        
        tx.execute("DELETE FROM apps WHERE device_ip = ?1", params![device_ip])?;
        
        for app in apps {
            tx.execute(
                "INSERT INTO apps (device_ip, app_id, name, version, cached_at) 
                 VALUES (?1, ?2, ?3, ?4, ?5)",
                params![device_ip, &app.id, &app.name, &app.version, now],
            )?;
        }
        
        tx.commit()?;
        Ok(())
    }

    fn get_apps(&self, device_ip: &str) -> SqliteResult<Vec<AppCache>> {
        let conn = self.conn.lock().unwrap();
        
        let mut stmt = conn.prepare(
            "SELECT app_id, name, version FROM apps WHERE device_ip = ?1 ORDER BY name"
        )?;
        
        let apps = stmt.query_map(params![device_ip], |row| {
            Ok(AppCache {
                id: row.get(0)?,
                name: row.get(1)?,
                version: row.get(2)?,
            })
        })?;

        apps.collect()
    }

    /// Removes a device and the app/icon caches stored under its IP. Returns that IP, or `None`
    /// when the device was not in the cache.
    fn delete_device(&self, hardware_id: &str) -> SqliteResult<Option<String>> {
        let conn = self.conn.lock().unwrap();
        let tx = conn.unchecked_transaction()?;

        let ip = match tx.query_row(
            "SELECT ip FROM devices WHERE hardware_id = ?1",
            params![hardware_id],
            |row| row.get::<_, String>(0),
        ) {
            Ok(ip) => Some(ip),
            Err(rusqlite::Error::QueryReturnedNoRows) => None,
            Err(e) => return Err(e),
        };

        tx.execute("DELETE FROM devices WHERE hardware_id = ?1", params![hardware_id])?;

        if let Some(ip) = &ip {
            // Apps and icons are keyed by IP. Keep them if another known device now has it.
            let still_used: i64 = tx.query_row(
                "SELECT COUNT(*) FROM devices WHERE ip = ?1",
                params![ip],
                |row| row.get(0),
            )?;
            if still_used == 0 {
                tx.execute("DELETE FROM apps WHERE device_ip = ?1", params![ip])?;
                tx.execute("DELETE FROM icons WHERE device_ip = ?1", params![ip])?;
            }
        }

        tx.commit()?;
        Ok(ip)
    }

    fn clear_all_data(&self) -> SqliteResult<()> {
        let conn = self.conn.lock().unwrap();
        
        conn.execute("DELETE FROM icons", [])?;
        conn.execute("DELETE FROM devices", [])?;
        conn.execute("DELETE FROM apps", [])?;
        
        // Vacuum to reclaim space
        conn.execute("VACUUM", [])?;
        
        Ok(())
    }
}

pub fn init_background_tasks(db_path: String) -> Result<(), Box<dyn std::error::Error>> {
    let (tx, mut rx) = mpsc::unbounded_channel::<BackgroundTask>();
    
    *TASK_SENDER.lock().unwrap() = Some(tx);
    
    async_runtime::spawn(async move {
        let db_manager = match DatabaseManager::new(&db_path) {
            Ok(manager) => manager,
            Err(e) => {
                log::error!("Failed to initialize database at {}: {}", db_path, e);
                return;
            }
        };

        log::info!("Background task system initialized with database at: {}", db_path);

        while let Some(task) = rx.recv().await {
            match task {
                BackgroundTask::CacheIcon {
                    device_ip,
                    app_id,
                    icon_data,
                    response,
                } => {
                    let result = db_manager.cache_icon(&device_ip, &app_id, &icon_data);
                    let _ = response.send(result);
                }
                
                BackgroundTask::GetIcon {
                    device_ip,
                    app_id,
                    response,
                } => {
                    let result = db_manager.get_icon(&device_ip, &app_id);
                    let _ = response.send(result);
                }
                
                BackgroundTask::CacheDevice {
                    device,
                    response,
                } => {
                    let result = db_manager.cache_device(&device);
                    let _ = response.send(result);
                }
                
                BackgroundTask::GetDevices { response } => {
                    let result = db_manager.get_devices();
                    let _ = response.send(result);
                }
                
                BackgroundTask::CacheAppList {
                    device_ip,
                    apps,
                    response,
                } => {
                    let result = db_manager.cache_app_list(&device_ip, &apps);
                    let _ = response.send(result);
                }
                
                BackgroundTask::GetApps {
                    device_ip,
                    response,
                } => {
                    let result = db_manager.get_apps(&device_ip);
                    let _ = response.send(result);
                }

                BackgroundTask::DeleteDevice {
                    hardware_id,
                    response,
                } => {
                    let result = db_manager.delete_device(&hardware_id);
                    let _ = response.send(result);
                }

                BackgroundTask::ClearAllData { response } => {
                    let result = db_manager.clear_all_data();
                    let _ = response.send(result);
                }
            }
        }
    });
    
    Ok(())
}

pub async fn execute_task<T>(
    create_task: impl FnOnce(oneshot::Sender<T>) -> BackgroundTask,
) -> Result<T, String> {
    let (tx, rx) = oneshot::channel();
    
    let task = create_task(tx);
    
    let sender = TASK_SENDER
        .lock()
        .unwrap()
        .clone()
        .ok_or("Background task system not initialized")?;
    
    sender
        .send(task)
        .map_err(|_| "Failed to send task to background thread")?;
    
    rx.await
        .map_err(|_| "Failed to receive response from background thread".to_string())
}

pub async fn cache_icon_bg(device_ip: String, app_id: String, icon_data: String) -> Result<(), String> {
    execute_task(|response| BackgroundTask::CacheIcon {
        device_ip,
        app_id,
        icon_data,
        response,
    })
    .await
    .map_err(|e| e.to_string())?
    .map_err(|e| e.to_string())
}

pub async fn get_icon_bg(device_ip: String, app_id: String) -> Result<Option<String>, String> {
    execute_task(|response| BackgroundTask::GetIcon {
        device_ip,
        app_id,
        response,
    })
    .await
    .map_err(|e| e.to_string())?
    .map_err(|e| e.to_string())
}

pub async fn cache_device_bg(device: DeviceCache) -> Result<(), String> {
    execute_task(|response| BackgroundTask::CacheDevice { device, response })
        .await
        .map_err(|e| e.to_string())?
        .map_err(|e| e.to_string())
}

pub async fn get_devices_bg() -> Result<Vec<DeviceCache>, String> {
    execute_task(|response| BackgroundTask::GetDevices { response })
        .await
        .map_err(|e| e.to_string())?
        .map_err(|e| e.to_string())
}

pub async fn cache_app_list_bg(device_ip: String, apps: Vec<AppCache>) -> Result<(), String> {
    execute_task(|response| BackgroundTask::CacheAppList {
        device_ip,
        apps,
        response,
    })
    .await
    .map_err(|e| e.to_string())?
    .map_err(|e| e.to_string())
}

pub async fn get_apps_bg(device_ip: String) -> Result<Vec<AppCache>, String> {
    execute_task(|response| BackgroundTask::GetApps { device_ip, response })
        .await
        .map_err(|e| e.to_string())?
        .map_err(|e| e.to_string())
}

pub async fn clear_all_data_bg() -> Result<(), String> {
    execute_task(|response| BackgroundTask::ClearAllData { response })
        .await
        .map_err(|e| e.to_string())?
        .map_err(|e| e.to_string())
}

/// Deletes one device and its cached apps and icons. Returns the IP it was stored under.
pub async fn delete_device_bg(hardware_id: String) -> Result<Option<String>, String> {
    execute_task(|response| BackgroundTask::DeleteDevice {
        hardware_id,
        response,
    })
    .await
    .map_err(|e| e.to_string())?
    .map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn device(hardware_id: &str, ip: &str) -> DeviceCache {
        DeviceCache {
            name: format!("Roku {hardware_id}"),
            ip: ip.to_string(),
            port: 8060,
            url: format!("http://{ip}:8060"),
            hardware_id: hardware_id.to_string(),
            last_seen: 1,
        }
    }

    fn app(id: &str) -> AppCache {
        AppCache {
            id: id.to_string(),
            name: format!("App {id}"),
            version: "1.0".to_string(),
        }
    }

    #[test]
    fn delete_device_removes_only_that_device_and_its_caches() {
        let db = DatabaseManager::new(":memory:").unwrap();
        db.cache_device(&device("roku:A", "10.0.0.2")).unwrap();
        db.cache_device(&device("roku:B", "10.0.0.3")).unwrap();
        db.cache_app_list("10.0.0.2", &[app("12")]).unwrap();
        db.cache_app_list("10.0.0.3", &[app("13")]).unwrap();
        db.cache_icon("10.0.0.2", "12", "data:a").unwrap();
        db.cache_icon("10.0.0.3", "13", "data:b").unwrap();

        assert_eq!(db.delete_device("roku:A").unwrap().as_deref(), Some("10.0.0.2"));

        let remaining = db.get_devices().unwrap();
        assert_eq!(remaining.len(), 1);
        assert_eq!(remaining[0].hardware_id, "roku:B");
        assert!(db.get_apps("10.0.0.2").unwrap().is_empty());
        assert_eq!(db.get_icon("10.0.0.2", "12").unwrap(), None);
        assert_eq!(db.get_apps("10.0.0.3").unwrap().len(), 1);
        assert_eq!(db.get_icon("10.0.0.3", "13").unwrap().as_deref(), Some("data:b"));
    }

    #[test]
    fn delete_device_keeps_caches_when_another_device_has_the_ip() {
        let db = DatabaseManager::new(":memory:").unwrap();
        db.cache_device(&device("roku:legacy", "10.0.0.2")).unwrap();
        db.cache_device(&device("roku:real", "10.0.0.2")).unwrap();
        db.cache_app_list("10.0.0.2", &[app("12")]).unwrap();

        db.delete_device("roku:legacy").unwrap();

        assert_eq!(db.get_devices().unwrap().len(), 1);
        assert_eq!(db.get_apps("10.0.0.2").unwrap().len(), 1);
    }

    #[test]
    fn delete_device_is_a_no_op_for_an_unknown_device() {
        let db = DatabaseManager::new(":memory:").unwrap();
        db.cache_device(&device("roku:A", "10.0.0.2")).unwrap();

        assert_eq!(db.delete_device("roku:missing").unwrap(), None);
        assert_eq!(db.get_devices().unwrap().len(), 1);
    }

    /// The `apps` table as created before devices were keyed by hardware_id.
    const LEGACY_APPS_TABLE: &str = "CREATE TABLE apps (
        device_ip TEXT NOT NULL,
        app_id TEXT NOT NULL,
        name TEXT NOT NULL,
        version TEXT NOT NULL,
        cached_at INTEGER NOT NULL,
        PRIMARY KEY (device_ip, app_id),
        FOREIGN KEY (device_ip) REFERENCES devices(ip) ON DELETE CASCADE
    )";

    /// A database file that `DatabaseManager::new` can reopen. Removed on drop.
    struct TempDb(std::path::PathBuf);

    impl TempDb {
        fn new(name: &str) -> Self {
            let path = std::env::temp_dir()
                .join(format!("roku_cache_{name}_{}.db", std::process::id()));
            let _ = std::fs::remove_file(&path);
            TempDb(path)
        }

        fn path(&self) -> &str {
            self.0.to_str().unwrap()
        }
    }

    impl Drop for TempDb {
        fn drop(&mut self) {
            let _ = std::fs::remove_file(&self.0);
        }
    }

    fn apps_foreign_keys(db: &DatabaseManager) -> i64 {
        db.conn
            .lock()
            .unwrap()
            .query_row("SELECT COUNT(*) FROM pragma_foreign_key_list('apps')", [], |row| row.get(0))
            .unwrap()
    }

    #[test]
    fn new_drops_the_stale_apps_foreign_key_left_by_the_hardware_id_migration() {
        let file = TempDb::new("stale_apps_fk");
        {
            let conn = Connection::open(file.path()).unwrap();
            conn.execute_batch(&format!(
                "CREATE TABLE devices (
                    hardware_id TEXT PRIMARY KEY,
                    ip TEXT NOT NULL,
                    name TEXT NOT NULL,
                    port INTEGER NOT NULL,
                    url TEXT NOT NULL,
                    last_seen INTEGER NOT NULL
                );
                {LEGACY_APPS_TABLE};
                INSERT INTO devices VALUES ('roku:A', '10.0.0.2', 'Roku A', 8060, 'http://10.0.0.2:8060', 1);"
            ))
            .unwrap();
            let err = conn
                .execute("DELETE FROM devices WHERE hardware_id = 'roku:A'", [])
                .unwrap_err();
            assert!(err.to_string().contains("foreign key mismatch"), "{err}");
        }

        let db = DatabaseManager::new(file.path()).unwrap();

        assert_eq!(apps_foreign_keys(&db), 0);
        db.cache_app_list("10.0.0.2", &[app("12")]).unwrap();
        assert_eq!(db.get_apps("10.0.0.2").unwrap().len(), 1);
        assert_eq!(db.delete_device("roku:A").unwrap().as_deref(), Some("10.0.0.2"));
        assert!(db.get_devices().unwrap().is_empty());
        assert!(db.get_apps("10.0.0.2").unwrap().is_empty());
        db.cache_device(&device("roku:B", "10.0.0.3")).unwrap();
        db.clear_all_data().unwrap();
    }

    #[test]
    fn new_upgrades_the_original_ip_keyed_schema() {
        let file = TempDb::new("ip_keyed");
        {
            let conn = Connection::open(file.path()).unwrap();
            conn.execute_batch(&format!(
                "CREATE TABLE devices (
                    ip TEXT PRIMARY KEY,
                    name TEXT NOT NULL,
                    port INTEGER NOT NULL,
                    url TEXT NOT NULL,
                    last_seen INTEGER NOT NULL
                );
                {LEGACY_APPS_TABLE};
                INSERT INTO devices VALUES ('10.0.0.2', 'Roku A', 8060, 'http://10.0.0.2:8060', 1);
                INSERT INTO apps VALUES ('10.0.0.2', '12', 'App 12', '1.0', 1);"
            ))
            .unwrap();
        }

        let db = DatabaseManager::new(file.path()).unwrap();

        assert_eq!(apps_foreign_keys(&db), 0);
        assert!(db.get_devices().unwrap().is_empty());
        db.cache_device(&device("roku:A", "10.0.0.2")).unwrap();
        db.cache_app_list("10.0.0.2", &[app("12")]).unwrap();
        assert_eq!(db.delete_device("roku:A").unwrap().as_deref(), Some("10.0.0.2"));
        assert!(db.get_apps("10.0.0.2").unwrap().is_empty());
    }
}
