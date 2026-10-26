//! Issues (BCF topics), their comments and viewpoints, the elements they point at, and
//! the design status of elements. Issues and statuses are keyed by IFC GlobalId so they
//! survive re-imports and travel between revisions.

use rusqlite::{OptionalExtension, params};
use serde::{Deserialize, Serialize};

use crate::{Result, Store};

/// Design stages an element passes through, in order.
pub const STAGES: &[&str] = &["modelled", "analysed", "designed", "checked", "approved"];

#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct IssueRow {
    pub id: String,
    pub bcf_guid: String,
    pub title: String,
    pub description: Option<String>,
    pub topic_type: String,
    pub status: String,
    pub priority: Option<String>,
    pub assignee: Option<String>,
    pub due: Option<String>,
    pub labels: Vec<String>,
    pub stage: Option<String>,
    pub idx: Option<i64>,
    pub created_by: String,
    pub created_at: String,
    pub modified_by: Option<String>,
    pub modified_at: Option<String>,
    pub comment_count: i64,
    pub viewpoint_count: i64,
    pub element_count: i64,
}

#[derive(Debug, Clone, Default, PartialEq, Deserialize)]
pub struct NewIssue {
    pub title: String,
    pub description: Option<String>,
    pub topic_type: Option<String>,
    pub status: Option<String>,
    pub priority: Option<String>,
    pub assignee: Option<String>,
    pub due: Option<String>,
    #[serde(default)]
    pub labels: Vec<String>,
    pub stage: Option<String>,
    pub created_by: String,
    /// Set when importing; otherwise now.
    pub created_at: Option<String>,
    pub idx: Option<i64>,
}

/// Fields to change on an issue; `None` leaves a field alone, `Some(None)` clears it.
#[derive(Debug, Clone, Default, PartialEq, Deserialize)]
pub struct IssuePatch {
    pub title: Option<String>,
    #[serde(default, with = "double_option")]
    pub description: Option<Option<String>>,
    pub topic_type: Option<String>,
    pub status: Option<String>,
    #[serde(default, with = "double_option")]
    pub priority: Option<Option<String>>,
    #[serde(default, with = "double_option")]
    pub assignee: Option<Option<String>>,
    #[serde(default, with = "double_option")]
    pub due: Option<Option<String>>,
    pub labels: Option<Vec<String>>,
    #[serde(default, with = "double_option")]
    pub stage: Option<Option<String>>,
    pub modified_by: Option<String>,
}

/// Serde treats a missing field and `null` the same for `Option<Option<T>>`; this keeps
/// them apart so an explicit `null` clears a field while absence leaves it alone.
mod double_option {
    use serde::{Deserialize, Deserializer};

    pub fn deserialize<'de, D, T>(deserializer: D) -> Result<Option<Option<T>>, D::Error>
    where
        D: Deserializer<'de>,
        T: Deserialize<'de>,
    {
        Option::<T>::deserialize(deserializer).map(Some)
    }
}

#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct CommentRow {
    pub id: String,
    pub issue_id: String,
    pub author: String,
    pub text: String,
    pub viewpoint_id: Option<String>,
    pub created_at: String,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct ViewpointRow {
    pub id: String,
    pub issue_id: String,
    pub guid: String,
    pub camera_json: String,
    pub components_json: String,
    pub lines_json: String,
    pub clipping_json: String,
    pub has_snapshot: bool,
    pub created_at: String,
}

#[derive(Debug, Clone, PartialEq)]
pub struct NewViewpoint<'a> {
    pub id: &'a str,
    pub issue_id: &'a str,
    pub guid: &'a str,
    pub camera_json: &'a str,
    pub components_json: &'a str,
    pub lines_json: &'a str,
    pub clipping_json: &'a str,
    pub snapshot: Option<&'a [u8]>,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct StatusRow {
    pub element_global_id: String,
    pub stage: String,
    pub set_by: String,
    pub set_at: String,
    pub note: Option<String>,
}

