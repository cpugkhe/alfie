mod commands;
pub mod git;
pub mod profiles;
mod session;
mod watcher;

use tauri::menu::{MenuBuilder, MenuItemBuilder, SubmenuBuilder};
use tauri::{Emitter, Manager};

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .manage(watcher::Watchers::default())
        .setup(|app| {
            if let Ok(dir) = app.path().app_config_dir() {
                profiles::init(dir);
            }
            // Own menu: the default one binds ⌘W to "close window", which
            // must close a tab instead. Edit items keep copy/paste working.
            let app_menu = SubmenuBuilder::new(app, "Alfie")
                .about(None)
                .separator()
                .hide()
                .hide_others()
                .show_all()
                .separator()
                .quit()
                .build()?;
            // Undo/redo are our own items: the page decides whether they act
            // on a text field or on the last git operation.
            let undo = MenuItemBuilder::with_id("undo", "Undo")
                .accelerator("CmdOrCtrl+Z")
                .build(app)?;
            let redo = MenuItemBuilder::with_id("redo", "Redo")
                .accelerator("CmdOrCtrl+Shift+Z")
                .build(app)?;
            let edit_menu = SubmenuBuilder::new(app, "Edit")
                .item(&undo)
                .item(&redo)
                .separator()
                .cut()
                .copy()
                .paste()
                .select_all()
                .build()?;
            let window_menu = SubmenuBuilder::new(app, "Window")
                .minimize()
                .fullscreen()
                .build()?;
            let menu = MenuBuilder::new(app)
                .items(&[&app_menu, &edit_menu, &window_menu])
                .build()?;
            app.set_menu(menu)?;
            app.on_menu_event(|app, event| {
                let id = event.id().as_ref();
                if id == "undo" || id == "redo" {
                    let _ = app.emit("menu", id);
                }
            });
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::session_load,
            commands::session_save,
            commands::repo_open,
            commands::repo_status,
            commands::repo_refs,
            commands::repo_log,
            commands::commit_detail,
            commands::diff_file,
            commands::watch_repo,
            commands::unwatch_repo,
            commands::git_log,
            commands::update_branch,
            commands::repo_base,
            commands::update_from_base,
            commands::delete_remote_tag,
            commands::merge,
            commands::rebase,
            commands::pick,
            commands::sequence,
            commands::create_tag,
            commands::delete_tag,
            commands::push_tag,
            commands::stash_rename,
            commands::reset,
            commands::repo_remote,
            commands::profiles_load,
            commands::profiles_save,
            commands::profile_for,
            commands::profile_test,
            commands::clone_repo,
            commands::stage,
            commands::unstage,
            commands::stage_all,
            commands::unstage_all,
            commands::discard,
            commands::apply_hunk,
            commands::commit,
            commands::last_message,
            commands::checkout,
            commands::checkout_remote,
            commands::push_branch,
            commands::delete_remote_branch,
            commands::create_branch,
            commands::delete_branch,
            commands::rename_branch,
            commands::stash_push,
            commands::stash_action,
            commands::fetch,
            commands::pull,
            commands::push,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
