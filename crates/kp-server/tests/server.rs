//! The server, run for real on a local port, with project copies syncing through it
//! using the desktop's own client.

use kp_sync::{
    SyncError, SyncReport,
    server::{ServerClient, ServerRemote},
    testing::{Copy, copy},
};

const PROJECT: &str = "42d884a8-d22c-47d0-860b-6597a3eb2e49";

struct Server {
    url: String,
    _data: tempfile::TempDir,
}

fn start(open_signup: bool) -> Server {
    let data = tempfile::tempdir().unwrap();
    let state = kp_server::AppState::open(data.path(), open_signup).unwrap();
    let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
    let address = listener.local_addr().unwrap();
    listener.set_nonblocking(true).unwrap();
    std::thread::spawn(move || {
        let runtime = tokio::runtime::Builder::new_multi_thread()
            .worker_threads(2)
            .enable_all()
            .build()
            .unwrap();
        runtime.block_on(async move {
            let listener = tokio::net::TcpListener::from_std(listener).unwrap();
            kp_server::serve(listener, state, None, std::future::pending())
                .await
                .unwrap();
        });
    });
    Server {
        url: format!("http://{address}"),
        _data: data,
    }
}

fn client(server: &Server) -> ServerClient {
    ServerClient::new(&server.url, None).unwrap()
}

fn signed_in(server: &Server, token: &str) -> ServerClient {
    ServerClient::new(&server.url, Some(token)).unwrap()
}

fn sync(server: &Server, token: &str, c: &Copy) -> kp_sync::Result<SyncReport> {
    ServerRemote::new(&server.url, token, PROJECT)?.sync(&c.store, &c.root, "Bridge 7", &c.who)
}

fn status(error: SyncError) -> u16 {
    match error {
        SyncError::Server { status, .. } => status,
        other => panic!("expected a refusal from the server, got {other:?}"),
    }
}

#[test]
fn a_project_is_shared_by_invitation_and_synced() {
    let server = start(false);
    let info = client(&server).info().unwrap();
    assert!(info.first_user && !info.open_signup);

    // The first account is the administrator; strangers may not sign up after that.
    let ann = client(&server)
        .register("ann@firm.com", "Ann", "beam-and-column")
        .unwrap();
    assert!(ann.user.is_admin);
    let refused = client(&server)
        .register("sam@firm.com", "Sam", "slab-and-wall")
        .unwrap_err();
    assert_eq!(status(refused), 403);

    // Ann shares her project: issue, comment, model file.
    let ann_copy = copy("Ann");
    ann_copy.write("models/frame.ifc", "ISO-10303-21; frame v1");
    ann_copy.import("models/frame.ifc", "ifc");
    ann_copy.sql(
        "INSERT INTO issue (id, bcf_guid, title, created_by) VALUES ('i1', 'g1', 'Check B12', 'Ann');
         INSERT INTO issue_viewpoint (id, issue_id, guid, camera_json, snapshot) VALUES ('v1', 'i1', 'vg', '{}', x'89504e47');",
    );
    let first = sync(&server, &ann.token, &ann_copy).unwrap();
    assert_eq!((first.sent, first.files_sent), (2, 1));

    // Ann invites Sam before he has an account; signing up makes him a member.
    let ann_api = signed_in(&server, &ann.token);
    let invited = ann_api.invite(PROJECT, "Sam@Firm.com", "editor").unwrap();
    assert!(invited.pending);
    let sam = client(&server)
        .register("sam@firm.com", "Sam", "slab-and-wall")
        .unwrap();
    let projects = signed_in(&server, &sam.token).projects().unwrap();
    assert_eq!(projects.len(), 1);
    assert_eq!(
        (projects[0].name.as_str(), projects[0].role.as_str()),
        ("Bridge 7", "editor")
    );

    // Sam's empty copy fills up.
    let sam_copy = copy("Sam");
    let report = sync(&server, &sam.token, &sam_copy).unwrap();
    assert_eq!(report.applied, 2);
    assert_eq!(report.received_files.len(), 1);
    assert_eq!(report.received_files[0].from_user, "Ann");
    assert_eq!(sam_copy.read("models/frame.ifc"), "ISO-10303-21; frame v1");
    assert_eq!(sam_copy.text("SELECT title FROM issue"), "Check B12");
    assert_eq!(report.peers.len(), 1);
    assert_eq!(
        (
            report.peers[0].user.as_str(),
            report.peers[0].machine.as_str()
        ),
        ("Ann", "Ann-pc")
    );

    // Sam comments and closes the issue; Ann gets both.
    sam_copy.import("models/frame.ifc", "ifc");
    sam_copy.sql(
        "INSERT INTO issue_comment (id, issue_id, author, text) VALUES ('c1', 'i1', 'Sam', 'Section increased');
         UPDATE issue SET status = 'closed' WHERE id = 'i1';",
    );
    let sent = sync(&server, &sam.token, &sam_copy).unwrap();
    assert_eq!((sent.sent, sent.files_sent), (2, 0));
    let back = sync(&server, &ann.token, &ann_copy).unwrap();
    assert_eq!(back.applied, 2);
    assert!(back.received_files.is_empty());
    assert_eq!(ann_copy.text("SELECT status FROM issue"), "closed");
    assert_eq!(
        ann_copy.text("SELECT text FROM issue_comment"),
        "Section increased"
    );

    // A new revision travels and replaces the imported one.
    ann_copy.write("models/frame.ifc", "ISO-10303-21; frame v2");
    ann_copy.import("models/frame.ifc", "ifc");
    assert_eq!(sync(&server, &ann.token, &ann_copy).unwrap().files_sent, 1);
    let update = sync(&server, &sam.token, &sam_copy).unwrap();
    assert_eq!(update.received_files.len(), 1);
    assert_eq!(sam_copy.read("models/frame.ifc"), "ISO-10303-21; frame v2");

    // Nothing new: nothing moves.
    sam_copy.import("models/frame.ifc", "ifc");
    let quiet = sync(&server, &sam.token, &sam_copy).unwrap();
    assert_eq!(
        (
            quiet.sent,
            quiet.files_sent,
            quiet.applied,
            quiet.received_files.len()
        ),
        (0, 0, 0, 0)
    );
}

