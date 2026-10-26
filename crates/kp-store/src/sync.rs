//! Change log for sync between copies of a project.
//!
//! Every insert, update and delete on a shared table is recorded in `change_log` by
//! temporary triggers that each connection installs when it opens, so feature code that
//! writes its own SQL is covered without knowing about sync. A record holds the whole row
//! as JSON. Records are ordered by a hybrid logical clock (wall-clock milliseconds, a
//! counter, then the device id), and a received change is applied only when it is newer
//! than everything known about that row: last writer wins, per row.
//!
//! Model-derived tables are not recorded; they are rebuilt from the files. Two columns
//! need care: drawing links and markups point at a local sheet number, so they travel
//! with a key made of the file path, the file hash and the page; and a clash test's last
//! revision is a local number and stays local.

use std::{
    collections::HashMap,
    fmt::Write as _,
    sync::{
        Arc, Mutex,
        atomic::{AtomicBool, Ordering},
    },
    time::{SystemTime, UNIX_EPOCH},
};

use rusqlite::{
    Connection, ErrorCode, OptionalExtension, functions::FunctionFlags, params, types::Value,
};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

use crate::{Result, Store};

/// A table whose rows are shared between copies of a project.
pub(crate) struct SyncTable {
    pub name: &'static str,
    pub pk: &'static [&'static str],
    /// Columns stored as hex text in the log.
    pub blobs: &'static [&'static str],
    /// Columns that only make sense on this machine; never sent, never overwritten.
    pub local_only: &'static [&'static str],
    /// A unique key besides the primary key. A received row that matches an existing row
    /// on it updates that row, so two copies that created "the same" row independently
    /// (an imported BCF issue, a clash found by both) do not fail.
    pub natural: &'static [&'static str],
    /// The row points at a drawing sheet by its local id.
    pub sheet: bool,
}

const fn table(name: &'static str) -> SyncTable {
    SyncTable {
        name,
        pk: &["id"],
        blobs: &[],
        local_only: &[],
        natural: &[],
        sheet: false,
    }
}

/// Shared tables, parents before children.
pub(crate) const SYNC_TABLES: &[SyncTable] = &[
    SyncTable {
        blobs: &["thumbnail"],
        ..table("saved_view")
    },
    table("preset"),
    SyncTable {
        pk: &["material"],
        ..table("material_density")
    },
    SyncTable {
        natural: &["bcf_guid"],
        ..table("issue")
    },
    table("issue_comment"),
    SyncTable {
        pk: &["issue_id", "element_global_id"],
        ..table("issue_element")
    },
    SyncTable {
        blobs: &["snapshot"],
        ..table("issue_viewpoint")
    },
    SyncTable {
        pk: &["element_global_id"],
        ..table("element_status")
    },
    table("note"),
    table("element_link"),
    // Each copy runs clash tests itself; when and against which revision is its own
    // business, what was found and how it was reviewed is shared.
    SyncTable {
        local_only: &["last_revision_id", "last_run_at"],
        ..table("clash_test")
    },
    SyncTable {
        natural: &["test_id", "a_global_id", "b_global_id"],
        local_only: &["last_seen_at"],
        ..table("clash")
    },
    SyncTable {
        sheet: true,
        ..table("sheet_link")
    },
    SyncTable {
        sheet: true,
        ..table("sheet_markup")
    },
];

fn spec(name: &str) -> Option<&'static SyncTable> {
    SYNC_TABLES.iter().find(|t| t.name == name)
}

/// One recorded change, as exchanged between copies.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Change {
    pub id: String,
    pub hlc: String,
    pub device: String,
    pub tbl: String,
    /// Primary key values, in the table's key order.
    pub pk: serde_json::Value,
    /// `upsert` or `delete`.
    pub op: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub row: Option<serde_json::Value>,
}

#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize)]
pub struct ApplyReport {
    pub applied: usize,
    /// Already known, or older than what this copy has for the row.
    pub skipped: usize,
    /// Kept to try again later (see `sync_pending`).
    pub pending: usize,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct SyncCounts {
    pub device: String,
    pub local: i64,
    pub remote: i64,
    pub pending: i64,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct PendingRow {
    pub id: String,
    pub tbl: String,
    pub reason: String,
    pub received_at: String,
}

enum Outcome {
    Applied,
    Skipped,
    Pending,
}

/// Per-connection sync state: the device id, the clock and the "applying remote
/// changes" switch the triggers check.
pub(crate) struct SyncRuntime {
    device: String,
    clock: Mutex<(u64, u32)>,
    applying: AtomicBool,
    /// Columns of each shared table, read once when the connection opens.
    columns: HashMap<&'static str, Vec<String>>,
}

impl SyncRuntime {
    fn next(&self) -> String {
        let now = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map(|d| d.as_millis() as u64)
            .unwrap_or(0);
        let mut clock = self.clock.lock().unwrap_or_else(|e| e.into_inner());
        if now > clock.0 {
            *clock = (now, 0);
        } else {
            clock.1 += 1;
        }
        format_hlc(clock.0, clock.1, &self.device)
    }

    /// Moves the clock past a received timestamp so later local edits sort after it.
    fn observe(&self, hlc: &str) {
        if let Some((ms, counter)) = parse_hlc(hlc) {
            let mut clock = self.clock.lock().unwrap_or_else(|e| e.into_inner());
            if (ms, counter) > *clock {
                *clock = (ms, counter);
            }
        }
    }
}

fn format_hlc(ms: u64, counter: u32, device: &str) -> String {
    format!("{ms:013}.{counter:06}.{device}")
}

fn parse_hlc(hlc: &str) -> Option<(u64, u32)> {
    let mut parts = hlc.splitn(3, '.');
    let ms = parts.next()?.parse().ok()?;
    let counter = parts.next()?.parse().ok()?;
    Some((ms, counter))
}

struct Applying<'a>(&'a AtomicBool);

impl Drop for Applying<'_> {
    fn drop(&mut self) {
        self.0.store(false, Ordering::SeqCst);
    }
}