const ISSUE_COLUMNS: &str = "i.id, i.bcf_guid, i.title, i.description, i.topic_type, i.status, i.priority, \
     i.assignee, i.due, i.labels_json, i.stage, i.idx, i.created_by, i.created_at, i.modified_by, i.modified_at, \
     (SELECT COUNT(*) FROM issue_comment c WHERE c.issue_id = i.id), \
     (SELECT COUNT(*) FROM issue_viewpoint v WHERE v.issue_id = i.id), \
     (SELECT COUNT(*) FROM issue_element e WHERE e.issue_id = i.id)";

fn issue_from_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<IssueRow> {
    let labels_json: String = row.get(9)?;
    Ok(IssueRow {
        id: row.get(0)?,
        bcf_guid: row.get(1)?,
        title: row.get(2)?,
        description: row.get(3)?,
        topic_type: row.get(4)?,
        status: row.get(5)?,
        priority: row.get(6)?,
        assignee: row.get(7)?,
        due: row.get(8)?,
        labels: serde_json::from_str(&labels_json).unwrap_or_default(),
        stage: row.get(10)?,
        idx: row.get(11)?,
        created_by: row.get(12)?,
        created_at: row.get(13)?,
        modified_by: row.get(14)?,
        modified_at: row.get(15)?,
        comment_count: row.get(16)?,
        viewpoint_count: row.get(17)?,
        element_count: row.get(18)?,
    })
}

impl Store {
    pub fn issues(&self) -> Result<Vec<IssueRow>> {
        let sql =
            format!("SELECT {ISSUE_COLUMNS} FROM issue i ORDER BY i.created_at DESC, i.rowid DESC");
        let mut statement = self.conn.prepare(&sql)?;
        let rows = statement.query_map([], issue_from_row)?;
        Ok(rows.collect::<rusqlite::Result<_>>()?)
    }

    pub fn issue(&self, id: &str) -> Result<Option<IssueRow>> {
        let sql = format!("SELECT {ISSUE_COLUMNS} FROM issue i WHERE i.id = ?1");
        Ok(self.conn.query_row(&sql, [id], issue_from_row).optional()?)
    }

    pub fn issue_by_guid(&self, bcf_guid: &str) -> Result<Option<IssueRow>> {
        let sql = format!("SELECT {ISSUE_COLUMNS} FROM issue i WHERE i.bcf_guid = ?1");
        Ok(self
            .conn
            .query_row(&sql, [bcf_guid], issue_from_row)
            .optional()?)
    }

