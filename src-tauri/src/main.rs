// No console window next to the app on Windows.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

//! Aurora for the desktop: the Aurora server runs on 127.0.0.1 next to the app
//! (on the Node.js build shipped with it), and the window shows it. So the
//! desktop app has everything the server has: ffmpeg remuxing, audio and
//! subtitle tracks, the TV guide cache, and no CORS limits on IPTV providers.

use std::{
    error::Error,
    net::{SocketAddr, TcpListener, TcpStream},
    path::{Path, PathBuf},
    sync::Mutex,
    thread,
    time::{Duration, Instant},
};

use tauri::{
    webview::PageLoadEvent, AppHandle, Manager, RunEvent, Theme, Url, WebviewUrl,
    WebviewWindowBuilder,
};
use tauri_plugin_shell::{
    process::{CommandChild, CommandEvent},
    ShellExt,
};

/// The running server, stopped when the app quits.
struct Server(Mutex<Option<CommandChild>>);

/// Where the server listens, once it's started.
struct Origin(Mutex<Option<String>>);

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_opener::init())
        .manage(Server(Mutex::new(None)))
        .manage(Origin(Mutex::new(None)))
        .setup(|app| {
            let handle = app.handle().clone();
            let window = WebviewWindowBuilder::new(app, "main", WebviewUrl::App("index.html".into()))
                .title("Aurora")
                .inner_size(1280.0, 800.0)
                .min_inner_size(900.0, 600.0)
                .theme(Some(Theme::Dark))
                .on_navigation(move |url| stays_in_app(&handle, url))
                .on_page_load(|webview, payload| {
                    if payload.event() == PageLoadEvent::Finished {
                        let _ = webview.set_focus();
                    }
                })
                .build()?;

            match start_server(app.handle()) {
                Ok((port, token)) => {
                    thread::spawn(move || {
                        if wait_for_server(port, Duration::from_secs(60)) {
                            let entry = format!("http://127.0.0.1:{port}/__aurora-desktop?token={token}");
                            if let Ok(url) = Url::parse(&entry) {
                                let _ = window.navigate(url);
                            }
                        } else {
                            let _ = window.eval(
                                "showError('Aurora could not start its server. Quit and open Aurora again.')",
                            );
                        }
                    });
                }
                Err(error) => {
                    eprintln!("Could not start the Aurora server: {error}");
                    let _ = window.eval("showError('Aurora could not start its server.')");
                }
            }
            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("failed to start Aurora")
        .run(|app, event| {
            if let RunEvent::Exit = event {
                if let Some(child) = app.state::<Server>().0.lock().unwrap().take() {
                    let _ = child.kill();
                }
            }
        });
}

/// The window only shows the splash screen and the local server; any other
/// link (GitHub, a provider's site) opens in the default browser instead.
fn stays_in_app(app: &AppHandle, url: &Url) -> bool {
    if matches!(url.scheme(), "tauri" | "about" | "data") || url.host_str() == Some("tauri.localhost") {
        return true;
    }
    let origin = app.state::<Origin>().0.lock().unwrap().clone();
    if origin.as_deref() == Some(url.origin().ascii_serialization().as_str()) {
        return true;
    }
    if matches!(url.scheme(), "http" | "https" | "mailto") {
        let _ = tauri_plugin_opener::open_url(url.as_str(), None::<&str>);
    }
    false
}

fn start_server(app: &AppHandle) -> Result<(u16, String), Box<dyn Error>> {
    let resources = app.path().resource_dir()?;
    let script = resources.join("server").join("server.mjs");
    let data = app.path().app_data_dir()?;
    std::fs::create_dir_all(&data)?;

    // Ask the system for a free port; the server takes it right after.
    let port = TcpListener::bind("127.0.0.1:0")?.local_addr()?.port();
    let token = random_token()?;

    let mut command = app
        .shell()
        .sidecar("aurora-node")?
        .arg(&script)
        .current_dir(&data)
        .env("NODE_ENV", "production")
        .env("HOST", "127.0.0.1")
        .env("PORT", port.to_string())
        .env("AURORA_DATA_DIR", &data)
        .env("AURORA_DESKTOP_TOKEN", &token)
        // One person's own server: IPTV may reach any provider they add.
        .env("AURORA_IPTV_ANY_ORIGIN", "true")
        .env("AURORA_EXIT_WITH_STDIN", "1");
    if let Some(ffmpeg) = find_ffmpeg(&resources) {
        command = command.env("AURORA_IPTV_FFMPEG", ffmpeg);
    }

    let (mut events, child) = command.spawn()?;
    tauri::async_runtime::spawn(async move {
        while let Some(event) = events.recv().await {
            match event {
                CommandEvent::Stdout(line) | CommandEvent::Stderr(line) => {
                    eprintln!("[server] {}", String::from_utf8_lossy(&line).trim_end());
                }
                CommandEvent::Terminated(status) => {
                    eprintln!("[server] stopped ({:?})", status.code);
                }
                _ => {}
            }
        }
    });

    app.state::<Server>().0.lock().unwrap().replace(child);
    app.state::<Origin>()
        .0
        .lock()
        .unwrap()
        .replace(format!("http://127.0.0.1:{port}"));
    Ok((port, token))
}

fn wait_for_server(port: u16, limit: Duration) -> bool {
    let address = SocketAddr::from(([127, 0, 0, 1], port));
    let started = Instant::now();
    while started.elapsed() < limit {
        if TcpStream::connect_timeout(&address, Duration::from_millis(250)).is_ok() {
            return true;
        }
        thread::sleep(Duration::from_millis(150));
    }
    false
}

/// A secret for this launch that only the window gets (see desktop-guard.mjs).
fn random_token() -> Result<String, Box<dyn Error>> {
    let mut bytes = [0u8; 32];
    getrandom::fill(&mut bytes).map_err(|error| error.to_string())?;
    Ok(bytes.iter().map(|byte| format!("{byte:02x}")).collect())
}

/// ffmpeg shipped with the app, else one installed on the system. Apps
/// started from Finder don't get the shell's PATH, so look in Homebrew's
/// folders by name.
fn find_ffmpeg(resources: &Path) -> Option<PathBuf> {
    let name = if cfg!(windows) { "ffmpeg.exe" } else { "ffmpeg" };
    let bundled = resources.join("ffmpeg").join(name);
    if bundled.is_file() {
        return Some(bundled);
    }
    let mut candidates: Vec<PathBuf> = Vec::new();
    if cfg!(target_os = "macos") {
        candidates.push("/opt/homebrew/bin/ffmpeg".into());
        candidates.push("/usr/local/bin/ffmpeg".into());
    }
    if let Some(path) = std::env::var_os("PATH") {
        candidates.extend(std::env::split_paths(&path).map(|dir| dir.join(name)));
    }
    candidates.into_iter().find(|candidate| candidate.is_file())
}
