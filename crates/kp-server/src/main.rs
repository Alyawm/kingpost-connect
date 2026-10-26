//! `kingpost-server`: run the sync server, or manage its accounts.

use std::{
    collections::HashMap,
    io::{BufRead, Write},
    net::SocketAddr,
    path::PathBuf,
    process::ExitCode,
};

use kp_server::{AppState, hash_password};
use rusqlite::params;

const HELP: &str = "\
KingPost Connect server

USAGE
  kingpost-server [serve] [--data DIR] [--listen ADDRESS] [--web DIR] [--open-signup]
  kingpost-server add-user --email EMAIL --name NAME [--admin] [--data DIR]
  kingpost-server set-password --email EMAIL [--data DIR]
  kingpost-server list-users [--data DIR]

OPTIONS
  --data DIR        where the server keeps its database and files
                    (default ./kingpost-data, or KINGPOST_DATA)
  --listen ADDRESS  address and port to listen on (default 0.0.0.0:8640, or KINGPOST_LISTEN)
  --web DIR         folder of the web viewer to serve (default: a 'web' folder next to
                    this program, or KINGPOST_WEB)
  --open-signup     anyone who can reach the server may create an account; otherwise
                    only the first user and people invited to a project can
                    (or KINGPOST_OPEN_SIGNUP=1)

Passwords for add-user and set-password are read from KINGPOST_PASSWORD, or asked for.
The server speaks plain HTTP: put it behind a reverse proxy with a certificate when it
can be reached from outside your network.
";

fn main() -> ExitCode {
    let mut args = std::env::args().skip(1).peekable();
    let command = match args.peek().map(String::as_str) {
        Some(c) if !c.starts_with("--") => args.next().unwrap_or_default(),
        _ => "serve".to_owned(),
    };
    let mut flags: HashMap<String, Option<String>> = HashMap::new();
    while let Some(arg) = args.next() {
        let Some(name) = arg.strip_prefix("--") else {
            eprintln!("unexpected argument: {arg}\n\n{HELP}");
            return ExitCode::from(2);
        };
        let value = match args.peek() {
            Some(next) if !next.starts_with("--") => args.next(),
            _ => None,
        };
        flags.insert(name.to_owned(), value);
    }
    if flags.contains_key("help") || command == "help" {
        print!("{HELP}");
        return ExitCode::SUCCESS;
    }
    if flags.contains_key("version") {
        println!("kingpost-server {}", env!("CARGO_PKG_VERSION"));
        return ExitCode::SUCCESS;
    }
    let flag = |name: &str, env: &str| -> Option<String> {
        flags
            .get(name)
            .cloned()
            .flatten()
            .or_else(|| std::env::var(env).ok().filter(|v| !v.is_empty()))
    };
    let data =
        PathBuf::from(flag("data", "KINGPOST_DATA").unwrap_or_else(|| "kingpost-data".into()));

    let result = match command.as_str() {
        "serve" => serve(
            data,
            flag("listen", "KINGPOST_LISTEN").unwrap_or_else(|| "0.0.0.0:8640".into()),
            flag("web", "KINGPOST_WEB")
                .map(PathBuf::from)
                .or_else(default_web),
            flags.contains_key("open-signup")
                || std::env::var("KINGPOST_OPEN_SIGNUP").is_ok_and(|v| v == "1"),
        ),
        "add-user" => add_user(
            data,
            flags.get("email").cloned().flatten(),
            flags.get("name").cloned().flatten(),
            flags.contains_key("admin"),
        ),
        "set-password" => set_password(data, flags.get("email").cloned().flatten()),
        "list-users" => list_users(data),
        other => Err(format!("unknown command: {other}\n\n{HELP}")),
    };
    match result {
        Ok(()) => ExitCode::SUCCESS,
        Err(message) => {
            eprintln!("{message}");
            ExitCode::FAILURE
        }
    }
}

fn default_web() -> Option<PathBuf> {
    let web = std::env::current_exe().ok()?.parent()?.join("web");
    web.join("index.html").is_file().then_some(web)
}