/// Registers the SQL functions and triggers on a freshly migrated connection.
pub(crate) fn setup(conn: &Connection) -> Result<Arc<SyncRuntime>> {
    let device = device_id(conn)?;
    let mut columns = HashMap::new();
    for t in SYNC_TABLES {
        columns.insert(t.name, table_columns(conn, t.name)?);
    }
    let runtime = Arc::new(SyncRuntime {
        device: device.clone(),
        clock: Mutex::new((0, 0)),
        applying: AtomicBool::new(false),
        columns,
    });
    let clock = runtime.clone();
    conn.create_scalar_function("kp_hlc", 0, FunctionFlags::SQLITE_UTF8, move |_| {
        Ok(clock.next())
    })?;
    let switch = runtime.clone();
    conn.create_scalar_function("kp_applying", 0, FunctionFlags::SQLITE_UTF8, move |_| {
        Ok(switch.applying.load(Ordering::SeqCst))
    })?;
    install_triggers(conn, &device, &runtime.columns)?;
    Ok(runtime)
}

/// Device ids are 32 lowercase hex digits; they are written into trigger SQL, so nothing
/// else is accepted from a database.
fn is_device_id(id: &str) -> bool {
    id.len() == 32
        && id
            .bytes()
            .all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
}

/// A device id belongs to one database file on one machine: a copied project folder, or
/// the same folder opened by another user or computer, gets its own id.
fn device_id(conn: &Connection) -> Result<String> {
    let path = conn.path().unwrap_or("").to_owned();
    let fingerprint = (!path.is_empty()).then(|| {
        let machine = std::env::var("COMPUTERNAME")
            .or_else(|_| std::env::var("HOSTNAME"))
            .unwrap_or_default();
        let user = std::env::var("USERNAME")
            .or_else(|_| std::env::var("USER"))
            .unwrap_or_default();
        hex(&Sha256::digest(format!("{machine}|{user}|{path}")))
    });
    let meta = |key: &str| -> Result<Option<String>> {
        Ok(conn
            .query_row("SELECT value FROM sync_meta WHERE key = ?1", [key], |r| {
                r.get(0)
            })
            .optional()?)
    };
    if let Some(fingerprint) = &fingerprint
        && meta("device_fingerprint")?.as_deref() == Some(fingerprint.as_str())
        && let Some(id) = meta("device_id")?
        && is_device_id(&id)
    {
        return Ok(id);
    }
    let id: String = conn.query_row("SELECT lower(hex(randomblob(16)))", [], |r| r.get(0))?;
    if let Some(fingerprint) = fingerprint {
        conn.execute(
            "INSERT INTO sync_meta (key, value) VALUES ('device_id', ?1), ('device_fingerprint', ?2)
             ON CONFLICT(key) DO UPDATE SET value = excluded.value",
            params![id, fingerprint],
        )?;
    }
    Ok(id)
}

fn hex(bytes: &[u8]) -> String {
    let mut out = String::with_capacity(bytes.len() * 2);
    for b in bytes {
        let _ = write!(out, "{b:02x}");
    }
    out
}

fn unhex(text: &str) -> Option<Vec<u8>> {
    if !text.len().is_multiple_of(2) {
        return None;
    }
    (0..text.len())
        .step_by(2)
        .map(|i| u8::from_str_radix(text.get(i..i + 2)?, 16).ok())
        .collect()
}

fn table_columns(conn: &Connection, table: &str) -> Result<Vec<String>> {
    let mut statement = conn.prepare(&format!("PRAGMA main.table_info({table})"))?;
    let names = statement.query_map([], |r| r.get::<_, String>(1))?;
    Ok(names.collect::<rusqlite::Result<_>>()?)
}

const SHEET_KEY: &str = "(SELECT f.rel_path || '|' || r.source_sha256 || '|' || s.page
     FROM sheet s JOIN revision r ON r.id = s.revision_id JOIN file f ON f.id = r.file_id
     WHERE s.id = {p}.sheet_id)";

/// `json_object(...)` of a row as sent, reading from the row alias `p`.
fn row_json_sql(t: &SyncTable, columns: &[String], p: &str) -> String {
    let fields: Vec<String> = columns
        .iter()
        .filter(|c| !t.local_only.contains(&c.as_str()))
        .map(|c| {
            if t.sheet && c == "sheet_id" {
                format!("'sheet_key', {}", SHEET_KEY.replace("{p}", p))
            } else if t.blobs.contains(&c.as_str()) {
                format!("'{c}', CASE WHEN {p}.\"{c}\" IS NULL THEN NULL ELSE hex({p}.\"{c}\") END")
            } else {
                format!("'{c}', {p}.\"{c}\"")
            }
        })
        .collect();
    format!("json_object({})", fields.join(", "))
}

fn pk_json_sql(t: &SyncTable, p: &str) -> String {
    let parts: Vec<String> = t.pk.iter().map(|c| format!("{p}.\"{c}\"")).collect();
    format!("json_array({})", parts.join(", "))
}

