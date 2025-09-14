use once_cell::sync::Lazy;
use rusqlite::{params, Connection, Result as SqliteResult};
use serde::{Deserialize, Serialize};
use std::sync::{Arc, Mutex};
use tauri::async_runtime;
use tokio::sync::mpsc;
use tokio::sync::oneshot;

/// Background task types for the application
#[derive(Debug)]
pub enum BackgroundTask {
    /// Cache an app icon in the database
    CacheIcon {
        device_ip: String,
        app_id: String,
        icon_data: String,
        response: oneshot::Sender<SqliteResult<()>>,
    },
    /// Retrieve an icon from cache
    GetIcon {
        device_ip: String,
        app_id: String,
        response: oneshot::Sender<SqliteResult<Option<String>>>,
    },
    /// Cache device information
    CacheDevice {
        device: DeviceCache,
        response: oneshot::Sender<SqliteResult<()>>,
    },
    /// Get all cached devices
    GetDevices {
        response: oneshot::Sender<SqliteResult<Vec<DeviceCache>>>,
    },
    /// Cache app list for a device
    CacheAppList {
        device_ip: String,
        apps: Vec<AppCache>,
        response: oneshot::Sender<SqliteResult<()>>,
    },
    /// Get cached apps for a device
    GetApps {
        device_ip: String,
        response: oneshot::Sender<SqliteResult<Vec<AppCache>>>,
    },
    /// Clean old cache entries
    CleanOldCache {
        days_old: i64,
        response: oneshot::Sender<SqliteResult<usize>>,
    },
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DeviceCache {
    pub name: String,
    pub ip: String,
    pub port: u16,
    pub url: String,
    pub last_seen: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AppCache {
    pub id: String,
    pub name: String,
    pub version: String,
}

/// Global task sender - used to send tasks to the background thread
static TASK_SENDER: Lazy<Arc<Mutex<Option<mpsc::UnboundedSender<BackgroundTask>>>>> =
    Lazy::new(|| Arc::new(Mutex::new(None)));

/// Database connection manager for background operations
pub struct DatabaseManager {
    conn: Arc<Mutex<Connection>>,
}

impl DatabaseManager {
    /// Create a new database manager and initialize tables
    pub fn new(db_path: &str) -> SqliteResult<Self> {
        let conn = Connection::open(db_path)?;
        
        // Create tables if they don't exist
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

        conn.execute(
            "CREATE TABLE IF NOT EXISTS devices (
                ip TEXT PRIMARY KEY,
                name TEXT NOT NULL,
                port INTEGER NOT NULL,
                url TEXT NOT NULL,
                last_seen INTEGER NOT NULL
            )",
            [],
        )?;

        conn.execute(
            "CREATE TABLE IF NOT EXISTS apps (
                device_ip TEXT NOT NULL,
                app_id TEXT NOT NULL,
                name TEXT NOT NULL,
                version TEXT NOT NULL,
                cached_at INTEGER NOT NULL,
                PRIMARY KEY (device_ip, app_id),
                FOREIGN KEY (device_ip) REFERENCES devices(ip) ON DELETE CASCADE
            )",
            [],
        )?;

        // Create indices for better performance
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

    /// Store an icon in the database
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

    /// Retrieve an icon from the database
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

    /// Cache device information
    fn cache_device(&self, device: &DeviceCache) -> SqliteResult<()> {
        let conn = self.conn.lock().unwrap();
        
        conn.execute(
            "INSERT OR REPLACE INTO devices (ip, name, port, url, last_seen) 
             VALUES (?1, ?2, ?3, ?4, ?5)",
            params![device.ip, device.name, device.port, device.url, device.last_seen],
        )?;
        Ok(())
    }

    /// Get all cached devices
    fn get_devices(&self) -> SqliteResult<Vec<DeviceCache>> {
        let conn = self.conn.lock().unwrap();
        
        let mut stmt = conn.prepare(
            "SELECT ip, name, port, url, last_seen FROM devices ORDER BY last_seen DESC"
        )?;
        
        let devices = stmt.query_map([], |row| {
            Ok(DeviceCache {
                ip: row.get(0)?,
                name: row.get(1)?,
                port: row.get(2)?,
                url: row.get(3)?,
                last_seen: row.get(4)?,
            })
        })?;

        devices.collect()
    }

    /// Cache app list for a device
    fn cache_app_list(&self, device_ip: &str, apps: &[AppCache]) -> SqliteResult<()> {
        let conn = self.conn.lock().unwrap();
        let now = chrono::Utc::now().timestamp();

        // Start transaction for better performance
        let tx = conn.unchecked_transaction()?;
        
        // Clear existing apps for this device
        tx.execute("DELETE FROM apps WHERE device_ip = ?1", params![device_ip])?;
        
        // Insert new apps
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

    /// Get cached apps for a device
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

    /// Clean cache entries older than specified days
    fn clean_old_cache(&self, days_old: i64) -> SqliteResult<usize> {
        let conn = self.conn.lock().unwrap();
        let cutoff = chrono::Utc::now().timestamp() - (days_old * 86400);
        
        let mut count = 0;
        
        count += conn.execute("DELETE FROM icons WHERE cached_at < ?1", params![cutoff])?;
        count += conn.execute("DELETE FROM apps WHERE cached_at < ?1", params![cutoff])?;
        count += conn.execute("DELETE FROM devices WHERE last_seen < ?1", params![cutoff])?;
        
        Ok(count)
    }
}

/// Initialize the background task system
pub fn init_background_tasks(db_path: String) -> Result<(), Box<dyn std::error::Error>> {
    let (tx, mut rx) = mpsc::unbounded_channel::<BackgroundTask>();
    
    // Store the sender globally
    *TASK_SENDER.lock().unwrap() = Some(tx);
    
    // Spawn the background task processor
    async_runtime::spawn(async move {
        // Initialize database manager
        let db_manager = match DatabaseManager::new(&db_path) {
            Ok(manager) => manager,
            Err(e) => {
                eprintln!("Failed to initialize database: {}", e);
                return;
            }
        };

        println!("Background task system initialized with database at: {}", db_path);

        // Process tasks
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
                
                BackgroundTask::CleanOldCache {
                    days_old,
                    response,
                } => {
                    let result = db_manager.clean_old_cache(days_old);
                    let _ = response.send(result);
                }
            }
        }
    });
    
