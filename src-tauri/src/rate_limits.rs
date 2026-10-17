use std::path::PathBuf;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use serde::Serialize;
use serde_json::Value;
#[cfg(target_os = "macos")]
use sha2::{Digest, Sha256};
use tauri::{AppHandle, State};
#[cfg(target_os = "macos")]
use unicode_normalization::UnicodeNormalization;

use crate::dirs_home;

const OAUTH_USAGE_URL: &str = "https://api.anthropic.com/api/oauth/usage";
const OAUTH_BETA: &str = "oauth-2025-04-20";
const USER_AGENT: &str = "claude-code/2.1.0";
const HTTP_TIMEOUT: Duration = Duration::from_secs(10);

#[cfg(target_os = "macos")]
const KEYCHAIN_TIMEOUT: Duration = Duration::from_secs(5);
#[cfg(target_os = "macos")]
const LEGACY_KEYCHAIN_SERVICE: &str = "Claude Code-credentials";
#[cfg(target_os = "macos")]
const KEYCHAIN_FALLBACK_USER: &str = "claude-code-user";

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ClaudeUsageFetch {
    pub status: String,
    pub http_status: Option<u16>,
    pub body: Option<String>,
    pub error: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub auth_provider: Option<String>,
}

struct ClaudeCredentials {
    access_token: String,
    expires_at_ms: Option<i64>,
}

fn usage_result(
    status: &str,
    http_status: Option<u16>,
    body: Option<String>,
    error: Option<String>,
) -> ClaudeUsageFetch {
    ClaudeUsageFetch {
        status: status.into(),
        http_status,
        body,
        error,
        auth_provider: None,
    }
}

/// Fetch Claude Code 5-hour / weekly usage via the local OAuth token.
/// The token never leaves the host process.
#[tauri::command]
pub async fn fetch_claude_usage(
    app: AppHandle,
    host: State<'_, crate::harness::HarnessHost>,
    account_id: Option<String>,
) -> Result<ClaudeUsageFetch, String> {
    let config_dir = crate::harness::provider_account_dir(&app, "claude", account_id.as_deref())?;
    let binary_path = host.runtime_binary_path("claude");
    tauri::async_runtime::spawn_blocking(move || fetch_claude_usage_sync(config_dir, binary_path))
        .await
        .map_err(|e| e.to_string())?
}

fn fetch_claude_usage_sync(
    config_dir: Option<PathBuf>,
    binary_path: Option<String>,
) -> Result<ClaudeUsageFetch, String> {
    if crate::harness::claude_auth_provider(config_dir.as_deref(), binary_path.as_deref())
        .as_deref()
        == Some("bedrock")
    {
        let mut result = usage_result("ok", None, None, None);
        result.auth_provider = Some("bedrock".into());
        return Ok(result);
    }
    let Some(creds) = read_claude_credentials(config_dir.as_deref()) else {
        return Ok(usage_result(
            "unavailable",
            None,
            None,
            Some("Claude not signed in".into()),
        ));
    };

    // Claude Code owns this credential and rotates its refresh token. The
    // usage footer must remain read-only: independently refreshing here can
    // race a live CLI (or another vorkspace window) and leave one process with
    // a spent refresh token, which forces the user through sign-in again.
    if token_expired(creds.expires_at_ms, now_ms()) {
        return Ok(usage_error(401));
    }

    Ok(fetch_usage_with_token(&creds.access_token))
}

fn fetch_usage_with_token(token: &str) -> ClaudeUsageFetch {
    let agent = ureq::AgentBuilder::new().timeout(HTTP_TIMEOUT).build();
    let result = agent
        .get(OAUTH_USAGE_URL)
        .set("Authorization", &format!("Bearer {token}"))
        .set("anthropic-beta", OAUTH_BETA)
        .set("User-Agent", USER_AGENT)
        .call();

    match result {
        Ok(response) => {
            let http_status = response.status();
            let body = response.into_string().unwrap_or_default();
            if (200..300).contains(&http_status) {
                usage_result("ok", Some(http_status), Some(body), None)
            } else {
                usage_error(http_status)
            }
        }
        Err(ureq::Error::Status(status, response)) => {
            let _ = response.into_string();
            usage_error(status)
        }
        Err(error) => usage_result(
            "error",
            None,
            None,
            Some(format!("Claude usage request failed: {error}")),
        ),
    }
}

fn usage_error(status: u16) -> ClaudeUsageFetch {
    let message = if status == 401 {
        "Claude sign-in expired".into()
    } else if status == 403 {
        "Claude usage is unavailable for this account".into()
    } else {
        format!("Claude usage request failed ({status})")
    };
    usage_result("error", Some(status), None, Some(message))
}