    pub fn insert_issue(&self, id: &str, bcf_guid: &str, issue: &NewIssue) -> Result<()> {
        let idx: i64 = match issue.idx {
            Some(idx) => idx,
            None => {
                self.conn
                    .query_row("SELECT COALESCE(MAX(idx), 0) + 1 FROM issue", [], |row| {
                        row.get(0)
                    })?
            }
        };
        self.conn.execute(
            "INSERT INTO issue (id, bcf_guid, title, description, topic_type, status, priority, assignee, due,
                                labels_json, stage, idx, created_by, created_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13,
                     COALESCE(?14, strftime('%Y-%m-%dT%H:%M:%fZ', 'now')))",
            params![
                id,
                bcf_guid,
                issue.title.trim(),
                issue.description,
                issue.topic_type.as_deref().unwrap_or("Issue"),
                issue.status.as_deref().unwrap_or("open"),
                issue.priority,
                issue.assignee,
                issue.due,
                serde_json::to_string(&issue.labels).unwrap_or_else(|_| "[]".into()),
                issue.stage,
                idx,
                issue.created_by,
                issue.created_at,
            ],
        )?;
        Ok(())
    }

    pub fn update_issue(&self, id: &str, patch: &IssuePatch) -> Result<bool> {
        let labels_json = patch
            .labels
            .as_ref()
            .map(|l| serde_json::to_string(l).unwrap_or_else(|_| "[]".into()));
        let changed = self.conn.execute(
            "UPDATE issue SET
               title = COALESCE(?2, title),
               description = CASE WHEN ?3 THEN ?4 ELSE description END,
               topic_type = COALESCE(?5, topic_type),
               status = COALESCE(?6, status),
               priority = CASE WHEN ?7 THEN ?8 ELSE priority END,
               assignee = CASE WHEN ?9 THEN ?10 ELSE assignee END,
               due = CASE WHEN ?11 THEN ?12 ELSE due END,
               labels_json = COALESCE(?13, labels_json),
               stage = CASE WHEN ?14 THEN ?15 ELSE stage END,
               modified_by = COALESCE(?16, modified_by),
               modified_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
             WHERE id = ?1",
            params![
                id,
                patch.title.as_deref().map(str::trim),
                patch.description.is_some(),
                patch.description.clone().flatten(),
                patch.topic_type,
                patch.status,
                patch.priority.is_some(),
                patch.priority.clone().flatten(),
                patch.assignee.is_some(),
                patch.assignee.clone().flatten(),
                patch.due.is_some(),
                patch.due.clone().flatten(),
                labels_json,
                patch.stage.is_some(),
                patch.stage.clone().flatten(),
                patch.modified_by,
            ],
        )?;
        Ok(changed > 0)
    }

    pub fn delete_issue(&self, id: &str) -> Result<bool> {
        Ok(self.conn.execute("DELETE FROM issue WHERE id = ?1", [id])? > 0)
    }

    pub fn issue_elements(&self, issue_id: &str) -> Result<Vec<String>> {
        let mut statement = self.conn.prepare(
            "SELECT element_global_id FROM issue_element WHERE issue_id = ?1 ORDER BY element_global_id",
        )?;
        let rows = statement.query_map([issue_id], |row| row.get(0))?;
        Ok(rows.collect::<rusqlite::Result<_>>()?)
    }

    pub fn set_issue_elements(&self, issue_id: &str, global_ids: &[String]) -> Result<()> {
        let tx = self.conn.unchecked_transaction()?;
        tx.execute("DELETE FROM issue_element WHERE issue_id = ?1", [issue_id])?;
        {
            let mut insert = tx.prepare_cached(
                "INSERT OR IGNORE INTO issue_element (issue_id, element_global_id) VALUES (?1, ?2)",
            )?;
            for global_id in global_ids {
                insert.execute(params![issue_id, global_id])?;
            }
        }
        tx.commit()?;
        Ok(())
    }

    pub fn comments(&self, issue_id: &str) -> Result<Vec<CommentRow>> {
        let mut statement = self.conn.prepare(
            "SELECT id, issue_id, author, text, viewpoint_id, created_at FROM issue_comment
             WHERE issue_id = ?1 ORDER BY created_at, rowid",
        )?;
        let rows = statement.query_map([issue_id], |row| {
            Ok(CommentRow {
                id: row.get(0)?,
                issue_id: row.get(1)?,
                author: row.get(2)?,
                text: row.get(3)?,
                viewpoint_id: row.get(4)?,
                created_at: row.get(5)?,
            })
        })?;
        Ok(rows.collect::<rusqlite::Result<_>>()?)
    }

    pub fn insert_comment(
        &self,
        id: &str,
        issue_id: &str,
        author: &str,
        text: &str,
        viewpoint_id: Option<&str>,
        created_at: Option<&str>,
    ) -> Result<()> {
        self.conn.execute(
            "INSERT INTO issue_comment (id, issue_id, author, text, viewpoint_id, created_at)
             VALUES (?1, ?2, ?3, ?4, ?5, COALESCE(?6, strftime('%Y-%m-%dT%H:%M:%fZ', 'now')))",
            params![id, issue_id, author, text, viewpoint_id, created_at],
        )?;
        Ok(())
    }

    pub fn viewpoints(&self, issue_id: &str) -> Result<Vec<ViewpointRow>> {
        let mut statement = self.conn.prepare(
            "SELECT id, issue_id, guid, camera_json, components_json, lines_json, clipping_json,
                    snapshot IS NOT NULL, created_at
             FROM issue_viewpoint WHERE issue_id = ?1 ORDER BY created_at, rowid",
        )?;
        let rows = statement.query_map([issue_id], |row| {
            Ok(ViewpointRow {
                id: row.get(0)?,
                issue_id: row.get(1)?,
                guid: row.get(2)?,
                camera_json: row.get(3)?,
                components_json: row.get(4)?,
                lines_json: row.get(5)?,
                clipping_json: row.get(6)?,
                has_snapshot: row.get::<_, i64>(7)? != 0,
                created_at: row.get(8)?,
            })
        })?;
        Ok(rows.collect::<rusqlite::Result<_>>()?)
    }

    pub fn insert_viewpoint(&self, viewpoint: &NewViewpoint<'_>) -> Result<()> {
        self.conn.execute(
            "INSERT INTO issue_viewpoint (id, issue_id, guid, camera_json, components_json, lines_json, clipping_json, snapshot)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
            params![
                viewpoint.id,
                viewpoint.issue_id,
                viewpoint.guid,
                viewpoint.camera_json,
                viewpoint.components_json,
                viewpoint.lines_json,
                viewpoint.clipping_json,
                viewpoint.snapshot,
            ],
        )?;
        Ok(())
    }

    pub fn viewpoint_snapshot(&self, id: &str) -> Result<Option<Vec<u8>>> {
        Ok(self
            .conn
            .query_row(
                "SELECT snapshot FROM issue_viewpoint WHERE id = ?1",
                [id],
                |row| row.get(0),
            )
            .optional()?
            .flatten())
    }

    pub fn statuses(&self) -> Result<Vec<StatusRow>> {
        let mut statement = self
            .conn
            .prepare("SELECT element_global_id, stage, set_by, set_at, note FROM element_status")?;
        let rows = statement.query_map([], |row| {
            Ok(StatusRow {
                element_global_id: row.get(0)?,
                stage: row.get(1)?,
                set_by: row.get(2)?,
                set_at: row.get(3)?,
                note: row.get(4)?,
            })
        })?;
        Ok(rows.collect::<rusqlite::Result<_>>()?)
    }

    /// Sets the stage of many elements at once; an unknown stage is refused by the schema.
    pub fn set_status(
        &self,
        global_ids: &[String],
        stage: &str,
        set_by: &str,
        note: Option<&str>,
    ) -> Result<usize> {
        let tx = self.conn.unchecked_transaction()?;
        let mut count = 0;
        {
            let mut upsert = tx.prepare_cached(
                "INSERT INTO element_status (element_global_id, stage, set_by, note)
                 VALUES (?1, ?2, ?3, ?4)
                 ON CONFLICT(element_global_id) DO UPDATE SET
                   stage = excluded.stage, set_by = excluded.set_by, note = excluded.note,
                   set_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')",
            )?;
            for global_id in global_ids {
                count += upsert.execute(params![global_id, stage, set_by, note])?;
            }
        }
        tx.commit()?;
        Ok(count)
    }

    pub fn clear_status(&self, global_ids: &[String]) -> Result<usize> {
        let tx = self.conn.unchecked_transaction()?;
        let mut count = 0;
        {
            let mut delete =
                tx.prepare_cached("DELETE FROM element_status WHERE element_global_id = ?1")?;
            for global_id in global_ids {
                count += delete.execute([global_id])?;
            }
        }
        tx.commit()?;
        Ok(count)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn new_issue(title: &str) -> NewIssue {
        NewIssue {
            title: title.into(),
            created_by: "reviewer".into(),
            labels: vec!["steel".into()],
            ..NewIssue::default()
        }
    }

    #[test]
    fn issues_round_trip_with_counts() {
        let store = Store::open_in_memory().unwrap();
        store
            .insert_issue("i1", "guid-1", &new_issue("Beam clashes with duct"))
            .unwrap();
        store
            .insert_issue("i2", "guid-2", &new_issue("Missing base plate"))
            .unwrap();
        store
            .set_issue_elements("i1", &["gA".into(), "gB".into()])
            .unwrap();
        store
            .insert_comment("c1", "i1", "reviewer", "Please check", None, None)
            .unwrap();
        store
            .insert_viewpoint(&NewViewpoint {
                id: "v1",
                issue_id: "i1",
                guid: "vp-1",
                camera_json: "{}",
                components_json: "{}",
                lines_json: "[]",
                clipping_json: "[]",
                snapshot: Some(&[9, 9]),
            })
            .unwrap();

        let issues = store.issues().unwrap();
        assert_eq!(issues.len(), 2);
        let first = store.issue("i1").unwrap().unwrap();
        assert_eq!(first.idx, Some(1));
        assert_eq!(first.labels, vec!["steel"]);
        assert_eq!(first.status, "open");
        assert_eq!(
            (
                first.comment_count,
                first.viewpoint_count,
                first.element_count
            ),
            (1, 1, 2)
        );
        assert_eq!(store.issue("i2").unwrap().unwrap().idx, Some(2));
        assert_eq!(store.issue_by_guid("guid-2").unwrap().unwrap().id, "i2");
        assert_eq!(store.viewpoint_snapshot("v1").unwrap(), Some(vec![9, 9]));
        assert_eq!(store.issue_elements("i1").unwrap(), vec!["gA", "gB"]);
    }

    #[test]
    fn patch_changes_only_given_fields() {
        let store = Store::open_in_memory().unwrap();
        store.insert_issue("i1", "g", &new_issue("Title")).unwrap();
        let patch = IssuePatch {
            status: Some("closed".into()),
            assignee: Some(Some("maria".into())),
            priority: Some(None),
            modified_by: Some("maria".into()),
            ..IssuePatch::default()
        };
        assert!(store.update_issue("i1", &patch).unwrap());
        let issue = store.issue("i1").unwrap().unwrap();
        assert_eq!(issue.title, "Title");
        assert_eq!(issue.status, "closed");
        assert_eq!(issue.assignee.as_deref(), Some("maria"));
        assert_eq!(issue.priority, None);
        assert_eq!(issue.labels, vec!["steel"]);
        assert!(issue.modified_at.is_some());
        assert!(!store.update_issue("missing", &patch).unwrap());
    }

    #[test]
    fn patch_json_distinguishes_missing_from_null() {
        let patch: IssuePatch =
            serde_json::from_str(r#"{"assignee": null, "status": "closed"}"#).unwrap();
        assert_eq!(patch.assignee, Some(None), "explicit null clears");
        assert_eq!(patch.priority, None, "absent leaves alone");
        assert_eq!(patch.status.as_deref(), Some("closed"));
    }

    #[test]
    fn deleting_an_issue_removes_its_children() {
        let store = Store::open_in_memory().unwrap();
        store.insert_issue("i1", "g", &new_issue("T")).unwrap();
        store.set_issue_elements("i1", &["gA".into()]).unwrap();
        store
            .insert_comment("c1", "i1", "a", "t", None, None)
            .unwrap();
        assert!(store.delete_issue("i1").unwrap());
        assert!(store.comments("i1").unwrap().is_empty());
        assert!(store.issue_elements("i1").unwrap().is_empty());
    }

    #[test]
    fn statuses_upsert_and_reject_unknown_stages() {
        let store = Store::open_in_memory().unwrap();
        let ids = vec!["gA".to_string(), "gB".to_string()];
        assert_eq!(store.set_status(&ids, "designed", "eng", None).unwrap(), 2);
        assert_eq!(
            store
                .set_status(&ids[..1], "checked", "chk", Some("ok"))
                .unwrap(),
            1
        );
        let rows = store.statuses().unwrap();
        assert_eq!(rows.len(), 2);
        assert_eq!(
            rows.iter()
                .find(|r| r.element_global_id == "gA")
                .unwrap()
                .stage,
            "checked"
        );
        assert!(store.set_status(&ids, "built", "x", None).is_err());
        assert_eq!(store.clear_status(&ids).unwrap(), 2);
        assert!(store.statuses().unwrap().is_empty());
    }
}
