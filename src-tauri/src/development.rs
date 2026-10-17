//! Development builds always use an app-owned profile separate from production.
//! Provider CLI homes remain provider-owned; we never copy credentials or history.
use tauri::utils::config::Config;

pub const APP_IDENTIFIER: &str = "com.vrnrn.vorkspace.development";
pub const LINK_SCHEME: &str = "vorkspace-dev";

/// Every webview, including floating windows and bundled debug builds, learns
/// its actual native profile before application JavaScript runs.
pub fn plugin<R: tauri::Runtime>(config: &Config) -> tauri::plugin::TauriPlugin<R> {
    tauri::plugin::Builder::new("development-profile")
        .js_init_script(profile_script(config))
        .build()
}

fn profile_script(config: &Config) -> String {
    format!(
        "Object.defineProperty(globalThis, '__VORKSPACE_DEVELOPMENT__', {{ value: {} }});",
        config.identifier == APP_IDENTIFIER
    )
}

pub fn configure(config: &mut Config) {
    apply_profile(config, cfg!(debug_assertions));
}

fn apply_profile(config: &mut Config, development: bool) {
    if !development {
        return;
    }
    config.identifier = APP_IDENTIFIER.into();
    config.product_name = Some("vorkspace Dev".into());
    config.plugins.0.insert(
        "updater".into(),
        serde_json::json!({ "pubkey": "", "endpoints": [] }),
    );
    config.plugins.0.insert(
        "deep-link".into(),
        serde_json::json!({ "desktop": { "schemes": [LINK_SCHEME] } }),
    );
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn development_identity_and_integrations_are_isolated() {
        let mut config = Config {
            identifier: "com.monocode.desktop".into(),
            ..Config::default()
        };
        config.plugins.0.insert(
            "updater".into(),
            serde_json::json!({"endpoints":["https://example.com/production"]}),
        );
        apply_profile(&mut config, true);
        assert_eq!(config.identifier, APP_IDENTIFIER);
        assert_eq!(config.product_name.as_deref(), Some("vorkspace Dev"));
        assert_eq!(
            config.plugins.0["updater"]["endpoints"],
            serde_json::json!([])
        );
        assert_eq!(
            config.plugins.0["deep-link"]["desktop"]["schemes"],
            serde_json::json!(["vorkspace-dev"])
        );
    }

    #[test]
    fn production_configuration_is_unchanged() {
        let mut config: Config = serde_json::from_str(include_str!("../tauri.conf.json")).unwrap();
        let before = serde_json::to_value(&config).unwrap();
        apply_profile(&mut config, false);
        assert_eq!(serde_json::to_value(config).unwrap(), before);
    }

    #[test]
    fn webview_profile_follows_configured_identity_including_release_mode_development() {
        let production: Config = serde_json::from_str(include_str!("../tauri.conf.json")).unwrap();
        let mut development = production.clone();
        development.identifier = APP_IDENTIFIER.into();
        apply_profile(&mut development, false);
        assert!(profile_script(&development).contains("value: true"));
        assert!(profile_script(&production).contains("value: false"));
    }
}
