//! KingPost Connect sync server.
//!
//! One binary with its own SQLite database and a folder of file contents. It keeps
//! accounts and projects shared by invitation, relays the change records copies of a
//! project send (see `kp_sync::protocol`), stores the model and drawing files they
//! publish, and can serve the web viewer. It never merges anything: copies apply each
//! other's changes themselves, newest per row, exactly as with a shared folder.
//!
//! It speaks plain HTTP; put it behind a reverse proxy with a certificate (Caddy, IIS,
//! nginx) when it is reachable from outside the office network.

mod api;
mod auth;
mod db;

use std::{
    future::Future,
    net::SocketAddr,
    path::{Path, PathBuf},
    sync::{Arc, Mutex},
    time::Instant,
};

use axum::{
    Json, Router,
    extract::{DefaultBodyLimit, Request},
    http::{HeaderValue, StatusCode, header},
    middleware::{self, Next},
    response::{Html, IntoResponse, Response},
    routing::{get, post},
};
use kp_sync::protocol::{API, ApiError};
use rusqlite::Connection;
use tower_http::services::{ServeDir, ServeFile};

pub use auth::{hash_password, verify_password};

/// Shared by every request: the database, where file contents live, the sign-up rule
/// and the sign-in throttle.
#[derive(Clone)]
pub struct AppState {
    inner: Arc<Inner>,
}

struct Inner {
    db: Mutex<Connection>,
    data: PathBuf,
    open_signup: bool,
    throttle: auth::Throttle,
}

impl AppState {
    /// Opens (creating if needed) the server data folder.
    pub fn open(data: &Path, open_signup: bool) -> Result<Self, String> {
        std::fs::create_dir_all(data.join("blobs"))
            .and_then(|_| std::fs::create_dir_all(data.join("tmp")))
            .map_err(|e| format!("{}: {e}", data.display()))?;
        let conn =
            db::open(&data.join("server.db")).map_err(|e| format!("server database: {e}"))?;
        Ok(Self {
            inner: Arc::new(Inner {
                db: Mutex::new(conn),
                data: data.to_path_buf(),
                open_signup,
                throttle: auth::Throttle::default(),
            }),
        })
    }

    /// Runs database work off the async threads.
    pub(crate) async fn run<T, F>(&self, work: F) -> Result<T, ApiErr>
    where
        T: Send + 'static,
        F: FnOnce(&mut Connection) -> Result<T, ApiErr> + Send + 'static,
    {
        let inner = self.inner.clone();
        tokio::task::spawn_blocking(move || {
            let mut conn = inner.db.lock().unwrap_or_else(|e| e.into_inner());
            work(&mut conn)
        })
        .await
        .map_err(|_| ApiErr::internal())?
    }

    /// Direct database access for the command line (adding users and the like).
    pub fn with_db<T>(&self, work: impl FnOnce(&mut Connection) -> T) -> T {
        let mut conn = self.inner.db.lock().unwrap_or_else(|e| e.into_inner());
        work(&mut conn)
    }

    pub(crate) fn data(&self) -> &Path {
        &self.inner.data
    }

    pub(crate) fn open_signup(&self) -> bool {
        self.inner.open_signup
    }

    pub(crate) fn throttle(&self) -> &auth::Throttle {
        &self.inner.throttle
    }
}

/// An error answered to the client as `{"error": "..."}` with a status.
#[derive(Debug)]
pub(crate) struct ApiErr {
    status: StatusCode,
    message: String,
}

impl ApiErr {
    pub fn new(status: StatusCode, message: impl Into<String>) -> Self {
        Self {
            status,
            message: message.into(),
        }
    }

    pub fn bad_request(message: impl Into<String>) -> Self {
        Self::new(StatusCode::BAD_REQUEST, message)
    }

    pub fn unauthorized() -> Self {
        Self::new(StatusCode::UNAUTHORIZED, "please sign in again")
    }

    pub fn forbidden(message: impl Into<String>) -> Self {
        Self::new(StatusCode::FORBIDDEN, message)
    }

    pub fn not_found(message: impl Into<String>) -> Self {
        Self::new(StatusCode::NOT_FOUND, message)
    }

    pub fn conflict(message: impl Into<String>) -> Self {
        Self::new(StatusCode::CONFLICT, message)
    }

    pub fn internal() -> Self {
        Self::new(
            StatusCode::INTERNAL_SERVER_ERROR,
            "the server could not do that; see its log",
        )
    }
}

impl IntoResponse for ApiErr {
    fn into_response(self) -> Response {
        (
            self.status,
            Json(ApiError {
                error: self.message,
            }),
        )
            .into_response()
    }
}

impl From<rusqlite::Error> for ApiErr {
    fn from(error: rusqlite::Error) -> Self {
        eprintln!("database error: {error}");
        ApiErr::internal()
    }
}

impl From<std::io::Error> for ApiErr {
    fn from(error: std::io::Error) -> Self {
        eprintln!("file error: {error}");
        ApiErr::internal()
    }
}