fn read_claude_credentials(config_dir: Option<&std::path::Path>) -> Option<ClaudeCredentials> {
    #[cfg(target_os = "macos")]
    {
        let service = claude_keychain_service(config_dir);
        if let Some(creds) = read_macos_keychain_credentials(&service) {
            return Some(creds);
        }
    }
    read_credentials_file(config_dir)
}

fn read_credentials_file(config_dir: Option<&std::path::Path>) -> Option<ClaudeCredentials> {
    let path = claude_credentials_path(config_dir)?;
    let raw = std::fs::read_to_string(&path).ok()?;
    credentials_from_blob(&raw)
}

fn claude_credentials_path(config_dir: Option<&std::path::Path>) -> Option<PathBuf> {
    if let Some(dir) = config_dir {
        return Some(dir.join(".credentials.json"));
    }
    let home = dirs_home().or_else(|| {
        std::env::var_os("USERPROFILE").map(|value| value.to_string_lossy().into_owned())
    })?;
    Some(PathBuf::from(home).join(".claude/.credentials.json"))
}

fn credentials_from_blob(raw: &str) -> Option<ClaudeCredentials> {
    let blob: Value = serde_json::from_str(raw.trim()).ok()?;
    let access_token = extract_access_token(raw)?;
    Some(ClaudeCredentials {
        access_token,
        expires_at_ms: oauth_expires_at_ms(&blob),
    })
}

pub(crate) fn extract_access_token(raw: &str) -> Option<String> {
    let value: Value = serde_json::from_str(raw.trim()).ok()?;
    let token = value
        .get("claudeAiOauth")
        .and_then(|oauth| oauth.get("accessToken"))
        .or_else(|| value.get("accessToken"))
        .and_then(Value::as_str)?
        .trim();
    if token.is_empty() {
        None
    } else {
        Some(token.to_string())
    }
}

fn oauth_expires_at_ms(blob: &Value) -> Option<i64> {
    let value = blob
        .get("claudeAiOauth")
        .and_then(|oauth| oauth.get("expiresAt"))
        .or_else(|| blob.get("expiresAt"))?;
    match value {
        Value::Number(number) => number.as_i64().or_else(|| {
            number.as_f64().and_then(|float| {
                if float.is_finite() {
                    Some(float as i64)
                } else {
                    None
                }
            })
        }),
        Value::String(text) => text.trim().parse().ok(),
        _ => None,
    }
}

/// An unknown expiry is treated as usable: the usage request itself will 401
/// if it is not, which produces the same user-facing result without mutating
/// credentials owned by another process.
pub(crate) fn token_expired(expires_at_ms: Option<i64>, now_ms: i64) -> bool {
    expires_at_ms.is_some_and(|expires| now_ms >= expires)
}

fn now_ms() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis() as i64)
        .unwrap_or(0)
}

#[cfg(target_os = "macos")]
fn read_macos_keychain_credentials(service: &str) -> Option<ClaudeCredentials> {
    let candidates = [
        {
            let mut args = keychain_find_args(service);
            args.push("-w".into());
            args
        },
        {
            let mut args = keychain_find_args(service);
            args.extend(["-a".into(), keychain_user(), "-w".into()]);
            args
        },
        {
            let mut args = keychain_find_args(service);
            args.extend(["-a".into(), KEYCHAIN_FALLBACK_USER.into(), "-w".into()]);
            args
        },
    ];
    for args in candidates {
        if let Some(secret) = security_output(&args) {
            if let Some(creds) = credentials_from_blob(&secret) {
                return Some(creds);
            }
        }
    }
    None
}

#[cfg(target_os = "macos")]
fn keychain_find_args(service: &str) -> Vec<String> {
    vec!["find-generic-password".into(), "-s".into(), service.into()]
}

#[cfg(target_os = "macos")]
fn claude_keychain_service(config_dir: Option<&std::path::Path>) -> String {
    let Some(config_dir) = config_dir else {
        return LEGACY_KEYCHAIN_SERVICE.into();
    };
    // Claude Code hashes the exact, NFC-normalized selector string and uses
    // the first eight lowercase hex characters as its Keychain service suffix.
    let selector: String = config_dir.to_string_lossy().nfc().collect();
    let digest = Sha256::digest(selector.as_bytes());
    let suffix = format!("{digest:x}");
    format!("{LEGACY_KEYCHAIN_SERVICE}-{}", &suffix[..8])
}