    Ok(())
}

/// Send a task to the background thread and wait for response
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

/// Helper functions for common operations

/// Cache an icon in the background
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

/// Get an icon from cache in the background
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

/// Cache device information in the background
pub async fn cache_device_bg(device: DeviceCache) -> Result<(), String> {
    execute_task(|response| BackgroundTask::CacheDevice { device, response })
        .await
        .map_err(|e| e.to_string())?
        .map_err(|e| e.to_string())
}

/// Get all cached devices from the background
pub async fn get_devices_bg() -> Result<Vec<DeviceCache>, String> {
    execute_task(|response| BackgroundTask::GetDevices { response })
        .await
        .map_err(|e| e.to_string())?
        .map_err(|e| e.to_string())
}

/// Cache app list in the background
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

/// Get cached apps from the background
pub async fn get_apps_bg(device_ip: String) -> Result<Vec<AppCache>, String> {
    execute_task(|response| BackgroundTask::GetApps { device_ip, response })
        .await
        .map_err(|e| e.to_string())?
        .map_err(|e| e.to_string())
}

/// Clean old cache entries in the background
pub async fn clean_old_cache_bg(days_old: i64) -> Result<usize, String> {
    execute_task(|response| BackgroundTask::CleanOldCache { days_old, response })
        .await
        .map_err(|e| e.to_string())?
        .map_err(|e| e.to_string())
}