fn install_triggers(
    conn: &Connection,
    device: &str,
    columns: &HashMap<&'static str, Vec<String>>,
) -> Result<()> {
    let mut sql = String::new();
    for t in SYNC_TABLES {
        let Some(columns) = columns.get(t.name).filter(|c| !c.is_empty()) else {
            continue;
        };
        let name = t.name;
        let log = |p: &str, op: &str, row: &str| {
            format!(
                "INSERT INTO change_log (id, hlc, device, tbl, pk, op, row_json)
                 VALUES (lower(hex(randomblob(16))), kp_hlc(), '{device}', '{name}', {}, '{op}', {row});",
                pk_json_sql(t, p)
            )
        };
        let upsert_new = log("NEW", "upsert", &row_json_sql(t, columns, "NEW"));
        // An update is shared only when a shared column changed: re-running a clash test
        // that finds the same clashes, or touching a local-only column, records nothing.
        let changed: Vec<String> = columns
            .iter()
            .filter(|c| !t.local_only.contains(&c.as_str()))
            .map(|c| format!("OLD.\"{c}\" IS NOT NEW.\"{c}\""))
            .collect();
        let changed = if changed.is_empty() {
            "0".to_owned()
        } else {
            changed.join(" OR ")
        };
        // A drawing re-import removes its sheets, and their links and markups with them;
        // that is local housekeeping, not a deletion to share.
        let sheet_alive = if t.sheet {
            " AND EXISTS (SELECT 1 FROM sheet WHERE id = OLD.sheet_id)"
        } else {
            ""
        };
        sql.push_str(&format!(
            "DROP TRIGGER IF EXISTS temp.kp_sync_{name}_ins;
             CREATE TEMP TRIGGER kp_sync_{name}_ins AFTER INSERT ON main.{name}
             WHEN NOT kp_applying() BEGIN {upsert_new} END;
             DROP TRIGGER IF EXISTS temp.kp_sync_{name}_upd;
             CREATE TEMP TRIGGER kp_sync_{name}_upd AFTER UPDATE ON main.{name}
             WHEN NOT kp_applying() AND ({changed}) BEGIN {upsert_new} END;
             DROP TRIGGER IF EXISTS temp.kp_sync_{name}_del;
             CREATE TEMP TRIGGER kp_sync_{name}_del AFTER DELETE ON main.{name}
             WHEN NOT kp_applying(){sheet_alive} BEGIN {} END;\n",
            log("OLD", "delete", "NULL")
        ));
    }
    conn.execute_batch(&sql)?;
    Ok(())
}

fn json_to_value(value: &serde_json::Value) -> Value {
    match value {
        serde_json::Value::Null => Value::Null,
        serde_json::Value::Bool(b) => Value::Integer(i64::from(*b)),
        serde_json::Value::Number(n) => n
            .as_i64()
            .map(Value::Integer)
            .unwrap_or_else(|| Value::Real(n.as_f64().unwrap_or(0.0))),
        serde_json::Value::String(s) => Value::Text(s.clone()),
        other => Value::Text(other.to_string()),
    }
}

fn row_to_change(row: &rusqlite::Row<'_>) -> rusqlite::Result<Change> {
    let pk: String = row.get("pk")?;
    let data: Option<String> = row.get("row_json")?;
    Ok(Change {
        id: row.get("id")?,
        hlc: row.get("hlc")?,
        device: row.get("device")?,
        tbl: row.get("tbl")?,
        pk: serde_json::from_str(&pk).unwrap_or(serde_json::Value::Null),
        op: row.get("op")?,
        row: data.and_then(|d| serde_json::from_str(&d).ok()),
    })
}

fn is_constraint(error: &rusqlite::Error) -> bool {
    matches!(error, rusqlite::Error::SqliteFailure(e, _) if e.code == ErrorCode::ConstraintViolation)
}

impl Store {
    /// This copy's device id.
    pub fn device_id(&self) -> &str {
        &self.sync.device
    }

    fn columns_of(&self, t: &SyncTable) -> &[String] {
        self.sync
            .columns
            .get(t.name)
            .map(Vec::as_slice)
            .unwrap_or(&[])
    }

    fn forget_pending(&self, id: &str) -> Result<()> {
        self.conn
            .prepare_cached("DELETE FROM sync_pending WHERE id = ?1")?
            .execute([id])?;
        Ok(())
    }

    /// What to send to the remote `via` after `seq`: changes made here, and changes
    /// received through other remotes (so a copy that moved from a shared folder to a
    /// server passes on what it got from the folder). Changes received before remotes were
    /// recorded are included when `include_unknown` is set.
    pub fn changes_to_send(
        &self,
        seq: i64,
        via: &str,
        include_unknown: bool,
        limit: usize,
    ) -> Result<Vec<(i64, Change)>> {
        let mut statement = self.conn.prepare(
            "SELECT seq, id, hlc, device, tbl, pk, op, row_json FROM change_log
             WHERE seq > ?1
               AND (origin = 'local' OR (via IS NULL AND ?3) OR (via IS NOT NULL AND via != ?2))
             ORDER BY seq LIMIT ?4",
        )?;
        let rows = statement
            .query_map(params![seq, via, include_unknown, limit as i64], |row| {
                Ok((row.get(0)?, row_to_change(row)?))
            })?;
        Ok(rows.collect::<rusqlite::Result<_>>()?)
    }

    /// Records every shared row that has no change yet, so content created before sync was
    /// switched on is sent too. Returns how many rows were recorded.
    pub fn snapshot_unlogged(&self) -> Result<usize> {
        let tx = self.conn.unchecked_transaction()?;
        let mut total = 0;
        for t in SYNC_TABLES {
            let columns = self.columns_of(t);
            if columns.is_empty() {
                continue;
            }
            let pk = pk_json_sql(t, "x");
            total += tx.execute(
                &format!(
                    "INSERT INTO change_log (id, hlc, device, tbl, pk, op, row_json)
                     SELECT lower(hex(randomblob(16))), kp_hlc(), ?1, ?2, {pk}, 'upsert', {}
                     FROM main.{} AS x
                     WHERE {pk} NOT IN (SELECT pk FROM change_log WHERE tbl = ?2)",
                    row_json_sql(t, columns, "x"),
                    t.name
                ),
                params![self.sync.device, t.name],
            )?;
        }
        tx.commit()?;
        Ok(total)
    }

    /// Applies changes received from other copies. Each is applied only if it is newer than
    /// what this copy knows about its row; what cannot be applied yet is kept and tried
    /// again, here and after later syncs.
    pub fn apply_changes(&self, changes: &[Change]) -> Result<ApplyReport> {
        self.apply_changes_via(changes, None)
    }

    /// As [`Store::apply_changes`], remembering the remote the changes came through.
    pub fn apply_changes_from(&self, changes: &[Change], via: &str) -> Result<ApplyReport> {
        self.apply_changes_via(changes, Some(via))
    }

