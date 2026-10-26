# KingPost Connect server

The server lets a team share projects without a shared folder: people sign in, project
owners invite colleagues by email, and every copy of a project syncs through it. It also
serves a web viewer, so anyone invited can open a project's model and issues in a browser.

It is a single program with no database to install. Everything it keeps is in its data
folder: `server.db` (accounts, projects, members and the change records) and `blobs/`
(the model, drawing and analysis files, stored once by content).

The server relays what the copies send and stores the files; it does not merge or change
anything. Each copy applies the others' changes itself, exactly as with a shared folder.

## Start it

**Windows.** Unzip `kingpost-server-<version>-windows-x64.zip` somewhere permanent, for
example `C:\KingPost\server`, and run:

```
kingpost-server.exe --data C:\KingPost\data
```

**Linux.** Unpack `kingpost-server-<version>-linux-x64.tar.gz`, for example in
`/opt/kingpost`, and run:

```
./kingpost-server --data /var/lib/kingpost
```

The server listens on port 8640. Open `http://<server>:8640` in a browser: you see the web
viewer's sign-in page. Allow the port through the firewall for the people who will use it.

| Option | Meaning | Default |
|---|---|---|
| `--data DIR` | where the database and files are kept (`KINGPOST_DATA`) | `kingpost-data` in the current folder |
| `--listen ADDRESS` | address and port to listen on (`KINGPOST_LISTEN`) | `0.0.0.0:8640` |
| `--web DIR` | the web viewer's folder (`KINGPOST_WEB`) | the `web` folder next to the program |
| `--open-signup` | anyone who can reach the server may create an account (`KINGPOST_OPEN_SIGNUP=1`) | off |

## The first account

The first account created on a server becomes its administrator. Create it in the web
viewer (**Create an account**), from KingPost Connect, or on the command line:

```
kingpost-server add-user --data C:\KingPost\data --email you@firm.com --name "Your Name" --admin
```

After that, only people invited to a project can create an account (unless the server runs
with `--open-signup`).

## Sharing a project

1. In KingPost Connect, open the project, click the cloud button in the title bar, choose
   **Server**, enter the server's address and sign in. The first sync sends the project's
   content and files.
2. In the same panel, under **People**, invite colleagues by email as editors (they change
   the project) or viewers (they see it). Owners also manage who has access.
3. Tell them the server's address. The server does not send email. They create an account
   with the email you invited, then in KingPost Connect choose **Join shared project…** on
   the Projects page, **From a server**, pick the project and an empty folder for their copy.
   Or they open the address in a browser to use the web viewer.

## The web viewer

At the server's address, invited people sign in, open a project, see its latest model in 3D,
read issues with their viewpoints and comments, show an issue's elements, add comments and
change an issue's status (editors). Everything they do reaches the desktop copies at their
next sync.

## HTTPS

The server speaks plain HTTP. That is acceptable inside an office network; when the server
can be reached from the internet, put it behind a reverse proxy with a certificate and let
it listen on the local address only (`--listen 127.0.0.1:8640`). With Caddy, which obtains
certificates by itself:

```
sync.yourfirm.com {
    reverse_proxy 127.0.0.1:8640
}
```

With nginx or IIS, forward everything to `http://127.0.0.1:8640` and lift the upload size
limit (nginx: `client_max_body_size 0;`): model files can be hundreds of megabytes. The web
viewer also works under a sub-path, for example `https://firm.com/kingpost/` (with the
final slash; KingPost Connect itself is given the same address).

## Keep it running

**Windows.** Create a scheduled task that starts `kingpost-server.exe --data C:\KingPost\data`
at system start-up, runs whether anyone is signed in or not, and restarts on failure.

**Linux.** A systemd unit, for example `/etc/systemd/system/kingpost.service`:

```
[Unit]
Description=KingPost Connect server
After=network.target

[Service]
ExecStart=/opt/kingpost/kingpost-server --data /var/lib/kingpost --listen 127.0.0.1:8640
Restart=on-failure
User=kingpost

[Install]
WantedBy=multi-user.target
```

The server writes one log line per request to its standard error output.

## Back up

Stop the server and copy the data folder, or copy it while it runs with the database's own
backup (`sqlite3 server.db ".backup server-backup.db"`) plus the `blobs` folder, whose files
never change once written. Each desktop copy of a project also holds the full project, so a
lost server can be recreated by syncing a copy to a new one.

## Update

Stop the server, replace the program and the `web` folder with the new version's, start it
again. The database is brought up to date automatically; an older program refuses a database
written by a newer one.

## Accounts on the command line

```
kingpost-server add-user --email ann@firm.com --name "Ann Lee" [--admin]
kingpost-server set-password --email ann@firm.com
kingpost-server list-users
```

Passwords are read from `KINGPOST_PASSWORD` or asked for. Changing a password signs that
person out everywhere.

## Security

- Passwords are stored as Argon2id hashes; sign-in tokens are stored hashed, so a copy of
  the database signs nobody in. Sign-ins last 90 days from their last use.
- After five failed sign-ins for an email, further attempts wait longer each time.
- Project content and files are readable only by the project's members; viewers cannot send
  changes.
- Files are checked against their SHA-256 before they are kept, and a copy places received
  files only inside its project folder.
- On each computer, KingPost Connect keeps the sign-in token in the user's application
  settings folder (`sync-accounts.json`), never in the project.
- Every answer carries `X-Content-Type-Options: nosniff`, `Referrer-Policy: same-origin`
  and `X-Frame-Options: DENY`; the web viewer's pages carry a `Content-Security-Policy`
  that allows only the server itself. A reverse proxy should pass these through
  unchanged.
- Sign-in bodies are limited to 16 KB, change pushes to 64 MB, file uploads to 8 GB.