#[cfg(target_os = "macos")]
pub(crate) fn delete_claude_keychain_credentials(
    config_dir: &std::path::Path,
) -> Result<(), String> {
    let service = claude_keychain_service(Some(config_dir));
    let args = vec![
        "delete-generic-password".into(),
        "-s".into(),
        service.clone(),
    ];
    security_delete(&args).map_err(|error| {
        format!("Could not remove the Claude credentials from Keychain ({service}): {error}")
    })
}

#[cfg(target_os = "macos")]
fn keychain_user() -> String {
    let user = std::env::var("USER")
        .or_else(|_| std::env::var("USERNAME"))
        .unwrap_or_default();
    if user
        .chars()
        .all(|ch| ch.is_ascii_alphanumeric() || matches!(ch, '.' | '_' | '-'))
        && !user.is_empty()
    {
        user
    } else {
        KEYCHAIN_FALLBACK_USER.into()
    }
}

#[cfg(target_os = "macos")]
fn security_output(args: &[String]) -> Option<String> {
    security_run(args)
}

#[cfg(target_os = "macos")]
fn security_run(args: &[String]) -> Option<String> {
    use std::process::{Command, Stdio};
    let mut cmd = Command::new("security");
    cmd.args(args)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::null());
    run_with_timeout(&mut cmd, KEYCHAIN_TIMEOUT)
}

#[cfg(target_os = "macos")]
fn security_delete(args: &[String]) -> Result<(), String> {
    use std::io::Read;
    use std::process::{Command, Stdio};
    use std::time::Instant;

    let mut child = Command::new("security")
        .args(args)
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|error| error.to_string())?;
    let started = Instant::now();
    loop {
        match child.try_wait() {
            Ok(Some(status)) => {
                let mut error = String::new();
                if let Some(mut stderr) = child.stderr.take() {
                    let _ = stderr.read_to_string(&mut error);
                }
                if status.success()
                    || error.contains("could not be found")
                    || error.contains("specified item could not be found")
                {
                    return Ok(());
                }
                let detail = error.trim();
                return Err(if detail.is_empty() {
                    format!("security exited with {status}")
                } else {
                    detail.to_string()
                });
            }
            Ok(None) if started.elapsed() < KEYCHAIN_TIMEOUT => {
                std::thread::sleep(Duration::from_millis(25));
            }
            Ok(None) => {
                let _ = child.kill();
                let _ = child.wait();
                return Err("security timed out".into());
            }
            Err(error) => return Err(error.to_string()),
        }
    }
}

#[cfg(target_os = "macos")]
fn run_with_timeout(cmd: &mut std::process::Command, timeout: Duration) -> Option<String> {
    use std::io::Read;
    use std::time::Instant;
    let mut child = cmd.spawn().ok()?;
    let started = Instant::now();
    loop {
        match child.try_wait() {
            Ok(Some(status)) => {
                if !status.success() {
                    return None;
                }
                let mut stdout = child.stdout.take()?;
                let mut out = String::new();
                stdout.read_to_string(&mut out).ok()?;
                let trimmed = out.trim();
                if trimmed.is_empty() {
                    return None;
                }
                return Some(trimmed.to_string());
            }
            Ok(None) if started.elapsed() > timeout => {
                let _ = child.kill();
                let _ = child.wait();
                return None;
            }
            Ok(None) => std::thread::sleep(Duration::from_millis(40)),
            Err(_) => return None,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn extract_access_token_from_claude_credentials() {
        let raw = r#"{"claudeAiOauth":{"accessToken":"sk-ant-oat-abc","refreshToken":"r"}}"#;
        assert_eq!(extract_access_token(raw).as_deref(), Some("sk-ant-oat-abc"));
    }

    #[test]
    fn extract_access_token_from_flat_object() {
        assert_eq!(
            extract_access_token(r#"{"accessToken":"token-1"}"#).as_deref(),
            Some("token-1")
        );
    }

    #[test]
    fn extract_access_token_rejects_empty() {
        assert_eq!(
            extract_access_token(r#"{"claudeAiOauth":{"accessToken":"  "}}"#),
            None
        );
        assert_eq!(extract_access_token("not json"), None);
    }

    #[test]
    fn token_expired_uses_actual_expiry() {
        let now = 1_000_000;
        assert!(!token_expired(Some(now + 1), now));
        assert!(token_expired(Some(now), now));
        assert!(token_expired(Some(now - 1), now));
        assert!(!token_expired(None, now));
    }

    #[cfg(target_os = "macos")]
    #[test]
    fn custom_config_dir_selects_claudes_hashed_keychain_service() {
        assert_eq!(
            claude_keychain_service(Some(std::path::Path::new("/tmp/profile"))),
            "Claude Code-credentials-902e721c"
        );
        assert_eq!(claude_keychain_service(None), "Claude Code-credentials");
    }
}