#[test]
fn viewers_read_but_their_edits_stay_home() {
    let server = start(true);
    let ann = client(&server)
        .register("ann@firm.com", "Ann", "beam-and-column")
        .unwrap();
    let kim = client(&server)
        .register("kim@firm.com", "Kim", "footing-pile")
        .unwrap();
    let ann_copy = copy("Ann");
    ann_copy.sql("INSERT INTO note (id, point_json, text) VALUES ('n1', '[0,0,0]', 'Check here');");
    sync(&server, &ann.token, &ann_copy).unwrap();
    signed_in(&server, &ann.token)
        .invite(PROJECT, "kim@firm.com", "viewer")
        .unwrap();

    let kim_copy = copy("Kim");
    assert_eq!(sync(&server, &kim.token, &kim_copy).unwrap().applied, 1);
    kim_copy.sql("UPDATE note SET text = 'Kim was here' WHERE id = 'n1';");
    let report = sync(&server, &kim.token, &kim_copy).unwrap();
    assert_eq!(report.sent, 0);
    assert_eq!(report.conflicts.len(), 1, "the viewer is told");
    sync(&server, &ann.token, &ann_copy).unwrap();
    assert_eq!(ann_copy.text("SELECT text FROM note"), "Check here");

    // Pushing directly is refused too.
    let refused = signed_in(&server, &kim.token)
        .push_changes(PROJECT, kim_copy.store.device_id(), Vec::new())
        .unwrap_err();
    assert_eq!(status(refused), 403);
}

#[test]
fn strangers_and_old_sessions_are_kept_out() {
    let server = start(true);
    let ann = client(&server)
        .register("ann@firm.com", "Ann", "beam-and-column")
        .unwrap();
    let eve = client(&server)
        .register("eve@else.com", "Eve", "not-a-member")
        .unwrap();
    sync(&server, &ann.token, &copy("Ann")).unwrap();

    // Not a member: the project does not exist for her, and she cannot claim it.
    let eve_api = signed_in(&server, &eve.token);
    assert_eq!(status(eve_api.project(PROJECT).unwrap_err()), 404);
    assert_eq!(
        status(eve_api.pull_changes(PROJECT, 0, 10).unwrap_err()),
        404
    );
    let claim = sync(&server, &eve.token, &copy("Eve")).unwrap_err();
    assert!(matches!(claim, SyncError::Invalid(_)), "{claim:?}");

    // Wrong password, then a session after signing out.
    assert_eq!(
        status(client(&server).login("ann@firm.com", "wrong").unwrap_err()),
        401
    );
    let again = client(&server)
        .login("ANN@firm.com", "beam-and-column")
        .unwrap();
    let api = signed_in(&server, &again.token);
    api.me().unwrap();
    api.logout().unwrap();
    let after = api.me().unwrap_err();
    assert!(after.is_unauthorized());
    assert_eq!(
        status(signed_in(&server, "kp_made_up").me().unwrap_err()),
        401
    );
}

