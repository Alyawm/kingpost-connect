//! Clash tests and the clashes their runs found.

use rusqlite::{OptionalExtension, params};
use serde::{Deserialize, Serialize};

use crate::{Result, Store};

pub const CLASH_STATUSES: &[&str] = &["new", "active", "reviewed", "approved", "resolved"];

#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct ClashTestRow {
    pub id: String,
    pub name: String,
    pub kind: String,
    pub clearance: f64,
    pub set_a: Vec<String>,
    pub set_b: Vec<String>,
    pub created_at: String,
    pub last_run_at: Option<String>,
    pub last_revision_id: Option<i64>,
    pub open_count: i64,
    pub total_count: i64,
}

/// One clash as a run reports it.
#[derive(Debug, Clone, PartialEq, Deserialize)]
pub struct ClashFound {
    pub a_global_id: String,
    pub b_global_id: String,
    pub kind: String,
    pub distance: f64,
    pub point: [f64; 3],
}

#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct ClashRow {
    pub id: String,
    pub test_id: String,
    pub a_global_id: String,
    pub b_global_id: String,
    pub kind: String,
    pub distance: f64,
    pub point: [f64; 3],
    pub status: String,
    pub note: Option<String>,
    pub first_seen_at: String,
    pub last_seen_at: String,
    pub resolved_at: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Default, Serialize)]
pub struct RunSummary {
    pub found: usize,
    pub new: usize,
    pub still: usize,
    pub reopened: usize,
    pub resolved: usize,
}

fn test_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<ClashTestRow> {
    let set_a: String = row.get(4)?;
    let set_b: String = row.get(5)?;
    Ok(ClashTestRow {
        id: row.get(0)?,
        name: row.get(1)?,
        kind: row.get(2)?,
        clearance: row.get(3)?,
        set_a: serde_json::from_str(&set_a).unwrap_or_default(),
        set_b: serde_json::from_str(&set_b).unwrap_or_default(),
        created_at: row.get(6)?,
        last_run_at: row.get(7)?,
        last_revision_id: row.get(8)?,
        open_count: row.get(9)?,
        total_count: row.get(10)?,
    })
}

const TEST_COLUMNS: &str = "t.id, t.name, t.kind, t.clearance, t.set_a_json, t.set_b_json, t.created_at, \
     t.last_run_at, t.last_revision_id, \
     (SELECT COUNT(*) FROM clash c WHERE c.test_id = t.id AND c.status NOT IN ('approved', 'resolved')), \
     (SELECT COUNT(*) FROM clash c WHERE c.test_id = t.id)";

impl Store {
    pub fn create_clash_test(
        &self,
        id: &str,
        name: &str,
        kind: &str,
        clearance: f64,
        set_a: &[String],
        set_b: &[String],
    ) -> Result<ClashTestRow> {
        self.conn.execute(
            "INSERT INTO clash_test (id, name, kind, clearance, set_a_json, set_b_json)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
            params![
                id,
                name,
                kind,
                clearance,
                serde_json::to_string(set_a).unwrap_or_else(|_| "[]".into()),
                serde_json::to_string(set_b).unwrap_or_else(|_| "[]".into())
            ],
        )?;
        self.clash_test(id)?.ok_or(crate::StoreError::Sqlite(
            rusqlite::Error::QueryReturnedNoRows,
        ))
    }

    pub fn clash_tests(&self) -> Result<Vec<ClashTestRow>> {
        let mut statement = self.conn.prepare(&format!(
            "SELECT {TEST_COLUMNS} FROM clash_test t ORDER BY t.created_at"
        ))?;
        let rows = statement.query_map([], test_row)?;
        Ok(rows.collect::<rusqlite::Result<_>>()?)
    }

    pub fn clash_test(&self, id: &str) -> Result<Option<ClashTestRow>> {
        Ok(self
            .conn
            .query_row(
                &format!("SELECT {TEST_COLUMNS} FROM clash_test t WHERE t.id = ?1"),
                [id],
                test_row,
            )
            .optional()?)
    }

    pub fn delete_clash_test(&self, id: &str) -> Result<bool> {
        Ok(self
            .conn
            .execute("DELETE FROM clash_test WHERE id = ?1", [id])?
            > 0)
    }

