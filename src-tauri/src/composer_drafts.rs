//! Local unsent composer state. This is deliberately separate from Block.draft
//! transcript turns, including for remote-backed and not-yet-persisted sessions.

use rusqlite::{params, Connection, OptionalExtension, Transaction, TransactionBehavior};
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager, State};

use crate::session_store::{now_millis, SessionStore};

const MAX_TEXT_BYTES: usize = 8 * 1024 * 1024;
const MAX_PAYLOAD_BYTES: usize = 10 * 1024 * 1024;
const MAX_ITEMS: usize = 128;
const MAX_SAFE_REVISION: u64 = 9_007_199_254_740_991;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ComposerDraftPayload {
    pub cwd: String,
    pub text: String,
    pub selection_start: u32,
    pub selection_end: u32,
    pub attachments: Vec<ComposerDraftAttachment>,
    pub mcp_tags: Vec<ComposerDraftMcpTag>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ComposerDraftAttachment {
    pub id: String,
    pub name: String,
    pub mime_type: String,
    pub kind: ComposerDraftAttachmentKind,
    pub size: u64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub path: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum ComposerDraftAttachmentKind {
    Image,
    Audio,
    File,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ComposerDraftMcpTag {
    pub token: String,
    pub server: ComposerDraftMcpServer,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ComposerDraftMcpServer {
    pub provider: ComposerDraftMcpProvider,
    pub name: String,
    pub scope: ComposerDraftMcpScope,
    pub config_path: String,
    pub transport: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub enabled: Option<bool>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ComposerDraftMcpProvider {
    Claude,
    ClaudeDesktop,
    Codex,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum ComposerDraftMcpScope {
    Local,
    Project,
    User,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ComposerDraftEnvelope {
    pub session_id: String,
    pub revision: u64,
    pub payload: ComposerDraftPayload,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ComposerDraftWrite {
    pub session_id: String,
    pub expected_revision: u64,
    pub payload: ComposerDraftPayload,
}

/// Serializable, recoverable errors: callers must keep their unsaved input.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ComposerDraftError {
    pub code: &'static str,
    pub message: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub current: Option<Box<ComposerDraftEnvelope>>,
}

impl ComposerDraftError {
    fn new(code: &'static str, message: impl Into<String>) -> Self {
        Self {
            code,
            message: message.into(),
            current: None,
        }
    }

    fn storage(error: impl std::fmt::Display) -> Self {
        Self::new(
            "storageUnavailable",
            format!("Composer draft storage is unavailable: {error}"),
        )
    }
}

pub(crate) fn ensure_table(conn: &Connection) -> rusqlite::Result<()> {
    // No session FK: input may predate the first transcript save, and remote
    // session input belongs to this installation rather than the host store.
    conn.execute_batch(
        "CREATE TABLE IF NOT EXISTS composer_drafts (
           session_id TEXT PRIMARY KEY,
           cwd TEXT NOT NULL,
           revision INTEGER NOT NULL CHECK (revision >= 1 AND revision <= 9007199254740991),
           payload_json TEXT NOT NULL,
           deleted INTEGER NOT NULL DEFAULT 0 CHECK (deleted IN (0, 1)),
           updated_at INTEGER NOT NULL
         );",
    )
}

#[tauri::command(async)]
pub fn composer_draft_get(
    store: State<'_, SessionStore>,
    session_id: String,
) -> Result<ComposerDraftEnvelope, ComposerDraftError> {
    let conn = store.lock_conn().map_err(ComposerDraftError::storage)?;
    get_draft(&conn, &session_id)
}

#[tauri::command(async)]
pub fn composer_draft_set(
    store: State<'_, SessionStore>,
    request: ComposerDraftWrite,
) -> Result<ComposerDraftEnvelope, ComposerDraftError> {
    let conn = store.lock_conn().map_err(ComposerDraftError::storage)?;
    set_draft(&conn, &request)
}

/// Clipboard images have no durable file by default. Keep their bytes in
/// private app-owned files; the SQLite payload contains only the returned path.
#[tauri::command]
pub async fn composer_draft_cache_attachment(
    app: AppHandle,
    name: String,
    data: String,
) -> Result<String, String> {
    let root = app
        .path()
        .app_data_dir()
        .map_err(|error| error.to_string())?;
    tauri::async_runtime::spawn_blocking(move || cache_attachment(&root, &name, &data))
        .await
        .map_err(|error| error.to_string())?
}

fn cache_attachment(root: &std::path::Path, name: &str, data: &str) -> Result<String, String> {
    use std::io::Write;
    const MAX_BYTES: usize = 20 * 1024 * 1024;
    if data.len() > MAX_BYTES.div_ceil(3) * 4 {
        return Err("Composer attachment exceeds 20 MiB".into());
    }
    let bytes = base64::Engine::decode(&base64::engine::general_purpose::STANDARD, data)
        .map_err(|_| "Composer attachment is not valid base64")?;
    if bytes.len() > MAX_BYTES {
        return Err("Composer attachment exceeds 20 MiB".into());
    }
    let dir = root.join("composer-attachments");
    std::fs::create_dir_all(&dir).map_err(|error| error.to_string())?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        std::fs::set_permissions(&dir, std::fs::Permissions::from_mode(0o700))
            .map_err(|error| error.to_string())?;
    }
    let basename = name.rsplit(['/', '\\']).next().unwrap_or("attachment");
    let safe: String = basename
        .chars()
        .filter(|character| !character.is_control() && !matches!(character, '/' | '\\' | ':'))
        .scan(0, |bytes, character| {
            *bytes += character.len_utf8();
            (*bytes <= 120).then_some(character)
        })
        .collect();
    let safe = if safe.trim_matches('.').is_empty() {
        "attachment"
    } else {
        &safe
    };
    let path = dir.join(format!("{}-{safe}", uuid::Uuid::new_v4()));
    let mut options = std::fs::OpenOptions::new();
    options.write(true).create_new(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.mode(0o600);
    }
    let saved = options.open(&path).and_then(|mut file| {
        file.write_all(&bytes)?;
        file.sync_all()
    });
    if let Err(error) = saved {
        let _ = std::fs::remove_file(&path);
        return Err(error.to_string());
    }
    Ok(path.to_string_lossy().replace('\\', "/"))
}

fn empty_payload(cwd: String) -> ComposerDraftPayload {
    ComposerDraftPayload {
        cwd,
        text: String::new(),
        selection_start: 0,
        selection_end: 0,
        attachments: Vec::new(),
        mcp_tags: Vec::new(),
    }
}

fn validate_session_id(session_id: &str) -> Result<(), ComposerDraftError> {
    if session_id.is_empty()
        || session_id.len() > 512
        || session_id.trim() != session_id
        || session_id.chars().any(char::is_control)
    {
        return Err(ComposerDraftError::new(
            "invalidDraft",
            "Invalid composer draft sessionId",
        ));
    }
    Ok(())
}

fn field(value: &str, name: &str, max: usize, empty: bool) -> Result<(), ComposerDraftError> {
    if value.len() > max || value.contains('\0') || (!empty && value.trim().is_empty()) {
        return Err(ComposerDraftError::new(
            "invalidDraft",
            format!("Invalid composer draft {name}"),
        ));
    }
    Ok(())
}

fn reference(value: &str, name: &str) -> Result<(), ComposerDraftError> {
    field(value, name, 32 * 1024, false)?;
    let lower = value.trim_start().to_ascii_lowercase();
    if lower.starts_with("data:") || lower.starts_with("blob:") || lower.contains("://") {
        return Err(ComposerDraftError::new(
            "invalidDraft",
            format!("Composer draft {name} must be a filesystem reference"),
        ));
    }
    Ok(())
}

fn validate_payload(payload: &ComposerDraftPayload) -> Result<String, ComposerDraftError> {
    // Desktop remote projects deliberately use remote://<environment>/<path>.
    // This is a context key, not an attachment URL or a request to read bytes.
    if let Some(remote) = payload.cwd.strip_prefix("remote://") {
        field(&payload.cwd, "cwd", 32 * 1024, false)?;
        if remote
            .split_once('/')
            .is_none_or(|(owner, _)| owner.is_empty())
        {
            return Err(ComposerDraftError::new(
                "invalidDraft",
                "Invalid remote composer draft cwd",
            ));
        }
    } else {
        reference(&payload.cwd, "cwd")?;
    }
    if payload.text.len() > MAX_TEXT_BYTES {
        return Err(ComposerDraftError::new(
            "invalidDraft",
            "Composer draft text exceeds 8 MiB",
        ));
    }
    // DOM selectionStart/End count UTF-16 code units, not Rust bytes/scalars.
    let utf16_len = payload.text.encode_utf16().count();
    if payload.selection_start > payload.selection_end || payload.selection_end as usize > utf16_len
    {
        return Err(ComposerDraftError::new(
            "invalidDraft",
            "Composer draft selection is outside its UTF-16 text",
        ));
    }
    if payload.attachments.len() > MAX_ITEMS || payload.mcp_tags.len() > MAX_ITEMS {
        return Err(ComposerDraftError::new(
            "invalidDraft",
            "Composer draft exceeds 128 attachments or MCP tags",
        ));
    }
    let mut attachment_ids = std::collections::HashSet::new();
    for attachment in &payload.attachments {
        field(&attachment.id, "attachment id", 512, false)?;
        field(&attachment.name, "attachment name", 4096, false)?;
        field(&attachment.mime_type, "attachment mimeType", 256, true)?;
        if attachment.size > MAX_SAFE_REVISION || !attachment_ids.insert(&attachment.id) {
            return Err(ComposerDraftError::new(
                "invalidDraft",
                "Invalid composer draft attachment size or duplicate id",
            ));
        }
        if let Some(path) = &attachment.path {
            reference(path, "attachment path")?;
        }
    }
    let mut tokens = std::collections::HashSet::new();
    for tag in &payload.mcp_tags {
        field(&tag.token, "MCP token", 4096, false)?;
        field(&tag.server.name, "MCP name", 4096, false)?;
        // Some provider listings omit the configuration path and transport.
        field(&tag.server.config_path, "MCP configPath", 32 * 1024, true)?;
        field(&tag.server.transport, "MCP transport", 256, true)?;
        if !tag.server.config_path.is_empty() {
            reference(&tag.server.config_path, "MCP configPath")?;
        }
        if !tokens.insert(&tag.token) {
            return Err(ComposerDraftError::new(
                "invalidDraft",
                "Duplicate composer draft MCP token",
            ));
        }
    }
    let raw = serde_json::to_string(payload).map_err(ComposerDraftError::storage)?;
    if raw.len() > MAX_PAYLOAD_BYTES {
        return Err(ComposerDraftError::new(
            "invalidDraft",
            "Composer draft metadata and text exceed 10 MiB",
        ));
    }
    Ok(raw)
}

fn session_scope(
    conn: &Connection,
    session_id: &str,
) -> Result<Option<(String, Option<String>)>, ComposerDraftError> {
    conn.query_row(
        "SELECT cwd, worktree_cwd FROM sessions WHERE id = ?1",
        [session_id],
        |row| Ok((row.get(0)?, row.get(1)?)),
    )
    .optional()
    .map_err(ComposerDraftError::storage)
}

fn validate_scope(
    conn: &Connection,
    session_id: &str,
    cwd: &str,
) -> Result<(), ComposerDraftError> {
    if let Some((project, worktree)) = session_scope(conn, session_id)? {
        if cwd != project && worktree.as_deref() != Some(cwd) {
            return Err(ComposerDraftError::new("scopeMismatch", "Composer draft cwd does not match its session. Keep the input and retry after the session context is saved."));
        }
    }
    Ok(())
}

fn get_draft(
    conn: &Connection,
    session_id: &str,
) -> Result<ComposerDraftEnvelope, ComposerDraftError> {
    validate_session_id(session_id)?;
    let row: Option<(String, i64, String, i64)> = conn.query_row(
        "SELECT cwd, revision, payload_json, deleted FROM composer_drafts WHERE session_id = ?1",
        [session_id], |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?)),
    ).optional().map_err(ComposerDraftError::storage)?;
    if let Some((cwd, revision, raw, deleted)) = row {
        if deleted == 1 {
            return Err(ComposerDraftError::new(
                "sessionDeleted",
                "This session was deleted. Its composer draft cannot be restored or replaced.",
            ));
        }
        let corrupt = || {
            ComposerDraftError::new("corruptDraft", "The stored composer draft is invalid and was preserved for recovery. Keep the current input.")
        };
        if revision < 1
            || revision as u64 > MAX_SAFE_REVISION
            || deleted != 0
            || raw.len() > MAX_PAYLOAD_BYTES
        {
            return Err(corrupt());
        }
        let payload: ComposerDraftPayload = serde_json::from_str(&raw).map_err(|_| corrupt())?;
        if payload.cwd != cwd || validate_payload(&payload).is_err() {
            return Err(corrupt());
        }
        // A session can change cwd before its composer is hydrated. Keep the
        // draft's original context; the next explicit CAS write validates the
        // new context against the current session, never silently rebinding it.
        Ok(ComposerDraftEnvelope {
            session_id: session_id.into(),
            revision: revision as u64,
            payload,
        })
    } else {
        let cwd = session_scope(conn, session_id)?
            .map(|(cwd, _)| cwd)
            .unwrap_or_default();
        Ok(ComposerDraftEnvelope {
            session_id: session_id.into(),
            revision: 0,
            payload: empty_payload(cwd),
        })
    }
}

fn set_draft(
    conn: &Connection,
    request: &ComposerDraftWrite,
) -> Result<ComposerDraftEnvelope, ComposerDraftError> {
    validate_session_id(&request.session_id)?;
    if request.expected_revision > MAX_SAFE_REVISION {
        return Err(ComposerDraftError::new(
            "invalidDraft",
            "Invalid composer draft expectedRevision",
        ));
    }
    let raw = validate_payload(&request.payload)?;
    // IMMEDIATE also serializes independent windows/connections. A deferred
    // read-then-update transaction could fail its lock upgrade under contention.
    let tx = Transaction::new_unchecked(conn, TransactionBehavior::Immediate)
        .map_err(ComposerDraftError::storage)?;
    let current = get_draft(&tx, &request.session_id)?;
    if current.revision != request.expected_revision {
        // Retrying a committed write after a lost response is safe only for the
        // immediately preceding revision and exactly the same typed payload.
        if current.revision == request.expected_revision.saturating_add(1)
            && current.payload == request.payload
        {
            return Ok(current);
        }
        return Err(ComposerDraftError {
            code: "conflict",
            message:
                "A newer composer draft exists. Keep the current input and resolve the conflict."
                    .into(),
            current: Some(Box::new(current)),
        });
    }
    validate_scope(&tx, &request.session_id, &request.payload.cwd)?;
    if current.revision > 0 && current.payload == request.payload {
        return Ok(current);
    }
    let revision = current
        .revision
        .checked_add(1)
        .filter(|revision| *revision <= MAX_SAFE_REVISION)
        .ok_or_else(|| {
            ComposerDraftError::new("invalidDraft", "Composer draft revision is exhausted")
        })?;
    tx.execute(
        "INSERT INTO composer_drafts (session_id, cwd, revision, payload_json, deleted, updated_at)
           VALUES (?1, ?2, ?3, ?4, 0, ?5)
         ON CONFLICT(session_id) DO UPDATE SET cwd = excluded.cwd, revision = excluded.revision,
           payload_json = excluded.payload_json, updated_at = excluded.updated_at",
        params![
            request.session_id,
            request.payload.cwd,
            revision as i64,
            raw,
            now_millis()
        ],
    )
    .map_err(ComposerDraftError::storage)?;
    tx.commit().map_err(ComposerDraftError::storage)?;
    Ok(ComposerDraftEnvelope {
        session_id: request.session_id.clone(),
        revision,
        payload: request.payload.clone(),
    })
}

/// Called inside session deletion's transaction. Keep a permanent identity fence
/// even if there was no row yet: a delayed first autosave must not resurrect it.
pub(crate) fn delete_session_draft(conn: &Connection, session_id: &str) -> rusqlite::Result<()> {
    let row: Option<(String, String)> = conn
        .query_row(
            "SELECT cwd, payload_json FROM composer_drafts WHERE session_id = ?1",
            [session_id],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
        .optional()?;
    if let Some((cwd, raw)) = row {
        let valid = serde_json::from_str::<ComposerDraftPayload>(&raw)
            .ok()
            .filter(|payload| payload.cwd == cwd && validate_payload(payload).is_ok());
        if valid.is_some() {
            let empty =
                serde_json::to_string(&empty_payload(cwd)).expect("draft payload serializes");
            conn.execute("UPDATE composer_drafts SET deleted = 1, payload_json = ?2, updated_at = ?3 WHERE session_id = ?1", params![session_id, empty, now_millis()])?;
        } else {
            // Do not destroy a malformed row even during cleanup: retain its
            // bytes for recovery while denying any future reads/writes to it.
            conn.execute(
                "UPDATE composer_drafts SET deleted = 1, updated_at = ?2 WHERE session_id = ?1",
                params![session_id, now_millis()],
            )?;
        }
    } else {
        let cwd: String = conn
            .query_row(
                "SELECT cwd FROM sessions WHERE id = ?1",
                [session_id],
                |row| row.get(0),
            )
            .optional()?
            .unwrap_or_default();
        let empty =
            serde_json::to_string(&empty_payload(cwd.clone())).expect("draft payload serializes");
        conn.execute("INSERT INTO composer_drafts (session_id, cwd, revision, payload_json, deleted, updated_at) VALUES (?1, ?2, 1, ?3, 1, ?4)", params![session_id, cwd, empty, now_millis()])?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    use std::path::PathBuf;
    use std::sync::{Arc, Barrier};

    struct Database(PathBuf);

    impl Database {
        fn new() -> Self {
            Self(std::env::temp_dir().join(format!("composer-drafts-{}.db", uuid::Uuid::new_v4())))
        }

        fn open(&self) -> SessionStore {
            SessionStore::open(self.0.clone()).unwrap()
        }
    }

    impl Drop for Database {
        fn drop(&mut self) {
            let _ = std::fs::remove_file(&self.0);
            let _ = std::fs::remove_file(self.0.with_extension("db-wal"));
            let _ = std::fs::remove_file(self.0.with_extension("db-shm"));
        }
    }

    fn payload(text: &str) -> ComposerDraftPayload {
        ComposerDraftPayload {
            text: text.into(),
            selection_start: text.encode_utf16().count() as u32,
            selection_end: text.encode_utf16().count() as u32,
            ..empty_payload("/projects/example".into())
        }
    }

    fn write(
        session_id: &str,
        expected_revision: u64,
        payload: ComposerDraftPayload,
    ) -> ComposerDraftWrite {
        ComposerDraftWrite {
            session_id: session_id.into(),
            expected_revision,
            payload,
        }
    }

    #[test]
    fn composer_draft_cached_clipboard_bytes_survive_reopen_privately() {
        let directory =
            std::env::temp_dir().join(format!("composer-attachment-{}", uuid::Uuid::new_v4()));
        let path = cache_attachment(&directory, "../../pasted-照片.png", "aGVsbG8=").unwrap();
        assert!(std::path::Path::new(&path).starts_with(directory.join("composer-attachments")));
        assert_eq!(std::fs::read(&path).unwrap(), b"hello");
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            assert_eq!(
                std::fs::metadata(&path).unwrap().permissions().mode() & 0o777,
                0o600
            );
            assert_eq!(
                std::fs::metadata(directory.join("composer-attachments"))
                    .unwrap()
                    .permissions()
                    .mode()
                    & 0o777,
                0o700
            );
        }
        assert!(cache_attachment(&directory, "bad", "not-base64").is_err());
        assert!(cache_attachment(&directory, "large", &"x".repeat(28 * 1024 * 1024)).is_err());
        std::fs::remove_dir_all(directory).unwrap();
    }

    #[test]
    fn composer_draft_missing_unsaved_or_remote_identity_is_empty() {
        let store = SessionStore::open_in_memory().unwrap();
        let conn = store.lock_conn().unwrap();
        for id in ["unsaved-local", "remote:host:session"] {
            let draft = get_draft(&conn, id).unwrap();
            assert_eq!(draft.revision, 0);
            assert_eq!(draft.session_id, id);
            assert_eq!(draft.payload, empty_payload(String::new()));
            assert_eq!(
                set_draft(&conn, &write(id, 0, payload("input")))
                    .unwrap()
                    .revision,
                1
            );
        }
        for id in ["", " trailing", "line\nbreak"] {
            assert_eq!(get_draft(&conn, id).unwrap_err().code, "invalidDraft");
        }
    }

    #[test]
    fn composer_draft_exact_unicode_selection_and_ordered_metadata_survive_reopen() {
        let database = Database::new();
        let mut expected = payload("before 👩🏽‍💻\ne\u{301} 中文\r\nafter");
        expected.selection_start = 7;
        expected.selection_end = 14;
        expected.attachments = serde_json::from_value(json!([
            {"id":"second","name":"照片.png","mimeType":"image/png","kind":"image","size":42,"path":"/projects/example/照片.png"},
            {"id":"first","name":"notes.txt","mimeType":"text/plain","kind":"file","size":12,"path":"C:\\work\\notes.txt"},
            {"id":"missing","name":"clipboard.png","mimeType":"image/png","kind":"image","size":20}
        ])).unwrap();
        expected.mcp_tags = serde_json::from_value(json!([
            {"token":"@mcp/工具","server":{"provider":"claude_desktop","name":"工具","scope":"user","configPath":"/config/desktop.json","transport":"stdio","enabled":false}},
            {"token":"@mcp/project","server":{"provider":"codex","name":"project","scope":"project","configPath":"","transport":""}}
        ])).unwrap();
        let committed;
        {
            let store = database.open();
            let conn = store.lock_conn().unwrap();
            committed =
                set_draft(&conn, &write("remote:host:session", 0, expected.clone())).unwrap();
        }
        let reopened = database.open();
        let conn = reopened.lock_conn().unwrap();
        let restored = get_draft(&conn, "remote:host:session").unwrap();
        assert_eq!(restored, committed);
        assert_eq!(restored.payload, expected);
        assert_eq!(restored.revision, 1);
    }

    #[test]
    fn composer_draft_utf16_offsets_are_not_byte_or_scalar_counts() {
        let store = SessionStore::open_in_memory().unwrap();
        let conn = store.lock_conn().unwrap();
        let mut draft = payload("A😀中");
        assert_eq!(draft.selection_end, 4);
        assert!(set_draft(&conn, &write("unicode", 0, draft.clone())).is_ok());
        // DOM APIs can place a selection between surrogate code units. Keep
        // the exact offset rather than snapping it to a Rust char boundary.
        draft.selection_start = 2;
        draft.selection_end = 2;
        assert!(set_draft(&conn, &write("unicode", 1, draft.clone())).is_ok());
        for (start, end) in [(0, 5), (3, 2)] {
            draft.selection_start = start;
            draft.selection_end = end;
            assert_eq!(
                set_draft(&conn, &write("unicode", 2, draft.clone()))
                    .unwrap_err()
                    .code,
                "invalidDraft"
            );
        }
        assert_eq!(get_draft(&conn, "unicode").unwrap().revision, 2);
    }

    #[test]
    fn composer_draft_duplicate_retry_and_matching_noop_are_idempotent() {
        let store = SessionStore::open_in_memory().unwrap();
        let conn = store.lock_conn().unwrap();
        let request = write("retry", 0, payload("one"));
        let committed = set_draft(&conn, &request).unwrap();
        assert_eq!(set_draft(&conn, &request).unwrap(), committed);
        assert_eq!(
            set_draft(&conn, &write("retry", 1, request.payload)).unwrap(),
            committed
        );
        assert_eq!(
            set_draft(&conn, &write("retry", 0, payload("different")))
                .unwrap_err()
                .code,
            "conflict"
        );
    }

    #[test]
    fn composer_draft_two_connections_cannot_overwrite_a_newer_revision() {
        let database = Database::new();
        let first = database.open();
        let second = database.open();
        let barrier = Arc::new(Barrier::new(2));
        let handles: Vec<_> = [first, second]
            .into_iter()
            .enumerate()
            .map(|(index, store)| {
                let barrier = Arc::clone(&barrier);
                std::thread::spawn(move || {
                    let conn = store.lock_conn().unwrap();
                    conn.busy_timeout(std::time::Duration::from_secs(5))
                        .unwrap();
                    assert_eq!(get_draft(&conn, "two-windows").unwrap().revision, 0);
                    barrier.wait();
                    set_draft(
                        &conn,
                        &write("two-windows", 0, payload(&format!("window-{index}"))),
                    )
                })
            })
            .collect();
        let results: Vec<_> = handles
            .into_iter()
            .map(|handle| handle.join().unwrap())
            .collect();
        assert_eq!(results.iter().filter(|result| result.is_ok()).count(), 1);
        let conflict = results
            .iter()
            .find_map(|result| result.as_ref().err())
            .unwrap();
        assert_eq!(conflict.code, "conflict");
        let winner = results
            .iter()
            .find_map(|result| result.as_ref().ok())
            .unwrap();
        assert_eq!(conflict.current.as_deref().unwrap(), winner);
        let reopened = database.open();
        assert_eq!(
            get_draft(&reopened.lock_conn().unwrap(), "two-windows").unwrap(),
            *winner
        );
    }

    #[test]
    fn composer_draft_clear_tombstone_defeats_delayed_write_after_reopen() {
        let database = Database::new();
        {
            let store = database.open();
            let conn = store.lock_conn().unwrap();
            let first = set_draft(&conn, &write("clear", 0, payload("send this"))).unwrap();
            let cleared = set_draft(
                &conn,
                &write("clear", first.revision, empty_payload(first.payload.cwd)),
            )
            .unwrap();
            assert_eq!(cleared.revision, 2);
            // Clearing an untouched composer also creates a revision fence.
            assert_eq!(
                set_draft(&conn, &write("never-saved", 0, payload("")))
                    .unwrap()
                    .revision,
                1
            );
        }
        let store = database.open();
        let conn = store.lock_conn().unwrap();
        for expected in [0, 1] {
            let failure = set_draft(
                &conn,
                &write("clear", expected, payload("old delayed text")),
            )
            .unwrap_err();
            assert_eq!(failure.code, "conflict");
            assert_eq!(failure.current.unwrap().revision, 2);
        }
        assert!(get_draft(&conn, "clear").unwrap().payload.text.is_empty());
    }

    #[test]
    fn composer_draft_cwd_changes_require_cas_and_current_session_scope() {
        let store = SessionStore::open_in_memory().unwrap();
        let conn = store.lock_conn().unwrap();
        conn.execute("INSERT INTO sessions (id,cwd,worktree_cwd,harness,model,runtime_mode,title,created_at,updated_at) VALUES ('scoped','/projects/example','/worktrees/example','codex','test','supervised','Example',1,1)", []).unwrap();
        assert_eq!(
            get_draft(&conn, "scoped").unwrap().payload.cwd,
            "/projects/example"
        );
        set_draft(&conn, &write("scoped", 0, payload("draft"))).unwrap();
        let mut changed = payload("worktree");
        changed.cwd = "/worktrees/example".into();
        set_draft(&conn, &write("scoped", 1, changed.clone())).unwrap();
        changed.cwd = "/unrelated".into();
        assert_eq!(
            set_draft(&conn, &write("scoped", 2, changed))
                .unwrap_err()
                .code,
            "scopeMismatch"
        );
        conn.execute(
            "UPDATE sessions SET cwd = '/moved', worktree_cwd = NULL WHERE id = 'scoped'",
            [],
        )
        .unwrap();
        // Hydration retains the old saved context for an explicit frontend
        // decision; a matching CAS may then save the new session context.
        assert_eq!(
            get_draft(&conn, "scoped").unwrap().payload.cwd,
            "/worktrees/example"
        );
        let mut moved = payload("moved");
        moved.cwd = "/moved".into();
        assert_eq!(
            set_draft(&conn, &write("scoped", 2, moved))
                .unwrap()
                .revision,
            3
        );
    }

    #[test]
    fn composer_draft_malformed_rows_are_never_overwritten() {
        let store = SessionStore::open_in_memory().unwrap();
        let conn = store.lock_conn().unwrap();
        let mut cases = vec!["{broken".to_string()];
        let mut extra = serde_json::to_value(payload("recover me")).unwrap();
        extra["data"] = json!("bytes");
        cases.push(extra.to_string());
        let mut wrong_cwd = payload("recover me");
        wrong_cwd.cwd = "/different".into();
        cases.push(serde_json::to_string(&wrong_cwd).unwrap());
        let mut invalid_selection = payload("😀");
        invalid_selection.selection_end = 3;
        cases.push(serde_json::to_string(&invalid_selection).unwrap());
        for (index, raw) in cases.into_iter().enumerate() {
            let id = format!("corrupt-{index}");
            conn.execute("INSERT INTO composer_drafts (session_id,cwd,revision,payload_json,updated_at) VALUES (?1,'/projects/example',7,?2,1)", params![id, raw]).unwrap();
            assert_eq!(get_draft(&conn, &id).unwrap_err().code, "corruptDraft");
            assert_eq!(
                set_draft(&conn, &write(&id, 7, payload("replacement")))
                    .unwrap_err()
                    .code,
                "corruptDraft"
            );
            let preserved: (String, i64) = conn
                .query_row(
                    "SELECT payload_json,revision FROM composer_drafts WHERE session_id = ?1",
                    [&id],
                    |row| Ok((row.get(0)?, row.get(1)?)),
                )
                .unwrap();
            assert_eq!(preserved, (raw, 7));
        }
    }

    #[test]
    fn composer_draft_validation_limits_and_metadata_only_contract() {
        let store = SessionStore::open_in_memory().unwrap();
        let conn = store.lock_conn().unwrap();
        let mut too_long = payload("");
        too_long.text = "x".repeat(MAX_TEXT_BYTES + 1);
        let mut too_many = payload("");
        too_many.attachments = (0..=MAX_ITEMS)
            .map(|index| ComposerDraftAttachment {
                id: index.to_string(),
                name: "a".into(),
                mime_type: "".into(),
                kind: ComposerDraftAttachmentKind::File,
                size: 0,
                path: None,
            })
            .collect();
        let mut too_large_aggregate = payload("");
        too_large_aggregate.text = "\0".repeat(2 * 1024 * 1024);
        for invalid in [too_long, too_many, too_large_aggregate] {
            assert_eq!(
                set_draft(&conn, &write("limits", 0, invalid))
                    .unwrap_err()
                    .code,
                "invalidDraft"
            );
        }
        assert_eq!(get_draft(&conn, "limits").unwrap().revision, 0);
        let attachment = json!({"id":"file","name":"image","kind":"image","mimeType":"image/png","size":1,"path":"/image.png"});
        for forbidden in ["data", "previewUrl", "copyFromPath"] {
            let mut metadata = attachment.clone();
            metadata[forbidden] = json!("must not persist");
            assert!(serde_json::from_value::<ComposerDraftAttachment>(metadata).is_err());
        }
        for path in [
            "data:image/png;base64,AAAA",
            "blob:https://example.com/id",
            "https://example.com/image",
        ] {
            let mut draft = payload("");
            let mut metadata = attachment.clone();
            metadata["path"] = json!(path);
            draft
                .attachments
                .push(serde_json::from_value(metadata).unwrap());
            assert_eq!(
                set_draft(&conn, &write("limits", 0, draft))
                    .unwrap_err()
                    .code,
                "invalidDraft"
            );
        }
        let mut remote = payload("Remote input");
        remote.cwd = "remote://machine/home/user/project".into();
        let saved = set_draft(&conn, &write("remote-owner", 0, remote.clone())).unwrap();
        assert_eq!(saved.payload, remote);
        assert_eq!(get_draft(&conn, "remote-owner").unwrap(), saved);
    }

    #[test]
    fn composer_draft_deletion_fences_existing_and_never_saved_inputs() {
        let store = SessionStore::open_in_memory().unwrap();
        let conn = store.lock_conn().unwrap();
        set_draft(&conn, &write("existing", 0, payload("remove me"))).unwrap();
        for id in ["existing", "never-saved"] {
            delete_session_draft(&conn, id).unwrap();
            delete_session_draft(&conn, id).unwrap();
            for expected in [0, 1] {
                assert_eq!(
                    set_draft(&conn, &write(id, expected, payload("delayed")))
                        .unwrap_err()
                        .code,
                    "sessionDeleted"
                );
            }
            assert_eq!(get_draft(&conn, id).unwrap_err().code, "sessionDeleted");
            let raw: String = conn
                .query_row(
                    "SELECT payload_json FROM composer_drafts WHERE session_id = ?1",
                    [id],
                    |row| row.get(0),
                )
                .unwrap();
            assert!(serde_json::from_str::<ComposerDraftPayload>(&raw)
                .unwrap()
                .text
                .is_empty());
        }
    }

    #[test]
    fn composer_draft_deletion_preserves_malformed_raw_payload() {
        let store = SessionStore::open_in_memory().unwrap();
        let conn = store.lock_conn().unwrap();
        conn.execute("INSERT INTO composer_drafts (session_id,cwd,revision,payload_json,updated_at) VALUES ('corrupt','/projects/example',7,'{broken',1)", []).unwrap();
        delete_session_draft(&conn, "corrupt").unwrap();
        let raw: String = conn
            .query_row(
                "SELECT payload_json FROM composer_drafts WHERE session_id = 'corrupt'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(raw, "{broken");
        assert_eq!(
            set_draft(&conn, &write("corrupt", 7, payload("replace")))
                .unwrap_err()
                .code,
            "sessionDeleted"
        );
    }
}