    fn apply_changes_via(&self, changes: &[Change], via: Option<&str>) -> Result<ApplyReport> {
        let mut sorted: Vec<&Change> = changes.iter().collect();
        sorted.sort_by(|a, b| (&a.hlc, &a.id).cmp(&(&b.hlc, &b.id)));
        let tx = self.conn.unchecked_transaction()?;
        self.sync.applying.store(true, Ordering::SeqCst);
        let _reset = Applying(&self.sync.applying);
        let mut report = ApplyReport::default();
        for change in sorted {
            match self.apply_one(change, via)? {
                Outcome::Applied => report.applied += 1,
                Outcome::Skipped => report.skipped += 1,
                Outcome::Pending => report.pending += 1,
            }
        }
        let retried = self.retry_pending_inner()?;
        report.applied += retried;
        report.pending = report.pending.saturating_sub(retried);
        tx.commit()?;
        Ok(report)
    }

    /// Tries the kept changes again (after a drawing or model import, for example).
    /// Returns how many could be applied now.
    pub fn retry_pending(&self) -> Result<usize> {
        let tx = self.conn.unchecked_transaction()?;
        self.sync.applying.store(true, Ordering::SeqCst);
        let _reset = Applying(&self.sync.applying);
        let applied = self.retry_pending_inner()?;
        tx.commit()?;
        Ok(applied)
    }

    fn retry_pending_inner(&self) -> Result<usize> {
        let mut applied = 0;
        loop {
            let waiting: Vec<(Change, Option<String>)> = {
                let mut statement = self
                    .conn
                    .prepare("SELECT change_json, via FROM sync_pending")?;
                let rows = statement.query_map([], |r| {
                    Ok((r.get::<_, String>(0)?, r.get::<_, Option<String>>(1)?))
                })?;
                rows.filter_map(|r| r.ok())
                    .filter_map(|(json, via)| Some((serde_json::from_str(&json).ok()?, via)))
                    .collect()
            };
            if waiting.is_empty() {
                return Ok(applied);
            }
            let mut waiting = waiting;
            waiting.sort_by(|(a, _), (b, _)| (&a.hlc, &a.id).cmp(&(&b.hlc, &b.id)));
            let mut progress = 0;
            for (change, via) in &waiting {
                if !matches!(self.apply_one(change, via.as_deref())?, Outcome::Pending) {
                    progress += 1;
                }
            }
            applied += progress;
            if progress == 0 {
                return Ok(applied);
            }
        }
    }

    fn apply_one(&self, change: &Change, via: Option<&str>) -> Result<Outcome> {
        let known: bool = self
            .conn
            .prepare_cached("SELECT EXISTS (SELECT 1 FROM change_log WHERE id = ?1)")?
            .query_row([&change.id], |r| r.get(0))?;
        if known {
            self.forget_pending(&change.id)?;
            return Ok(Outcome::Skipped);
        }
        self.sync.observe(&change.hlc);
        let pk_text = change.pk.to_string();

        let Some(t) = spec(&change.tbl) else {
            return self.keep(change, "made by a newer version of KingPost Connect", via);
        };
        let newest: Option<(String, String)> = self
            .conn
            .prepare_cached(
                "SELECT hlc, id FROM change_log WHERE tbl = ?1 AND pk = ?2
                 ORDER BY hlc DESC, id DESC LIMIT 1",
            )?
            .query_row(params![change.tbl, pk_text], |r| Ok((r.get(0)?, r.get(1)?)))
            .optional()?;
        let stale =
            newest.is_some_and(|(hlc, id)| (hlc, id) >= (change.hlc.clone(), change.id.clone()));

        if !stale {
            let pk: Vec<Value> = match change.pk.as_array() {
                Some(values) if values.len() == t.pk.len() => {
                    values.iter().map(json_to_value).collect()
                }
                _ => return self.keep(change, "the row key is not valid", via),
            };
            self.conn.execute_batch("SAVEPOINT kp_apply")?;
            let result = match change.op.as_str() {
                "delete" => self.apply_delete(t, &pk).map(|_| None),
                "upsert" => self.apply_upsert(t, &pk, change),
                _ => Ok(Some("unknown operation".to_owned())),
            };
            match result {
                Ok(None) => self.conn.execute_batch("RELEASE kp_apply")?,
                Ok(Some(reason)) => {
                    self.conn
                        .execute_batch("ROLLBACK TO kp_apply; RELEASE kp_apply")?;
                    return self.keep(change, &reason, via);
                }
                Err(crate::StoreError::Sqlite(error)) if is_constraint(&error) => {
                    self.conn
                        .execute_batch("ROLLBACK TO kp_apply; RELEASE kp_apply")?;
                    return self.keep(
                        change,
                        &format!("waiting for related content ({error})"),
                        via,
                    );
                }
                Err(error) => {
                    self.conn
                        .execute_batch("ROLLBACK TO kp_apply; RELEASE kp_apply")?;
                    return Err(error);
                }
            }
        }

        self.conn
            .prepare_cached(
                "INSERT INTO change_log (id, hlc, device, tbl, pk, op, row_json, origin, via)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, 'remote', ?8)",
            )?
            .execute(params![
                change.id,
                change.hlc,
                change.device,
                change.tbl,
                pk_text,
                change.op,
                change.row.as_ref().map(|r| r.to_string()),
                via
            ])?;
        self.forget_pending(&change.id)?;
        Ok(if stale {
            Outcome::Skipped
        } else {
            Outcome::Applied
        })
    }

    fn keep(&self, change: &Change, reason: &str, via: Option<&str>) -> Result<Outcome> {
        self.conn
            .prepare_cached(
                "INSERT INTO sync_pending (id, change_json, reason, via) VALUES (?1, ?2, ?3, ?4)
                 ON CONFLICT(id) DO UPDATE SET reason = excluded.reason",
            )?
            .execute(params![
                change.id,
                serde_json::to_string(change).unwrap_or_default(),
                reason,
                via
            ])?;
        Ok(Outcome::Pending)
    }

    fn apply_delete(&self, t: &SyncTable, pk: &[Value]) -> Result<()> {
        let filter: Vec<String> = t.pk.iter().map(|c| format!("\"{c}\" = ?")).collect();
        self.conn
            .prepare_cached(&format!(
                "DELETE FROM main.{} WHERE {}",
                t.name,
                filter.join(" AND ")
            ))?
            .execute(rusqlite::params_from_iter(pk))?;
        Ok(())
    }