    /// Records a run: found clashes are inserted or refreshed (a resolved one that is back
    /// becomes active), and clashes not found this time are marked resolved.
    pub fn record_clash_run(
        &self,
        test_id: &str,
        revision_id: Option<i64>,
        found: &[ClashFound],
        mut new_id: impl FnMut() -> String,
    ) -> Result<RunSummary> {
        let tx = self.conn.unchecked_transaction()?;
        let mut summary = RunSummary {
            found: found.len(),
            ..Default::default()
        };
        {
            let mut existing = tx.prepare_cached(
                "SELECT id, status FROM clash WHERE test_id = ?1 AND a_global_id = ?2 AND b_global_id = ?3",
            )?;
            let mut insert = tx.prepare_cached(
                "INSERT INTO clash (id, test_id, a_global_id, b_global_id, kind, distance, point_json)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
            )?;
            let mut refresh = tx.prepare_cached(
                "UPDATE clash SET kind = ?2, distance = ?3, point_json = ?4,
                        last_seen_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now'),
                        status = CASE WHEN status = 'resolved' THEN 'active' ELSE status END,
                        resolved_at = NULL
                 WHERE id = ?1",
            )?;
            let mut seen: Vec<String> = Vec::with_capacity(found.len());
            for f in found {
                let point = serde_json::to_string(&f.point).unwrap_or_else(|_| "[0,0,0]".into());
                let current: Option<(String, String)> = existing
                    .query_row(params![test_id, f.a_global_id, f.b_global_id], |r| {
                        Ok((r.get(0)?, r.get(1)?))
                    })
                    .optional()?;
                match current {
                    Some((id, status)) => {
                        if status == "resolved" {
                            summary.reopened += 1;
                        } else {
                            summary.still += 1;
                        }
                        refresh.execute(params![id, f.kind, f.distance, point])?;
                        seen.push(id);
                    }
                    None => {
                        let id = new_id();
                        insert.execute(params![
                            id,
                            test_id,
                            f.a_global_id,
                            f.b_global_id,
                            f.kind,
                            f.distance,
                            point
                        ])?;
                        summary.new += 1;
                        seen.push(id);
                    }
                }
            }
            // Everything else that was open is resolved by this run.
            let placeholders = if seen.is_empty() {
                "''".to_owned()
            } else {
                seen.iter().map(|_| "?").collect::<Vec<_>>().join(",")
            };
            let sql = format!(
                "UPDATE clash SET status = 'resolved', resolved_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
                 WHERE test_id = ? AND status != 'resolved' AND id NOT IN ({placeholders})"
            );
            let mut args: Vec<&dyn rusqlite::ToSql> = vec![&test_id];
            for id in &seen {
                args.push(id);
            }
            summary.resolved = tx.execute(&sql, args.as_slice())?;
            tx.execute(
                "UPDATE clash_test SET last_run_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now'),
                        last_revision_id = ?2 WHERE id = ?1",
                params![test_id, revision_id],
            )?;
        }
        tx.commit()?;
        Ok(summary)
    }

    pub fn clashes(&self, test_id: &str) -> Result<Vec<ClashRow>> {
        let mut statement = self.conn.prepare(
            "SELECT id, test_id, a_global_id, b_global_id, kind, distance, point_json, status, note,
                    first_seen_at, last_seen_at, resolved_at
             FROM clash WHERE test_id = ?1
             ORDER BY CASE status WHEN 'new' THEN 0 WHEN 'active' THEN 1 WHEN 'reviewed' THEN 2
                                  WHEN 'approved' THEN 3 ELSE 4 END, distance, first_seen_at",
        )?;
        let rows = statement.query_map([test_id], |row| {
            let point: String = row.get(6)?;
            Ok(ClashRow {
                id: row.get(0)?,
                test_id: row.get(1)?,
                a_global_id: row.get(2)?,
                b_global_id: row.get(3)?,
                kind: row.get(4)?,
                distance: row.get(5)?,
                point: serde_json::from_str(&point).unwrap_or([0.0; 3]),
                status: row.get(7)?,
                note: row.get(8)?,
                first_seen_at: row.get(9)?,
                last_seen_at: row.get(10)?,
                resolved_at: row.get(11)?,
            })
        })?;
        Ok(rows.collect::<rusqlite::Result<_>>()?)
    }

