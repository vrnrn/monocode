use std::sync::Mutex;
use tauri::{AppHandle, Emitter, Manager, State, WebviewWindow};
use tauri_plugin_deep_link::DeepLinkExt;

#[derive(Default)]
pub struct PendingTicketLinks(Mutex<Vec<String>>);

impl PendingTicketLinks {
    fn append(&self, urls: Vec<url::Url>) {
        if let Ok(mut pending) = self.0.lock() {
            pending.extend(
                urls.into_iter()
                    .filter(|url| {
                        matches!(url.scheme(), "vorkspace" | "monocode")
                            && url.host_str() == Some("context")
                    })
                    .map(String::from),
            );
        }
    }

    fn take(&self) -> Vec<String> {
        self.0
            .lock()
            .map(|mut pending| std::mem::take(&mut *pending))
            .unwrap_or_default()
    }
}

pub fn init(app: &AppHandle) {
    if let Ok(Some(urls)) = app.deep_link().get_current() {
        app.state::<PendingTicketLinks>().append(urls);
    }
    let handle = app.clone();
    app.deep_link().on_open_url(move |event| {
        handle.state::<PendingTicketLinks>().append(event.urls());
        let reveal = handle.clone();
        tauri::async_runtime::spawn_blocking(move || {
            let _ = crate::window::show_hidden_or_open_new(&reveal);
            let _ = reveal.emit("monocode:ticket-context-links", ());
        });
    });
}

/** The queue survives window recreation and is claimed by only one workspace. */
#[tauri::command]
pub fn take_ticket_context_links(
    app: AppHandle,
    window: WebviewWindow,
    pending: State<PendingTicketLinks>,
) -> Vec<String> {
    if crate::window::workspace_windows(&app)
        .first()
        .is_some_and(|primary| primary.label() == window.label())
    {
        pending.take()
    } else {
        Vec::new()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn claims_each_link_once_and_accepts_a_later_repeat() {
        let queue = PendingTicketLinks::default();
        let url = url::Url::parse(
            "monocode://context/jira?url=https%3A%2F%2Fdemo.atlassian.net%2Fbrowse%2FDEMO-42",
        )
        .unwrap();
        queue.append(vec![url.clone()]);
        assert_eq!(queue.take(), vec![url.to_string()]);
        assert!(queue.take().is_empty());
        queue.append(vec![url.clone()]);
        assert_eq!(queue.take(), vec![url.to_string()]);
    }

    #[test]
    fn keeps_links_received_before_a_workspace_opens() {
        let queue = PendingTicketLinks::default();
        queue.append(vec![
            url::Url::parse("https://example.com").unwrap(),
            url::Url::parse("monocode://context/github?url=x").unwrap(),
        ]);
        assert_eq!(queue.take().len(), 1);
    }
}