    /// Returns a reason when the change has to wait.
    fn apply_upsert(&self, t: &SyncTable, pk: &[Value], change: &Change) -> Result<Option<String>> {
        let Some(row) = change.row.as_ref().and_then(|r| r.as_object()) else {
            return Ok(Some("the row is missing".to_owned()));
        };
        let columns = self.columns_of(t);
        let mut names: Vec<String> = Vec::new();
        let mut values: Vec<Value> = Vec::new();
        for (key, value) in row {
            if t.sheet && key == "sheet_key" {
                let Some(sheet) = value
                    .as_str()
                    .map(|k| self.sheet_by_key(k))
                    .transpose()?
                    .flatten()
                else {
                    return Ok(Some(
                        self.missing_sheet_reason(value.as_str().unwrap_or(""))?,
                    ));
                };
                names.push("sheet_id".to_owned());
                values.push(Value::Integer(sheet));
                continue;
            }
            if !columns.iter().any(|c| c == key) || t.local_only.contains(&key.as_str()) {
                continue;
            }
            let value = if t.blobs.contains(&key.as_str()) {
                match value.as_str().and_then(unhex) {
                    Some(bytes) => Value::Blob(bytes),
                    None => Value::Null,
                }
            } else {
                json_to_value(value)
            };
            names.push(key.clone());
            values.push(value);
        }
        // The key columns always come from the key.
        for (column, value) in t.pk.iter().zip(pk) {
            match names.iter().position(|n| n == column) {
                Some(i) => values[i] = value.clone(),
                None => {
                    names.push((*column).to_owned());
                    values.push(value.clone());
                }
            }
        }

        if !t.natural.is_empty() && self.update_by_natural_key(t, pk, &names, &values)? {
            return Ok(None);
        }

        let quoted: Vec<String> = names.iter().map(|n| format!("\"{n}\"")).collect();
        let placeholders = vec!["?"; names.len()].join(", ");
        let set: Vec<String> = names
            .iter()
            .filter(|n| !t.pk.contains(&n.as_str()))
            .map(|n| format!("\"{n}\" = excluded.\"{n}\""))
            .collect();
        let conflict = if set.is_empty() {
            "DO NOTHING".to_owned()
        } else {
            format!("DO UPDATE SET {}", set.join(", "))
        };
        let key: Vec<String> = t.pk.iter().map(|c| format!("\"{c}\"")).collect();
        self.conn
            .prepare_cached(&format!(
                "INSERT INTO main.{} ({}) VALUES ({placeholders}) ON CONFLICT ({}) {conflict}",
                t.name,
                quoted.join(", "),
                key.join(", ")
            ))?
            .execute(rusqlite::params_from_iter(&values))?;
        Ok(None)
    }

    /// Updates a row that has the same natural key under another primary key. Returns
    /// whether one was found.
    fn update_by_natural_key(
        &self,
        t: &SyncTable,
        pk: &[Value],
        names: &[String],
        values: &[Value],
    ) -> Result<bool> {
        let mut natural: Vec<Value> = Vec::new();
        for column in t.natural {
            match names.iter().position(|n| n == column) {
                Some(i) => natural.push(values[i].clone()),
                None => return Ok(false),
            }
        }
        let mut filter: Vec<String> = t.natural.iter().map(|c| format!("\"{c}\" = ?")).collect();
        let other: Vec<String> = t.pk.iter().map(|c| format!("\"{c}\" = ?")).collect();
        filter.push(format!("NOT ({})", other.join(" AND ")));
        let mut args = natural;
        args.extend(pk.iter().cloned());
        let existing: Option<i64> = self
            .conn
            .prepare_cached(&format!(
                "SELECT rowid FROM main.{} WHERE {}",
                t.name,
                filter.join(" AND ")
            ))?
            .query_row(rusqlite::params_from_iter(&args), |r| r.get(0))
            .optional()?;
        let Some(rowid) = existing else {
            return Ok(false);
        };
        let mut set = Vec::new();
        let mut args = Vec::new();
        for (name, value) in names.iter().zip(values) {
            if !t.pk.contains(&name.as_str()) && !t.natural.contains(&name.as_str()) {
                set.push(format!("\"{name}\" = ?"));
                args.push(value.clone());
            }
        }
        if !set.is_empty() {
            args.push(Value::Integer(rowid));
            self.conn
                .prepare_cached(&format!(
                    "UPDATE main.{} SET {} WHERE rowid = ?",
                    t.name,
                    set.join(", ")
                ))?
                .execute(rusqlite::params_from_iter(&args))?;
        }
        Ok(true)
    }

    /// Why a sheet key does not resolve here, in words.
    fn missing_sheet_reason(&self, key: &str) -> Result<String> {
        let path = key.rsplitn(3, '|').nth(2).unwrap_or("");
        let has_file: bool = self.conn.query_row(
            "SELECT EXISTS (SELECT 1 FROM file f JOIN revision r ON r.file_id = f.id WHERE f.rel_path = ?1)",
            [path],
            |r| r.get(0),
        )?;
        Ok(if has_file {
            format!("it is on a revision of {path} that is not here")
        } else {
            format!("{path} is not imported here yet")
        })
    }

    fn sheet_by_key(&self, key: &str) -> Result<Option<i64>> {
        let mut parts = key.rsplitn(3, '|');
        let (Some(page), Some(sha), Some(path)) = (parts.next(), parts.next(), parts.next()) else {
            return Ok(None);
        };
        let Ok(page) = page.parse::<i64>() else {
            return Ok(None);
        };
        Ok(self
            .conn
            .prepare_cached(
                "SELECT s.id FROM sheet s JOIN revision r ON r.id = s.revision_id
                 JOIN file f ON f.id = r.file_id
                 WHERE f.rel_path = ?1 AND r.source_sha256 = ?2 AND s.page = ?3",
            )?
            .query_row(params![path, sha, page], |r| r.get(0))
            .optional()?)
    }