    pub fn set_clash_status(&self, id: &str, status: &str, note: Option<&str>) -> Result<bool> {
        if !CLASH_STATUSES.contains(&status) {
            return Err(crate::StoreError::Sqlite(
                rusqlite::Error::InvalidParameterName(format!("unknown clash status {status}")),
            ));
        }
        Ok(self.conn.execute(
            "UPDATE clash SET status = ?2, note = COALESCE(?3, note),
                    resolved_at = CASE WHEN ?2 = 'resolved' THEN strftime('%Y-%m-%dT%H:%M:%fZ', 'now') ELSE NULL END
             WHERE id = ?1",
            params![id, status, note],
        )? > 0)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn found(a: &str, b: &str, distance: f64) -> ClashFound {
        ClashFound {
            a_global_id: a.into(),
            b_global_id: b.into(),
            kind: if distance == 0.0 {
                "hard".into()
            } else {
                "clearance".into()
            },
            distance,
            point: [1.0, 2.0, 3.0],
        }
    }

    #[test]
    fn runs_keep_statuses_and_resolve_what_is_gone() {
        let store = Store::open_in_memory().unwrap();
        let file = store.upsert_file("a.ifc", "ifc", None, None, None).unwrap();
        let (rev1, _) = store.create_revision(file, "s1", None, "{}", None).unwrap();
        let (rev2, _) = store.create_revision(file, "s2", None, "{}", None).unwrap();
        let mut counter = 0;
        let mut next = || {
            counter += 1;
            format!("c{counter}")
        };
        let test = store
            .create_clash_test(
                "t1",
                "Beams vs ducts",
                "clearance",
                0.05,
                &["A".into()],
                &["B".into(), "C".into()],
            )
            .unwrap();
        assert_eq!(test.set_b.len(), 2);
        assert_eq!(test.total_count, 0);

        let first = store
            .record_clash_run(
                "t1",
                Some(rev1),
                &[found("A", "B", 0.0), found("A", "C", 0.02)],
                &mut next,
            )
            .unwrap();
        assert_eq!((first.new, first.still, first.resolved), (2, 0, 0));
        let rows = store.clashes("t1").unwrap();
        assert_eq!(rows.len(), 2);
        assert_eq!(rows[0].status, "new");
        assert_eq!(rows[0].point, [1.0, 2.0, 3.0]);
        let ab = rows
            .iter()
            .find(|r| r.b_global_id == "B")
            .unwrap()
            .id
            .clone();
        assert!(
            store
                .set_clash_status(&ab, "approved", Some("agreed on site"))
                .unwrap()
        );
        assert!(store.set_clash_status(&ab, "sideways", None).is_err());
        assert_eq!(store.clash_test("t1").unwrap().unwrap().open_count, 1);

        // Second run: A-B still there (keeps approved), A-C gone (resolved), A-D new.
        let second = store
            .record_clash_run(
                "t1",
                Some(rev2),
                &[found("A", "B", 0.0), found("A", "D", 0.01)],
                &mut next,
            )
            .unwrap();
        assert_eq!((second.new, second.still, second.resolved), (1, 1, 1));
        let rows = store.clashes("t1").unwrap();
        let by = |b: &str| rows.iter().find(|r| r.b_global_id == b).unwrap();
        assert_eq!(by("B").status, "approved");
        assert_eq!(by("B").note.as_deref(), Some("agreed on site"));
        assert_eq!(by("C").status, "resolved");
        assert!(by("C").resolved_at.is_some());
        assert_eq!(by("D").status, "new");

        // Third run: A-C is back, so it reopens as active.
        let third = store
            .record_clash_run("t1", None, &[found("A", "C", 0.03)], &mut next)
            .unwrap();
        assert_eq!((third.reopened, third.resolved), (1, 2));
        let rows = store.clashes("t1").unwrap();
        assert_eq!(
            rows.iter().find(|r| r.b_global_id == "C").unwrap().status,
            "active"
        );
        assert_eq!(
            store.clash_test("t1").unwrap().unwrap().last_revision_id,
            None
        );

        assert!(store.delete_clash_test("t1").unwrap());
        assert!(store.clashes("t1").unwrap().is_empty());
    }
}