#[test]
fn uploads_must_match_their_hash_and_owners_cannot_vanish() {
    let server = start(true);
    let ann = client(&server)
        .register("ann@firm.com", "Ann", "beam-and-column")
        .unwrap();
    let ann_api = signed_in(&server, &ann.token);
    ann_api.create_project(PROJECT, "Bridge 7").unwrap();

    let dir = tempfile::tempdir().unwrap();
    let file = dir.path().join("frame.ifc");
    std::fs::write(&file, "content").unwrap();
    let wrong = "a".repeat(64);
    assert_eq!(
        status(ann_api.put_blob(PROJECT, &wrong, &file).unwrap_err()),
        400
    );
    assert!(!ann_api.has_blob(PROJECT, &wrong).unwrap());
    let right = kp_sync::files::hash_file(&file).unwrap();
    ann_api.put_blob(PROJECT, &right, &file).unwrap();
    assert!(ann_api.has_blob(PROJECT, &right).unwrap());
    let back = dir.path().join("back.ifc");
    ann_api.get_blob(PROJECT, &right, &back).unwrap();
    assert_eq!(std::fs::read_to_string(back).unwrap(), "content");

    // The only owner can neither leave nor be demoted.
    assert_eq!(
        status(ann_api.remove_member(PROJECT, "ann@firm.com").unwrap_err()),
        409
    );
    assert_eq!(
        status(
            ann_api
                .invite(PROJECT, "ann@firm.com", "viewer")
                .unwrap_err()
        ),
        409
    );
    let members = ann_api.members(PROJECT).unwrap();
    assert_eq!(members.len(), 1);
    assert_eq!(members[0].role, "owner");
}

#[test]
fn a_project_moved_from_a_shared_folder_to_a_server_keeps_every_edit() {
    let server = start(true);
    let shared = tempfile::tempdir().unwrap();
    let folder = |c: &Copy| {
        kp_sync::folder::FolderRemote::open(shared.path(), PROJECT, "Bridge 7")
            .unwrap()
            .sync(&c.store, &c.root, &c.who)
            .unwrap()
    };
    let (ann_copy, sam_copy) = (copy("Ann"), copy("Sam"));
    ann_copy.sql(
        "INSERT INTO issue (id, bcf_guid, title, created_by) VALUES ('i1', 'g1', 'Check B12', 'Ann');",
    );
    folder(&ann_copy);
    folder(&sam_copy);
    sam_copy.sql("UPDATE issue SET status = 'closed' WHERE id = 'i1';");
    folder(&sam_copy);
    folder(&ann_copy);
    assert_eq!(ann_copy.text("SELECT status FROM issue"), "closed");

    // Ann moves the project to the server; Kim joins there and sees Sam's edit too.
    let ann = client(&server)
        .register("ann@firm.com", "Ann", "beam-and-column")
        .unwrap();
    let moved = sync(&server, &ann.token, &ann_copy).unwrap();
    assert_eq!(
        moved.sent, 2,
        "Ann's own change and the one she got from Sam"
    );
    signed_in(&server, &ann.token)
        .invite(PROJECT, "kim@firm.com", "editor")
        .unwrap();
    let kim = client(&server)
        .register("kim@firm.com", "Kim", "footing-pile")
        .unwrap();
    let kim_copy = copy("Kim");
    sync(&server, &kim.token, &kim_copy).unwrap();
    assert_eq!(kim_copy.text("SELECT status FROM issue"), "closed");

    // Nothing is echoed back: a second sync sends nothing.
    assert_eq!(sync(&server, &ann.token, &ann_copy).unwrap().sent, 0);
    assert_eq!(sync(&server, &kim.token, &kim_copy).unwrap().sent, 0);
}