    pub fn sync_counts(&self) -> Result<SyncCounts> {
        let count = |sql: &str| -> Result<i64> { Ok(self.conn.query_row(sql, [], |r| r.get(0))?) };
        Ok(SyncCounts {
            device: self.sync.device.clone(),
            local: count("SELECT COUNT(*) FROM change_log WHERE origin = 'local'")?,
            remote: count("SELECT COUNT(*) FROM change_log WHERE origin = 'remote'")?,
            pending: count("SELECT COUNT(*) FROM sync_pending")?,
        })
    }

    pub fn pending_changes(&self) -> Result<Vec<PendingRow>> {
        let mut statement = self.conn.prepare(
            "SELECT id, change_json, reason, received_at FROM sync_pending ORDER BY received_at",
        )?;
        let rows = statement.query_map([], |r| {
            let json: String = r.get(1)?;
            let tbl = serde_json::from_str::<Change>(&json)
                .map(|c| c.tbl)
                .unwrap_or_default();
            Ok(PendingRow {
                id: r.get(0)?,
                tbl,
                reason: r.get(2)?,
                received_at: r.get(3)?,
            })
        })?;
        Ok(rows.collect::<rusqlite::Result<_>>()?)
    }

    pub fn sync_cursor(&self, remote: &str, peer: &str) -> Result<Option<String>> {
        Ok(self
            .conn
            .query_row(
                "SELECT position FROM sync_cursor WHERE remote = ?1 AND peer = ?2",
                params![remote, peer],
                |r| r.get(0),
            )
            .optional()?)
    }

    pub fn set_sync_cursor(&self, remote: &str, peer: &str, position: &str) -> Result<()> {
        self.conn.execute(
            "INSERT INTO sync_cursor (remote, peer, position) VALUES (?1, ?2, ?3)
             ON CONFLICT(remote, peer) DO UPDATE SET position = excluded.position",
            params![remote, peer, position],
        )?;
        Ok(())
    }

    pub fn is_published(&self, remote: &str, sha256: &str) -> Result<bool> {
        Ok(self.conn.query_row(
            "SELECT EXISTS (SELECT 1 FROM sync_published WHERE remote = ?1 AND sha256 = ?2)",
            params![remote, sha256],
            |r| r.get(0),
        )?)
    }

    pub fn mark_published(&self, remote: &str, sha256: &str) -> Result<()> {
        self.conn.execute(
            "INSERT OR IGNORE INTO sync_published (remote, sha256) VALUES (?1, ?2)",
            params![remote, sha256],
        )?;
        Ok(())
    }

    /// A value kept with the project's sync settings.
    pub fn sync_setting(&self, key: &str) -> Result<Option<String>> {
        Ok(self
            .conn
            .query_row(
                "SELECT value FROM sync_meta WHERE key = ?1",
                [format!("setting.{key}")],
                |r| r.get(0),
            )
            .optional()?)
    }