/// The whole application: the API under `/api/v1`, and the web viewer (or a short page
/// saying the server runs) everywhere else.
pub fn router(state: AppState, web: Option<&Path>) -> Router {
    let api = Router::new()
        .route("/server", get(api::server_info))
        // Sign-in bodies are tiny; a large one is never legitimate.
        .route(
            "/auth/register",
            post(api::register).layer(DefaultBodyLimit::max(16 << 10)),
        )
        .route(
            "/auth/login",
            post(api::login).layer(DefaultBodyLimit::max(16 << 10)),
        )
        .route("/auth/logout", post(api::logout))
        .route("/me", get(api::me))
        .route(
            "/projects",
            get(api::list_projects).post(api::create_project),
        )
        .route("/projects/{id}", get(api::get_project))
        .route(
            "/projects/{id}/members",
            get(api::list_members)
                .post(api::invite)
                .delete(api::remove_member),
        )
        .route("/projects/{id}/hello", post(api::hello))
        .route("/projects/{id}/peers", get(api::peers))
        .route(
            "/projects/{id}/changes",
            get(api::pull_changes).post(api::push_changes),
        )
        .route(
            "/projects/{id}/files",
            get(api::list_files).post(api::post_file),
        )
        .route(
            "/projects/{id}/blobs/{sha}",
            get(api::get_blob)
                .put(api::put_blob)
                .layer(DefaultBodyLimit::disable()),
        )
        .layer(DefaultBodyLimit::max(64 << 20))
        .fallback(|| async { ApiErr::not_found("no such request") })
        .with_state(state);

    let app = Router::new().nest(API, api);
    let app = match web.filter(|w| w.join("index.html").is_file()) {
        Some(web) => app
            .fallback_service(ServeDir::new(web).fallback(ServeFile::new(web.join("index.html")))),
        None => app.fallback(|| async { Html(LANDING) }),
    };
    app.layer(middleware::from_fn(wrap_request))
}

/// What the web viewer's pages may load: only the server itself (the IFC engine runs as
/// WebAssembly, hence `wasm-unsafe-eval`), nothing framed, no form posts elsewhere.
const WEB_CSP: &str = "default-src 'self'; img-src 'self' data: blob:; style-src 'self' 'unsafe-inline'; \
script-src 'self' 'wasm-unsafe-eval'; worker-src 'self' blob:; connect-src 'self'; \
frame-ancestors 'none'; base-uri 'self'; form-action 'self'; object-src 'none'";

const LANDING: &str = "<!doctype html><meta charset=utf-8><title>KingPost Connect server</title>\
<body style=\"font-family:system-ui;margin:3rem;color:#1b2129\"><h1>KingPost Connect server</h1>\
<p>This server is running. In KingPost Connect, open a project, click the cloud button and \
choose <b>Sync with a server</b>, then enter this address.</p></body>";

/// Logs API requests and adds the browser security headers to every answer.
async fn wrap_request(request: Request, next: Next) -> Response {
    let started = Instant::now();
    let method = request.method().clone();
    let path = request.uri().path().to_owned();
    let mut response = next.run(request).await;
    let status = response.status();
    let api = path.starts_with(API);
    let headers = response.headers_mut();
    headers.insert(
        header::X_CONTENT_TYPE_OPTIONS,
        HeaderValue::from_static("nosniff"),
    );
    headers.insert(
        header::REFERRER_POLICY,
        HeaderValue::from_static("same-origin"),
    );
    headers.insert(header::X_FRAME_OPTIONS, HeaderValue::from_static("DENY"));
    if !api {
        headers.insert(
            header::CONTENT_SECURITY_POLICY,
            HeaderValue::from_static(WEB_CSP),
        );
    }
    if api || status.is_server_error() {
        eprintln!(
            "{} {method} {path} {} {} ms",
            now(),
            status.as_u16(),
            started.elapsed().as_millis()
        );
    }
    response
}

pub(crate) fn now() -> String {
    time::OffsetDateTime::now_utc()
        .format(&time::format_description::well_known::Rfc3339)
        .unwrap_or_default()
}

/// Bytes as lowercase hex.
pub(crate) fn hex(bytes: &[u8]) -> String {
    use std::fmt::Write as _;
    let mut out = String::with_capacity(bytes.len() * 2);
    for b in bytes {
        let _ = write!(out, "{b:02x}");
    }
    out
}

/// Serves until `shutdown` completes.
pub async fn serve(
    listener: tokio::net::TcpListener,
    state: AppState,
    web: Option<PathBuf>,
    shutdown: impl Future<Output = ()> + Send + 'static,
) -> std::io::Result<()> {
    let app = router(state, web.as_deref());
    axum::serve(
        listener,
        app.into_make_service_with_connect_info::<SocketAddr>(),
    )
    .with_graceful_shutdown(shutdown)
    .await
}