fn serve(
    data: PathBuf,
    listen: String,
    web: Option<PathBuf>,
    open_signup: bool,
) -> Result<(), String> {
    let address: SocketAddr = listen
        .parse()
        .map_err(|_| format!("not an address and port: {listen}"))?;
    let state = AppState::open(&data, open_signup)?;
    let runtime = tokio::runtime::Builder::new_multi_thread()
        .enable_all()
        .build()
        .map_err(|e| e.to_string())?;
    runtime.block_on(async move {
        let listener = tokio::net::TcpListener::bind(address)
            .await
            .map_err(|e| format!("cannot listen on {address}: {e}"))?;
        eprintln!(
            "KingPost Connect server {} listening on http://{address}",
            env!("CARGO_PKG_VERSION")
        );
        eprintln!("data: {}", data.display());
        match &web {
            Some(web) => eprintln!("web viewer: {}", web.display()),
            None => eprintln!("web viewer: not installed"),
        }
        eprintln!(
            "sign-up: {}",
            if open_signup {
                "open to anyone who can reach the server"
            } else {
                "first user and invited people only"
            }
        );
        kp_server::serve(listener, state, web, async {
            let _ = tokio::signal::ctrl_c().await;
            eprintln!("stopping");
        })
        .await
        .map_err(|e| e.to_string())
    })
}

fn password() -> Result<String, String> {
    if let Ok(password) = std::env::var("KINGPOST_PASSWORD") {
        return Ok(password);
    }
    eprint!("Password: ");
    let _ = std::io::stderr().flush();
    let mut line = String::new();
    std::io::stdin()
        .lock()
        .read_line(&mut line)
        .map_err(|e| e.to_string())?;
    Ok(line.trim_end_matches(['\r', '\n']).to_owned())
}

fn add_user(
    data: PathBuf,
    email: Option<String>,
    name: Option<String>,
    admin: bool,
) -> Result<(), String> {
    let email = email.ok_or("give --email")?;
    let name = name.ok_or("give --name")?;
    if !kp_sync::protocol::valid_email(&email) {
        return Err("that does not look like an email address".into());
    }
    let password = password()?;
    if password.chars().count() < 8 {
        return Err("the password needs at least 8 characters".into());
    }
    let hash = hash_password(&password)?;
    let state = AppState::open(&data, false)?;
    state.with_db(|conn| {
        conn.execute(
            "INSERT INTO user (email, name, password_hash, is_admin) VALUES (?1, ?2, ?3, ?4)",
            params![email.trim(), name.trim(), hash, admin],
        )
        .map_err(|e| format!("could not add the user: {e}"))?;
        let id = conn.last_insert_rowid();
        conn.execute(
            "INSERT INTO member (project_id, user_id, role)
             SELECT project_id, ?2, role FROM invite WHERE email = ?1 ON CONFLICT DO NOTHING",
            params![email.trim(), id],
        )
        .and_then(|_| conn.execute("DELETE FROM invite WHERE email = ?1", [email.trim()]))
        .map_err(|e| e.to_string())?;
        println!(
            "added {} <{}>{}",
            name.trim(),
            email.trim(),
            if admin { " (administrator)" } else { "" }
        );
        Ok(())
    })
}

fn set_password(data: PathBuf, email: Option<String>) -> Result<(), String> {
    let email = email.ok_or("give --email")?;
    let password = password()?;
    if password.chars().count() < 8 {
        return Err("the password needs at least 8 characters".into());
    }
    let hash = hash_password(&password)?;
    let state = AppState::open(&data, false)?;
    state.with_db(|conn| {
        let changed = conn
            .execute(
                "UPDATE user SET password_hash = ?2 WHERE email = ?1",
                params![email.trim(), hash],
            )
            .map_err(|e| e.to_string())?;
        if changed == 0 {
            return Err(format!("no user with email {email}"));
        }
        // Signed-in sessions end with the old password.
        conn.execute(
            "DELETE FROM session WHERE user_id = (SELECT id FROM user WHERE email = ?1)",
            [email.trim()],
        )
        .map_err(|e| e.to_string())?;
        println!("password changed for {email}; their sessions were signed out");
        Ok(())
    })
}

fn list_users(data: PathBuf) -> Result<(), String> {
    let state = AppState::open(&data, false)?;
    state.with_db(|conn| {
        let mut statement = conn
            .prepare(
                "SELECT u.email, u.name, u.is_admin, u.created_at,
                        (SELECT COUNT(*) FROM member m WHERE m.user_id = u.id)
                 FROM user u ORDER BY u.email COLLATE NOCASE",
            )
            .map_err(|e| e.to_string())?;
        let rows = statement
            .query_map([], |r| {
                Ok((
                    r.get::<_, String>(0)?,
                    r.get::<_, String>(1)?,
                    r.get::<_, bool>(2)?,
                    r.get::<_, String>(3)?,
                    r.get::<_, i64>(4)?,
                ))
            })
            .map_err(|e| e.to_string())?;
        for row in rows {
            let (email, name, admin, created, projects) = row.map_err(|e| e.to_string())?;
            println!(
                "{email}\t{name}{}\t{projects} project(s)\tsince {}",
                if admin { " (administrator)" } else { "" },
                created.get(..10).unwrap_or(&created)
            );
        }
        Ok(())
    })
}