    pub fn set_sync_setting(&self, key: &str, value: Option<&str>) -> Result<()> {
        let key = format!("setting.{key}");
        match value {
            Some(value) => self.conn.execute(
                "INSERT INTO sync_meta (key, value) VALUES (?1, ?2)
                 ON CONFLICT(key) DO UPDATE SET value = excluded.value",
                params![key, value],
            )?,
            None => self
                .conn
                .execute("DELETE FROM sync_meta WHERE key = ?1", [key])?,
        };
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn store() -> Store {
        Store::open_in_memory().unwrap()
    }

    fn exec(store: &Store, sql: &str) {
        store.connection().execute_batch(sql).unwrap();
    }

    fn all(store: &Store) -> Vec<Change> {
        store
            .changes_to_send(0, "test", false, 10_000)
            .unwrap()
            .into_iter()
            .map(|(_, c)| c)
            .collect()
    }

    fn text(store: &Store, sql: &str) -> Option<String> {
        store
            .connection()
            .query_row(sql, [], |r| r.get(0))
            .optional()
            .unwrap()
    }

    const ISSUE: &str = "INSERT INTO issue (id, bcf_guid, title, created_by) VALUES ('i1', 'g1', 'Beam too small', 'ann');";

    #[test]
    fn edits_are_recorded_with_the_whole_row() {
        let a = store();
        exec(&a, ISSUE);
        exec(&a, "UPDATE issue SET status = 'closed' WHERE id = 'i1';");
        exec(&a, "DELETE FROM issue WHERE id = 'i1';");
        let changes = all(&a);
        assert_eq!(changes.len(), 3);
        assert_eq!(changes[0].op, "upsert");
        assert_eq!(changes[0].pk, serde_json::json!(["i1"]));
        assert_eq!(changes[1].row.as_ref().unwrap()["status"], "closed");
        assert_eq!(changes[2].op, "delete");
        assert!(changes[0].hlc < changes[1].hlc && changes[1].hlc < changes[2].hlc);
        assert_eq!(changes[0].device, a.device_id());
    }

    #[test]
    fn changes_travel_to_another_copy_without_echo() {
        let (a, b) = (store(), store());
        exec(&a, ISSUE);
        exec(
            &a,
            "INSERT INTO issue_comment (id, issue_id, author, text) VALUES ('c1', 'i1', 'ann', 'Check deflection');
             INSERT INTO issue_viewpoint (id, issue_id, guid, camera_json, snapshot) VALUES ('v1', 'i1', 'vg', '{}', x'89504e47');
             INSERT INTO issue_element (issue_id, element_global_id) VALUES ('i1', '2O2Fr$t4X7Zf8NOew3FLOH');",
        );
        let report = b.apply_changes(&all(&a)).unwrap();
        assert_eq!(report.applied, 4);
        assert_eq!(
            text(&b, "SELECT text FROM issue_comment WHERE id = 'c1'").as_deref(),
            Some("Check deflection")
        );
        let snapshot: Vec<u8> = b
            .connection()
            .query_row("SELECT snapshot FROM issue_viewpoint", [], |r| r.get(0))
            .unwrap();
        assert_eq!(snapshot, vec![0x89, 0x50, 0x4e, 0x47]);
        // Received changes are not sent back out as b's own.
        assert!(all(&b).is_empty());
        assert_eq!(b.sync_counts().unwrap().remote, 4);
        // Applying the same batch again changes nothing.
        let again = b.apply_changes(&all(&a)).unwrap();
        assert_eq!((again.applied, again.skipped), (0, 4));
    }

    #[test]
    fn newest_edit_wins_on_both_sides() {
        let (a, b) = (store(), store());
        exec(
            &a,
            "INSERT INTO note (id, point_json, text) VALUES ('n1', '[0,0,0]', 'first');",
        );
        b.apply_changes(&all(&a)).unwrap();
        exec(&b, "UPDATE note SET text = 'from b' WHERE id = 'n1';");
        std::thread::sleep(std::time::Duration::from_millis(3));
        exec(
            &a,
            "UPDATE note SET text = 'from a, later' WHERE id = 'n1';",
        );
        let from_a = all(&a);
        let from_b = all(&b);
        a.apply_changes(&from_b).unwrap();
        b.apply_changes(&from_a).unwrap();
        let expected = Some("from a, later".to_owned());
        assert_eq!(text(&a, "SELECT text FROM note"), expected);
        assert_eq!(text(&b, "SELECT text FROM note"), expected);
    }

    #[test]
    fn deletes_travel() {
        let (a, b) = (store(), store());
        exec(&a, ISSUE);
        b.apply_changes(&all(&a)).unwrap();
        exec(&a, "DELETE FROM issue WHERE id = 'i1';");
        b.apply_changes(&all(&a)).unwrap();
        assert_eq!(text(&b, "SELECT id FROM issue"), None);
    }

    #[test]
    fn a_child_that_arrives_first_waits_for_its_parent() {
        let (a, b) = (store(), store());
        exec(&a, ISSUE);
        exec(
            &a,
            "INSERT INTO issue_comment (id, issue_id, author, text) VALUES ('c1', 'i1', 'ann', 'x');",
        );
        let changes = all(&a);
        let report = b.apply_changes(&changes[1..]).unwrap();
        assert_eq!(report.pending, 1);
        assert_eq!(b.pending_changes().unwrap()[0].tbl, "issue_comment");
        let report = b.apply_changes(&changes[..1]).unwrap();
        assert_eq!((report.applied, report.pending), (2, 0));
        assert_eq!(
            text(&b, "SELECT id FROM issue_comment").as_deref(),
            Some("c1")
        );
    }

    fn import_drawing(store: &Store) {
        exec(
            store,
            "INSERT INTO file (id, rel_path, kind) VALUES (7, 'drawings/S-101.pdf', 'pdf');
             INSERT INTO revision (id, file_id, idx, source_sha256) VALUES (9, 7, 1, 'abc');
             INSERT INTO sheet (id, revision_id, page) VALUES (42, 9, 1);",
        );
    }

    #[test]
    fn markups_find_their_sheet_by_file_hash_and_page() {
        let (a, b) = (store(), store());
        import_drawing(&a);
        exec(
            &a,
            "INSERT INTO sheet_markup (id, sheet_id, author, kind, geometry_json) VALUES ('m1', 42, 'ann', 'cloud', '[]');",
        );
        let changes = all(&a);
        assert_eq!(changes.len(), 1);
        assert_eq!(
            changes[0].row.as_ref().unwrap()["sheet_key"],
            "drawings/S-101.pdf|abc|1"
        );
        assert_eq!(b.apply_changes(&changes).unwrap().pending, 1);
        // The drawing is imported here under other local numbers.
        exec(
            &b,
            "INSERT INTO file (id, rel_path, kind) VALUES (1, 'drawings/S-101.pdf', 'pdf');
             INSERT INTO revision (id, file_id, idx, source_sha256) VALUES (1, 1, 1, 'abc');
             INSERT INTO sheet (id, revision_id, page) VALUES (5, 1, 1);",
        );
        assert_eq!(b.retry_pending().unwrap(), 1);
        let sheet: i64 = b
            .connection()
            .query_row("SELECT sheet_id FROM sheet_markup", [], |r| r.get(0))
            .unwrap();
        assert_eq!(sheet, 5);
    }

    #[test]
    fn removing_a_drawing_locally_is_not_shared() {
        let a = store();
        import_drawing(&a);
        exec(
            &a,
            "INSERT INTO sheet_markup (id, sheet_id, author, kind, geometry_json) VALUES ('m1', 42, 'ann', 'cloud', '[]');",
        );
        exec(&a, "DELETE FROM sheet WHERE id = 42;");
        let changes = all(&a);
        assert_eq!(changes.len(), 1, "only the markup's creation: {changes:?}");
        // Deleting the markup itself is shared.
        import_drawing_again(&a);
        exec(&a, "DELETE FROM sheet_markup WHERE id = 'm2';");
        assert_eq!(all(&a).last().unwrap().op, "delete");
    }

    fn import_drawing_again(store: &Store) {
        exec(
            store,
            "INSERT INTO sheet (id, revision_id, page) VALUES (43, 9, 2);
             INSERT INTO sheet_markup (id, sheet_id, author, kind, geometry_json) VALUES ('m2', 43, 'ann', 'cloud', '[]');",
        );
    }

    #[test]
    fn rerunning_a_clash_test_with_the_same_result_records_nothing() {
        let a = store();
        a.create_clash_test("t1", "Beams v ducts", "hard", 0.0, &[], &[])
            .unwrap();
        let found = |a_id: &str| crate::ClashFound {
            a_global_id: a_id.into(),
            b_global_id: "B".into(),
            kind: "hard".into(),
            distance: 0.01,
            point: [1.0, 2.0, 3.0],
        };
        let mut n = 0;
        let mut id = || {
            n += 1;
            format!("c{n}")
        };
        a.record_clash_run("t1", None, &[found("A1"), found("A2")], &mut id)
            .unwrap();
        let after_first = all(&a).len();
        a.record_clash_run("t1", None, &[found("A1"), found("A2")], &mut id)
            .unwrap();
        assert_eq!(all(&a).len(), after_first, "{:?}", &all(&a)[after_first..]);
        // One clash is gone: only its status change is recorded.
        a.record_clash_run("t1", None, &[found("A1")], &mut id)
            .unwrap();
        let new: Vec<Change> = all(&a).split_off(after_first);
        assert_eq!(new.len(), 1);
        assert_eq!(new[0].row.as_ref().unwrap()["status"], "resolved");
        // A no-op update is not a change either.
        exec(&a, "UPDATE note SET text = text;");
        exec(&a, "UPDATE clash SET status = status;");
        assert_eq!(all(&a).len(), after_first + 1);
    }

    #[test]
    fn the_same_clash_found_on_two_copies_merges() {
        let (a, b) = (store(), store());
        let test = "INSERT INTO clash_test (id, name, kind, set_a_json, set_b_json, last_revision_id) VALUES ('t1', 'Beams v ducts', 'hard', '{}', '{}', NULL);";
        exec(&a, test);
        b.apply_changes(&all(&a)).unwrap();
        exec(
            &b,
            "INSERT INTO clash (id, test_id, a_global_id, b_global_id, kind) VALUES ('cb', 't1', 'A', 'B', 'hard');",
        );
        exec(
            &a,
            "INSERT INTO clash (id, test_id, a_global_id, b_global_id, kind, status) VALUES ('ca', 't1', 'A', 'B', 'hard', 'reviewed');",
        );
        let report = b.apply_changes(&all(&a)).unwrap();
        assert_eq!(report.pending, 0);
        assert_eq!(
            text(&b, "SELECT status FROM clash WHERE id = 'cb'").as_deref(),
            Some("reviewed")
        );
    }

    #[test]
    fn content_from_before_sync_is_recorded_once() {
        let a = store();
        exec(&a, ISSUE);
        exec(
            &a,
            "INSERT INTO note (id, point_json, text) VALUES ('n1', '[0,0,0]', 'x');",
        );
        exec(&a, "DELETE FROM change_log;");
        assert_eq!(a.snapshot_unlogged().unwrap(), 2);
        assert_eq!(a.snapshot_unlogged().unwrap(), 0);
        let b = store();
        assert_eq!(b.apply_changes(&all(&a)).unwrap().applied, 2);
    }

    #[test]
    fn device_id_belongs_to_the_database_file() {
        let dir = tempfile::tempdir().unwrap();
        let first = dir.path().join("a.db");
        let id = Store::open(&first).unwrap().device_id().to_owned();
        assert_eq!(Store::open(&first).unwrap().device_id(), id);
        let copy = dir.path().join("b.db");
        std::fs::copy(&first, &copy).unwrap();
        assert_ne!(Store::open(&copy).unwrap().device_id(), id);
    }

    #[test]
    fn clock_moves_past_received_changes() {
        let (a, b) = (store(), store());
        let far = Change {
            id: "x".into(),
            hlc: format_hlc(9_999_999_999_999, 0, "zz"),
            device: "zz".into(),
            tbl: "note".into(),
            pk: serde_json::json!(["n9"]),
            op: "upsert".into(),
            row: Some(serde_json::json!({"id": "n9", "point_json": "[0,0,0]", "text": "future"})),
        };
        a.apply_changes(std::slice::from_ref(&far)).unwrap();
        exec(&a, "UPDATE note SET text = 'edited after' WHERE id = 'n9';");
        let edit = all(&a).pop().unwrap();
        assert!(edit.hlc > far.hlc);
        b.apply_changes(&[edit, far]).unwrap();
        assert_eq!(
            text(&b, "SELECT text FROM note").as_deref(),
            Some("edited after")
        );
    }

    #[test]
    fn changes_from_one_remote_are_passed_on_to_others() {
        let (a, b) = (store(), store());
        exec(
            &a,
            "INSERT INTO note (id, point_json, text) VALUES ('n1', '[0,0,0]', 'from a');",
        );
        b.apply_changes_from(&all(&a), "folder:x").unwrap();
        exec(
            &b,
            "INSERT INTO note (id, point_json, text) VALUES ('n2', '[0,0,0]', 'from b');",
        );
        let to = |via: &str, unknown: bool| -> Vec<String> {
            b.changes_to_send(0, via, unknown, 100)
                .unwrap()
                .into_iter()
                .map(|(_, c)| c.pk[0].as_str().unwrap().to_owned())
                .collect()
        };
        // Back to the folder: only the copy's own. To a server: both.
        assert_eq!(to("folder:x", false), vec!["n2"]);
        assert_eq!(to("server:y", false), vec!["n1", "n2"]);
        // Received before remotes were recorded: sent where asked for.
        let c = store();
        c.apply_changes(&all(&a)).unwrap();
        assert!(
            c.changes_to_send(0, "folder:x", false, 100)
                .unwrap()
                .is_empty()
        );
        assert_eq!(
            c.changes_to_send(0, "server:y", true, 100).unwrap().len(),
            1
        );
    }

    #[test]
    fn unknown_tables_wait_for_a_newer_version() {
        let a = store();
        let change = Change {
            id: "u".into(),
            hlc: format_hlc(1, 0, "d"),
            device: "d".into(),
            tbl: "future_table".into(),
            pk: serde_json::json!(["1"]),
            op: "upsert".into(),
            row: Some(serde_json::json!({})),
        };
        assert_eq!(a.apply_changes(&[change]).unwrap().pending, 1);
    }

    #[test]
    fn settings_and_cursors_round_trip() {
        let a = store();
        a.set_sync_setting("folder", Some("D:/Share")).unwrap();
        assert_eq!(
            a.sync_setting("folder").unwrap().as_deref(),
            Some("D:/Share")
        );
        a.set_sync_setting("folder", None).unwrap();
        assert_eq!(a.sync_setting("folder").unwrap(), None);
        a.set_sync_cursor("folder:x", "dev", "12").unwrap();
        assert_eq!(
            a.sync_cursor("folder:x", "dev").unwrap().as_deref(),
            Some("12")
        );
        assert!(!a.is_published("folder:x", "abc").unwrap());
        a.mark_published("folder:x", "abc").unwrap();
        assert!(a.is_published("folder:x", "abc").unwrap());
    }
}
